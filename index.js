/**
 * dsh-profile-stats — Host half.
 *
 * 把「本机所有会话日志」折叠成一份个人用量快照：
 *   · 累计 Token 数 / 输入·输出·缓存明细 / 模型调用次数
 *   · 每日 Token（GitHub 贡献图口径，本地时区）
 *   · 单日峰值、单会话峰值、单次调用峰值
 *   · 最长任务用时（同一 turn 内 turn/start → turn/end 的最大跨度）
 *   · 活跃天数、最长连续天数、当前连续天数
 *
 * 数据源只有一个：`ctx.sessionQuery` 读到的会话日志（唯一真相）。这里算出来的
 * 一切都可以从日志重建，磁盘缓存只是把「已经折过的会话」记下来，避免每次打开
 * 页面都重读几十 MB 日志；缓存丢了只是慢一次，不会出现和日志不一致的数字。
 *
 * 浏览器半区只走这三个同源路由：
 *   GET  /api/dsh-profile-stats/snapshot  当前快照（扫描中也会返回进度），唯一的数据来源
 *   POST /api/dsh-profile-stats/refresh   请求立即重扫（点刷新按钮时用；平时由后台定时保鲜）
 *   POST /api/dsh-profile-stats/update    一键升级（仅 registry 安装且有新版本时）
 */

import fs, { appendFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const inject = ['webServer', 'sessionQuery']

const SNAPSHOT_PATH = '/api/dsh-profile-stats/snapshot'
const REFRESH_PATH = '/api/dsh-profile-stats/refresh'
const UPDATE_PATH = '/api/dsh-profile-stats/update'
const ALIAS_PATH = '/api/dsh-profile-stats/alias'

/** 本插件自己的包名 / 目录（用于读自身版本、给 pluginManager 传 spec）。 */
const SELF_NAME = 'dsh-profile-stats'
const SELF_DIR = path.dirname(fileURLToPath(import.meta.url))
/** 版本检查的缓存时长：打开面板最多每 6 小时问一次 registry。 */
const UPDATE_CHECK_TTL_MS = 6 * 60 * 60 * 1000

/**
 * 缓存结构版本：折叠口径变了就 +1，旧缓存整份丢弃重折。
 * 12：继承前缀补记 provider / 每日 input·output·cache 明细（孤儿前缀补回时用它自己的数）。
 * 13：单步总量改为四项之和（旧日志缺 totalTokens 时不再漏掉缓存）；缓存读 / 写分开记；
 *     每天每个 provider 记四项用量。
 * 14：会话记下工作目录（cwd）与是否子代理会话，用于按项目统计。
 */
const CACHE_VERSION = 14
const DAY_MS = 86400000
/**
 * 数据保鲜不依赖用户打开页面：宿主运行期间每分钟看一眼，快照超过 5 分钟就在后台静默补扫；
 * 页面读快照时更在意新鲜度，超过 60 秒也顺手静默补扫一次（先回旧快照，补扫完页面自己刷新数字）。
 */
const BACKGROUND_CHECK_MS = 60 * 1000
const BACKGROUND_STALE_MS = 5 * 60 * 1000
const VIEW_STALE_MS = 60 * 1000

/* ------------------------------------------------------------------ 基础工具 */

function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

function cacheFile() {
  return path.join(dshHome(), 'dsh-profile-stats', 'cache.json')
}

/** 用户可编辑的身份覆盖文件：{ "name": "...", "handle": "@...", "avatar": "M" } */
function identityFile() {
  return path.join(dshHome(), 'dsh-profile-stats', 'profile.json')
}

function readIdentityOverride() {
  try {
    const parsed = JSON.parse(fs.readFileSync(identityFile(), 'utf8'))
    if (!parsed || typeof parsed !== 'object') return null
    const name = typeof parsed.name === 'string' ? parsed.name.trim() : ''
    let handle = typeof parsed.handle === 'string' ? parsed.handle.trim() : ''
    const avatar = typeof parsed.avatar === 'string' ? parsed.avatar.trim() : ''
    if (!name && !handle && !avatar) return null
    if (handle && !handle.startsWith('@')) handle = `@${handle}`
    return { name, handle, avatar }
  } catch {
    // 文件不存在或写坏了都当作「没有覆盖」，回落到系统账户名。
    return null
  }
}

/**
 * 供应商的显示名（只存在本机，不进仓库、不进 npm 包）：{ "providers": { "<provider id>": "<显示名>" } }。
 * 公开代码里不写任何私有渠道的名字，页面默认显示原始 id；用户可以在供应商卡片上给自己的渠道起名。
 */
function aliasFile() {
  return path.join(dshHome(), 'dsh-profile-stats', 'aliases.json')
}

const ALIAS_MAX_NAME = 40
const ALIAS_MAX_ID = 200
const ALIAS_MAX_COUNT = 200
const ALIAS_BODY_LIMIT = 16 * 1024

/** 只留「非空 id → 非空、不超过 40 字的名字」，最多 200 条；文件被手改坏了也不抛错。 */
function sanitizeAliases(raw) {
  const providers = {}
  const source = raw && typeof raw === 'object' && raw.providers && typeof raw.providers === 'object' && !Array.isArray(raw.providers) ? raw.providers : {}
  for (const [id, name] of Object.entries(source)) {
    if (Object.keys(providers).length >= ALIAS_MAX_COUNT) break
    const key = String(id).trim()
    const label = typeof name === 'string' ? name.trim().slice(0, ALIAS_MAX_NAME) : ''
    if (!key || key.length > ALIAS_MAX_ID || !label) continue
    providers[key] = label
  }
  return { providers }
}

function readAliases() {
  try {
    return sanitizeAliases(JSON.parse(fs.readFileSync(aliasFile(), 'utf8')))
  } catch {
    return { providers: {} }
  }
}

/** 改一个供应商的显示名；名字为空表示删掉（回到原始 id）。先写临时文件再改名，写到一半不会留下坏文件。 */
function writeAlias(provider, name) {
  const id = typeof provider === 'string' ? provider.trim() : ''
  if (!id || id.length > ALIAS_MAX_ID) return { ok: false, error: 'invalid-provider' }
  if (name !== undefined && name !== null && typeof name !== 'string') return { ok: false, error: 'invalid-name' }
  const label = typeof name === 'string' ? name.trim().slice(0, ALIAS_MAX_NAME) : ''
  const current = readAliases()
  if (label) current.providers[id] = label
  else delete current.providers[id]
  const next = sanitizeAliases(current)
  if (label && !next.providers[id]) return { ok: false, error: 'too-many' }
  const file = aliasFile()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`)
  fs.renameSync(temporary, file)
  return { ok: true, aliases: next }
}

/** 读 JSON 请求体（宿主给的是 Node 的请求流），超过上限直接拒绝。 */
async function readJsonBody(req, limit) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    size += buffer.length
    if (size > limit) {
      const error = new Error('body-too-large')
      error.code = 'too-large'
      throw error
    }
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  return text ? JSON.parse(text) : {}
}

function toNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function localDayKey(time) {
  const date = new Date(time)
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** 'YYYY-MM-DD' → UTC 毫秒（只用来做日期间隔算术，不受时区影响）。非法日历键返回 NaN。 */
function dayIndex(key) {
  const text = String(key || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return Number.NaN
  const year = Number(text.slice(0, 4))
  const month = Number(text.slice(5, 7))
  const day = Number(text.slice(8, 10))
  const index = Date.UTC(year, month - 1, day)
  // Date.UTC 会把 13 月、2 月 30 日这类值静默归一到别的日期；这里要求原样读回来，
  // 免得坏键被「修正」成一个看起来合理的错误日期。
  const date = new Date(index)
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return Number.NaN
  }
  return index
}

/**
 * 日历键 ± 若干天。全程留在 UTC 里算：dayIndex 给的是 UTC 零点，必须再按 UTC 读回日期。
 * 旧实现用 localDayKey（本地时区）读回，在 UTC− 时区里 UTC 零点落在前一天晚上，
 * 「下一天」读回来还是同一天、「前一天」读回来是前两天，连续天数在美洲时区恒为 1。
 */
function shiftDayKey(key, days) {
  const index = dayIndex(key)
  if (!Number.isFinite(index)) return ''
  const date = new Date(index + days * DAY_MS)
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${date.getUTCFullYear()}-${month}-${day}`
}

function nextDayKey(key) {
  return shiftDayKey(key, 1)
}

function yieldToLoop() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/* -------------------------------------------------------------- 单个会话折叠 */

/**
 * 工作目录 → 项目键与显示路径。去掉首尾空白与末尾的分隔符；Windows 路径（盘符或反斜杠）不区分大小写，
 * 键统一成小写、正斜杠，显示路径保留第一次见到的写法。没有工作目录的会话归到空键（页面写「未知项目」）。
 */
function projectOf(cwd) {
  const display = typeof cwd === 'string' ? cwd.trim().replace(/(.)[\\/]+$/, '$1') : ''
  if (!display) return { key: '', path: '' }
  const windows = /^[A-Za-z]:/.test(display) || display.includes('\\')
  return { key: windows ? display.replace(/\\/g, '/').toLowerCase() : display, path: display }
}

function emptyFold(sessionId, createdAt, parentSession) {
  return {
    sessionId,
    seq: -1,
    createdAt: toNumber(createdAt),
    /** 头部记下的来源会话（fork/seed 时存在），用来判断继承前缀有没有「原件」。 */
    parentSession: parentSession ? String(parentSession) : '',
    /** 会话的工作目录（项目）与是否子代理会话（头部 origin = subagent 或 delegationDepth > 0）。 */
    cwd: '',
    subagent: false,
    calls: 0,
    tokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    maxStepTokens: 0,
    longestTurnMs: 0,
    /** 给了 totalTokens 却和四项之和对不上的步数（只计数，见 usageMismatch）。 */
    usageMismatchCalls: 0,
    perDay: {},
    perDayCalls: {},
    perDayInput: {},
    perDayOutput: {},
    perDayCacheRead: {},
    perDayCacheWrite: {},
    /** 按 provider 拆的用量（deepseek-official / deepseek-account …），用于和网关账单对账。 */
    perProvider: {},
    perDayProvider: {},
    /** 每天每个 provider 的四项用量：供应商卡片按范围算各家的缓存命中率。 */
    perDayProviderUsage: {},
    /** 按模型大类拆的用量（flash / pro / other）。 */
    perModel: {},
    perDayModel: {},
    openTurns: {},
    firstTime: 0,
    lastTime: 0,
    /** 继承前缀（fork/seed 抄进来的来源会话事件）里的用量，单独记账。 */
    inheritedTokens: 0,
    inheritedCalls: 0,
    inheritedPerDay: {},
    inheritedPerDayCalls: {},
    inheritedPerModel: {},
    inheritedPerDayModel: {},
    inheritedInputTokens: 0,
    inheritedOutputTokens: 0,
    inheritedCacheReadTokens: 0,
    inheritedCacheWriteTokens: 0,
    /** 继承前缀的 provider 与每日明细：孤儿前缀补回总量时，明细也必须用前缀自己的数。 */
    inheritedPerProvider: {},
    inheritedPerDayProvider: {},
    inheritedPerDayProviderUsage: {},
    inheritedPerDayInput: {},
    inheritedPerDayOutput: {},
    inheritedPerDayCacheRead: {},
    inheritedPerDayCacheWrite: {},
    complete: false,
  }
}

/**
 * 一步的用量四项。DSH 的约定是四项互不重叠：inputTokens 只是未缓存的那部分输入，
 * 缓存读 / 缓存写各自单列（DeepSeek 适配器从 prompt_tokens 里减掉命中，pi-ai 从 prompt 里减掉读写）。
 * 非数字、负数按 0。
 */
function usageParts(usage) {
  const source = usage || {}
  const count = (value) => Math.max(0, toNumber(value))
  return {
    inputTokens: count(source.inputTokens),
    cacheReadTokens: count(source.cacheReadTokens),
    cacheWriteTokens: count(source.cacheWriteTokens),
    outputTokens: count(source.outputTokens),
  }
}

function partsSum(parts) {
  return parts.inputTokens + parts.cacheReadTokens + parts.cacheWriteTokens + parts.outputTokens
}

/**
 * 一次模型调用的 token 数 = 未缓存输入 + 缓存读 + 缓存写 + 输出。
 * 不再以 totalTokens 为准：2026-08 ~ 09 的旧版 DSH 日志里有的步骤没写它，旧实现退回「输入 + 输出」，
 * 把缓存整块漏掉了。四项都没有时才用 totalTokens。
 */
function stepTokens(usage) {
  const sum = partsSum(usageParts(usage))
  return sum > 0 ? sum : Math.max(0, toNumber(usage && usage.totalTokens))
}

/** 上游给了 totalTokens 却和四项之和对不上。只计数（进快照 totals，供导出核对），不拿它修正任何数字。 */
function usageMismatch(usage) {
  if (!usage || typeof usage.totalTokens !== 'number' || !Number.isFinite(usage.totalTokens)) return false
  return usage.totalTokens !== partsSum(usageParts(usage))
}

function emptyUsage() {
  return { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }
}

/** 把一步的四项加进一份用量合计（没有就新建），返回这份合计。 */
function addUsage(target, parts) {
  const sum = target && typeof target === 'object' ? target : emptyUsage()
  sum.inputTokens = toNumber(sum.inputTokens) + toNumber(parts.inputTokens)
  sum.cacheReadTokens = toNumber(sum.cacheReadTokens) + toNumber(parts.cacheReadTokens)
  sum.cacheWriteTokens = toNumber(sum.cacheWriteTokens) + toNumber(parts.cacheWriteTokens)
  sum.outputTokens = toNumber(sum.outputTokens) + toNumber(parts.outputTokens)
  return sum
}

/**
 * 一份会话按天拆的那几张表。本体和继承前缀各一套、字段一一对应；
 * 折叠与聚合都经过这里，两条路径不会再各写一遍、漏掉某张表。
 */
function dayMapsOf(fold, inherited) {
  const map = (name) => {
    if (!fold[name] || typeof fold[name] !== 'object') fold[name] = {}
    return fold[name]
  }
  if (inherited) {
    return {
      tokens: map('inheritedPerDay'),
      calls: map('inheritedPerDayCalls'),
      input: map('inheritedPerDayInput'),
      output: map('inheritedPerDayOutput'),
      cacheRead: map('inheritedPerDayCacheRead'),
      cacheWrite: map('inheritedPerDayCacheWrite'),
      providers: map('inheritedPerDayProvider'),
      providerUsage: map('inheritedPerDayProviderUsage'),
      models: map('inheritedPerDayModel'),
    }
  }
  return {
    tokens: map('perDay'),
    calls: map('perDayCalls'),
    input: map('perDayInput'),
    output: map('perDayOutput'),
    cacheRead: map('perDayCacheRead'),
    cacheWrite: map('perDayCacheWrite'),
    providers: map('perDayProvider'),
    providerUsage: map('perDayProviderUsage'),
    models: map('perDayModel'),
  }
}

/** 一步记进某一天。 */
function addStepToDay(maps, key, parts, tokens, provider, modelFamily) {
  maps.tokens[key] = toNumber(maps.tokens[key]) + tokens
  maps.calls[key] = toNumber(maps.calls[key]) + 1
  maps.input[key] = toNumber(maps.input[key]) + parts.inputTokens
  maps.output[key] = toNumber(maps.output[key]) + parts.outputTokens
  maps.cacheRead[key] = toNumber(maps.cacheRead[key]) + parts.cacheReadTokens
  maps.cacheWrite[key] = toNumber(maps.cacheWrite[key]) + parts.cacheWriteTokens
  const providers = maps.providers[key] || (maps.providers[key] = {})
  providers[provider] = toNumber(providers[provider]) + tokens
  const providerUsage = maps.providerUsage[key] || (maps.providerUsage[key] = {})
  providerUsage[provider] = addUsage(providerUsage[provider], parts)
  const models = maps.models[key] || (maps.models[key] = {})
  models[modelFamily] = toNumber(models[modelFamily]) + tokens
}

/** 这一步是谁服务的（deepseek-official / deepseek-account …），用于和网关账单对账。 */
function providerOf(event) {
  const source = event && event.data && event.data.message && event.data.message.source
  const provider = source && typeof source.provider === 'string' ? source.provider.trim() : ''
  return provider || 'unknown'
}

/**
 * 模型 id 归一化：把中转站常见的写法差异（前缀、点/下划线、日期快照后缀）抹平，
 * 让同一个模型的多种写法落到同一个 family 上。例如
 *   deepseek-v4-1-flash-261017 / deepseek-v4.1-flash / DeepSeek-V4-1-Flash
 * 都归一成 deepseek-v4-1-flash。
 */
function normalizeModelId(raw) {
  let id = String(raw || '').trim().toLowerCase()
  if (!id) return ''
  // 有些中转站会把厂商当前缀再拼一层
  id = id.replace(/^(openai|anthropic|google|azure|aliyun|zhipu|baidu|moonshot)[/:]/, '')
  // 点、下划线统一成分隔符
  id = id.replace(/[._]/g, '-')
  // 去掉尾部的日期/快照/版本噪音
  id = id
    .replace(/-\d{4}-\d{2}-\d{2}$/, '')
    .replace(/-\d{6,8}$/, '')
    .replace(/-\d{4}$/, '')
    .replace(/-v\d+$/, '')
    .replace(/-(latest|preview|stable|exp)$/, '')
  return id.replace(/-+/g, '-').replace(/^-|-$/g, '')
}

/** 这一步实际用的模型族（模型 id 归一化后的结果，原样作为统计键）。 */
function modelFamilyOf(event) {
  const source = event && event.data && event.data.message && event.data.message.source
  const raw = source && typeof source.model === 'string' ? source.model : ''
  return normalizeModelId(raw) || 'unknown'
}

function applyEvent(fold, event) {
  const seq = toNumber(event.seq)
  if (seq > fold.seq) fold.seq = seq

  const time = toNumber(event.time)
  if (time > 0) {
    if (fold.firstTime === 0 || time < fold.firstTime) fold.firstTime = time
    if (time > fold.lastTime) fold.lastTime = time
  }

  const data = event.data || {}
  switch (event.type) {
    case 'assistant/message': {
      const usage = data.usage
      if (!usage) break
      const parts = usageParts(usage)
      const tokens = stepTokens(usage)
      fold.calls += 1
      fold.tokens += tokens
      fold.inputTokens += parts.inputTokens
      fold.outputTokens += parts.outputTokens
      fold.cacheReadTokens += parts.cacheReadTokens
      fold.cacheWriteTokens += parts.cacheWriteTokens
      if (usageMismatch(usage)) fold.usageMismatchCalls = toNumber(fold.usageMismatchCalls) + 1
      if (tokens > fold.maxStepTokens) fold.maxStepTokens = tokens
      const modelFamily = modelFamilyOf(event)
      fold.perModel[modelFamily] = toNumber(fold.perModel[modelFamily]) + tokens
      // provider 不需要日期，照记；否则按供应商拆出来的合计会小于总量。
      const provider = providerOf(event)
      fold.perProvider[provider] = toNumber(fold.perProvider[provider]) + tokens
      if (time > 0) {
        const key = localDayKey(time)
        if (key) addStepToDay(dayMapsOf(fold, false), key, parts, tokens, provider, modelFamily)
      }
      break
    }
    case 'turn/start': {
      const turn = data.turn
      if (turn !== undefined && time > 0) fold.openTurns[String(turn)] = time
      break
    }
    case 'turn/end': {
      const turn = data.turn
      if (turn === undefined) break
      const key = String(turn)
      const started = fold.openTurns[key]
      if (typeof started === 'number' && time >= started) {
        const span = time - started
        if (span > fold.longestTurnMs) fold.longestTurnMs = span
      }
      delete fold.openTurns[key]
      break
    }
    default:
      break
  }
}

/**
 * 折叠一份完整日志。
 *
 * fork / seed 出来的会话把来源会话的事件抄在日志头部（`inheritedEventCount`
 * 之前的那些 seq）。那段前缀的 token 是来源会话真实花掉的，只是被复制了一份，
 * 所以主口径从 `seq >= inheritedEventCount` 开始折，前缀单独记账：
 *   - 聚合时如果能在语料里找到「原件」（`parentSession` 仍存在），前缀不再计入；
 *   - 找不到原件（来源会话已被删除、或本就不在本机）时，这笔花费只存在于副本里，
 *     聚合会把前缀补回总量——否则会少算。
 */
function foldSnapshot(snapshot) {
  const header = snapshot && snapshot.session ? snapshot.session : {}
  const sessionId = header.id === undefined ? '' : String(header.id)
  const inherited = toNumber(snapshot && snapshot.inheritedEventCount)
  const fold = emptyFold(sessionId, header.createdAt, header.parentSession)
  fold.cwd = typeof header.cwd === 'string' ? header.cwd : ''
  fold.subagent = header.origin === 'subagent' || toNumber(header.delegationDepth) > 0
  const events = (snapshot && snapshot.events) || []
  for (const event of events) {
    const seq = toNumber(event.seq)
    if (seq < inherited) {
      // 继承前缀：只累加用量，不进任务用时/首末时间。
      const usage = event.type === 'assistant/message' && event.data ? event.data.usage : undefined
      if (usage) {
        const parts = usageParts(usage)
        const tokens = stepTokens(usage)
        fold.inheritedTokens += tokens
        fold.inheritedCalls += 1
        fold.inheritedInputTokens += parts.inputTokens
        fold.inheritedOutputTokens += parts.outputTokens
        fold.inheritedCacheReadTokens += parts.cacheReadTokens
        fold.inheritedCacheWriteTokens += parts.cacheWriteTokens
        const time = toNumber(event.time)
        const inheritedModelFamily = modelFamilyOf(event)
        fold.inheritedPerModel[inheritedModelFamily] = toNumber(fold.inheritedPerModel[inheritedModelFamily]) + tokens
        // provider 与主口径一致：不需要日期，一律记。
        const inheritedProvider = providerOf(event)
        fold.inheritedPerProvider[inheritedProvider] =
          toNumber(fold.inheritedPerProvider[inheritedProvider]) + tokens
        if (time > 0) {
          const key = localDayKey(time)
          if (key) addStepToDay(dayMapsOf(fold, true), key, parts, tokens, inheritedProvider, inheritedModelFamily)
        }
      }
      if (seq > fold.seq) fold.seq = seq
      continue
    }
    applyEvent(fold, event)
  }
  fold.complete = true
  return fold
}

/* ---------------------------------------------------------------- 聚合与派生 */

function computeStreaks(activeDays, now) {
  if (activeDays.length === 0) return { longestStreak: 0, currentStreak: 0 }
  // 去重：同一天出现两次会把连续段落打断，最长连续天数会被算小。
  const sorted = Array.from(new Set(activeDays)).sort()
  let longest = 1
  let run = 1
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index] === nextDayKey(sorted[index - 1])) {
      run += 1
      if (run > longest) longest = run
    } else {
      run = 1
    }
  }
  const today = localDayKey(now)
  // 「昨天」按日历减一天，而不是 now − 24h：夏令时切换日只有 23/25 小时。
  const yesterday = shiftDayKey(today, -1)
  const active = new Set(sorted)
  let cursor = active.has(today) ? today : active.has(yesterday) ? yesterday : null
  let current = 0
  while (cursor !== null && active.has(cursor)) {
    current += 1
    const previous = shiftDayKey(cursor, -1)
    cursor = active.has(previous) ? previous : null
  }
  return { longestStreak: longest, currentStreak: current }
}

function aggregate(sessions, now, knownIds) {
  const daily = new Map()
  const totals = {
    tokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    calls: 0,
    inheritedTokens: 0,
    inheritedCalls: 0,
    inheritedSessions: 0,
    orphanedTokens: 0,
    orphanedSessions: 0,
    usageMismatchCalls: 0,
    byProvider: {},
    byModel: {},
  }
  let peakDayTokens = 0
  let peakDay = ''
  let peakStepTokens = 0
  let peakStepSession = ''
  let peakSessionTokens = 0
  let peakSession = ''
  let longestTurnMs = 0
  let longestTurnSession = ''
  let firstDay = ''
  let lastDay = ''

  /**
   * 每天一份 { tokens, calls, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens,
   * byProvider, providerUsage, byModel, byProject, byProjectSubagent }。`maps` 来自 dayMapsOf，每张表都出自同一份来源（会话自身 或 它的继承前缀）：
   * 旧实现补回孤儿前缀时拿的是会话自身的每日明细，同一天会把自身用量算两次、前缀明细一笔不进。
   */
  /** 项目键 → 显示路径（第一次见到的写法）。 */
  const projects = {}
  const mergeDay = (maps, project) => {
    for (const [key, value] of Object.entries(maps.tokens)) {
      const tokens = toNumber(value)
      if (tokens <= 0) continue
      const entry = daily.get(key) || {
        tokens: 0,
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        byProvider: {},
        providerUsage: {},
        byModel: {},
        byProject: {},
        byProjectSubagent: {},
      }
      entry.tokens += tokens
      // 一个会话只有一个工作目录：这一天这份来源的 token 全部记到它的项目上
      entry.byProject[project.key] = toNumber(entry.byProject[project.key]) + tokens
      if (project.subagent) entry.byProjectSubagent[project.key] = toNumber(entry.byProjectSubagent[project.key]) + tokens
      entry.calls += toNumber(maps.calls[key])
      entry.inputTokens += toNumber(maps.input[key])
      entry.outputTokens += toNumber(maps.output[key])
      entry.cacheReadTokens += toNumber(maps.cacheRead[key])
      entry.cacheWriteTokens += toNumber(maps.cacheWrite[key])
      for (const [provider, amount] of Object.entries(maps.providers[key] || {})) {
        entry.byProvider[provider] = toNumber(entry.byProvider[provider]) + toNumber(amount)
      }
      for (const [provider, usage] of Object.entries(maps.providerUsage[key] || {})) {
        entry.providerUsage[provider] = addUsage(entry.providerUsage[provider], usage || {})
      }
      for (const [modelFamily, amount] of Object.entries(maps.models[key] || {})) {
        entry.byModel[modelFamily] = toNumber(entry.byModel[modelFamily]) + toNumber(amount)
      }
      daily.set(key, entry)
    }
  }

  for (const fold of sessions) {
    const place = projectOf(fold.cwd)
    const project = { key: place.key, subagent: Boolean(fold.subagent) }
    if (place.key && !projects[place.key]) projects[place.key] = place.path
    totals.tokens += fold.tokens
    totals.inputTokens += fold.inputTokens
    totals.outputTokens += fold.outputTokens
    totals.cacheReadTokens += fold.cacheReadTokens
    totals.cacheWriteTokens += fold.cacheWriteTokens
    totals.calls += fold.calls
    totals.usageMismatchCalls += toNumber(fold.usageMismatchCalls)
    for (const [provider, value] of Object.entries(fold.perProvider || {})) {
      totals.byProvider[provider] = toNumber(totals.byProvider[provider]) + toNumber(value)
    }
    for (const [modelFamily, value] of Object.entries(fold.perModel || {})) {
      totals.byModel[modelFamily] = toNumber(totals.byModel[modelFamily]) + toNumber(value)
    }

    const inheritedTokens = toNumber(fold.inheritedTokens)
    if (inheritedTokens > 0) {
      // 前缀是不是「重复计数」，取决于它的原件还在不在语料里。
      const sourceInCorpus = fold.parentSession ? knownIds.has(fold.parentSession) : false
      if (sourceInCorpus) {
        totals.inheritedTokens += inheritedTokens
        totals.inheritedCalls += toNumber(fold.inheritedCalls)
        totals.inheritedSessions += 1
      } else {
        // 原件已不在：这笔花费只有副本有记录，补回总量，否则会少算。
        totals.tokens += inheritedTokens
        totals.calls += toNumber(fold.inheritedCalls)
        totals.orphanedTokens += inheritedTokens
        totals.orphanedSessions += 1
        totals.inputTokens += toNumber(fold.inheritedInputTokens)
        totals.outputTokens += toNumber(fold.inheritedOutputTokens)
        totals.cacheReadTokens += toNumber(fold.inheritedCacheReadTokens)
        totals.cacheWriteTokens += toNumber(fold.inheritedCacheWriteTokens)
        for (const [modelFamily, value] of Object.entries(fold.inheritedPerModel || {})) {
          totals.byModel[modelFamily] = toNumber(totals.byModel[modelFamily]) + toNumber(value)
        }
        for (const [provider, value] of Object.entries(fold.inheritedPerProvider || {})) {
          totals.byProvider[provider] = toNumber(totals.byProvider[provider]) + toNumber(value)
        }
        mergeDay(dayMapsOf(fold, true), project)
      }
    }

    if (fold.tokens > peakSessionTokens) {
      peakSessionTokens = fold.tokens
      peakSession = fold.sessionId
    }
    if (fold.maxStepTokens > peakStepTokens) {
      peakStepTokens = fold.maxStepTokens
      peakStepSession = fold.sessionId
    }
    if (fold.longestTurnMs > longestTurnMs) {
      longestTurnMs = fold.longestTurnMs
      longestTurnSession = fold.sessionId
    }

    mergeDay(dayMapsOf(fold, false), project)
  }

  const dailyList = Array.from(daily.entries())
    .map(([date, entry]) => ({ date, ...entry }))
    .sort((left, right) => (left.date < right.date ? -1 : 1))

  for (const entry of dailyList) {
    if (entry.tokens > peakDayTokens) {
      peakDayTokens = entry.tokens
      peakDay = entry.date
    }
    if (!firstDay) firstDay = entry.date
    lastDay = entry.date
  }

  const streak = computeStreaks(dailyList.map((entry) => entry.date), now)

  return {
    totals: {
      ...totals,
      /** 把继承前缀也加进来的「日志原始合计」，用于核对两种口径的差。 */
      tokensWithInherited: totals.tokens + totals.inheritedTokens,
      sessions: sessions.length,
      activeDays: dailyList.length,
      firstDay,
      lastDay,
      peakDay: { date: peakDay, tokens: peakDayTokens },
      peakStepTokens,
      peakStepSession,
      peakSessionTokens,
      peakSession,
      longestTurnMs,
      longestTurnSession,
      ...streak,
    },
    daily: dailyList,
    projects,
  }
}

/* ---------------------------------------------------------------- 缓存读写 */

function readCache() {
  const empty = { version: CACHE_VERSION, generatedAt: 0, sessions: {}, complete: false }
  try {
    const parsed = JSON.parse(fs.readFileSync(cacheFile(), 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.version !== CACHE_VERSION) return empty
    // 缓存文件是本地可改的：sessions 可能是 null / 数组，单条记录也可能被写坏。
    // 这类记录直接丢掉（下次扫描会重折），不能让 Object.keys(null) 或 fold.tokens 在启动时抛错。
    const sessions = {}
    const source = parsed.sessions
    if (source && typeof source === 'object' && !Array.isArray(source)) {
      for (const [id, fold] of Object.entries(source)) {
        if (!fold || typeof fold !== 'object' || Array.isArray(fold)) continue
        sessions[id] = fold
      }
    }
    return {
      version: CACHE_VERSION,
      generatedAt: toNumber(parsed.generatedAt),
      sessions,
      // 只有首次全量扫描中途落盘时才显式写 false；没有这个字段的旧缓存视为完整
      complete: parsed.complete !== false,
    }
  } catch {
    return empty
  }
}

function writeCache(cache) {
  try {
    const file = cacheFile()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const temporary = `${file}.${process.pid}.tmp`
    fs.writeFileSync(temporary, JSON.stringify(cache))
    fs.renameSync(temporary, file)
  } catch (error) {
    // 缓存只是加速层：写不进去就下次重扫，不影响正确性。
    console.warn('[dsh-profile-stats] 缓存写入失败：', error && error.message ? error.message : error)
  }
}

/** 本插件自身声明的版本号（registry 上比对用）。 */
function readOwnVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(SELF_DIR, 'package.json'), 'utf8')).version || ''
  } catch {
    return ''
  }
}

/**
 * 够用的 semver 比较：-1 / 0 / 1。
 *
 * 主版本三段按数字比；预发布标识按 semver 的规则比（数字段按数字、字母段按字典序、
 * 数字段低于字母段、段数少的一方更低）。旧实现直接拿 `rc.10` 和 `rc.5` 比字符串，
 * 会得出 rc.10 更旧的错误结论。
 */
function compareVersions(left, right) {
  const parse = (value) => {
    const text = String(value || '').trim().replace(/^v/i, '').split('+')[0]
    const [core, ...rest] = text.split('-')
    const parts = core.split('.').map((piece) => Number.parseInt(piece, 10) || 0)
    return { parts, pre: rest.length > 0 ? rest.join('-') : '' }
  }
  const a = parse(left)
  const b = parse(right)
  for (let index = 0; index < 3; index += 1) {
    const diff = (a.parts[index] || 0) - (b.parts[index] || 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }
  if (a.pre === b.pre) return 0
  if (!a.pre) return 1
  if (!b.pre) return -1
  const leftIds = a.pre.split('.')
  const rightIds = b.pre.split('.')
  for (let index = 0; index < Math.max(leftIds.length, rightIds.length); index += 1) {
    const x = leftIds[index]
    const y = rightIds[index]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const xNumeric = /^\d+$/.test(x)
    const yNumeric = /^\d+$/.test(y)
    if (xNumeric && yNumeric) {
      const diff = Number(x) - Number(y)
      if (diff !== 0) return diff > 0 ? 1 : -1
      continue
    }
    // semver：数字标识 < 字母标识
    if (xNumeric) return -1
    if (yNumeric) return 1
    if (x !== y) return x > y ? 1 : -1
  }
  return 0
}

/**
 * 是否「registry 依赖」。只有这种安装方式能被 pluginManager 升级；
 * file:/link:/git+/github:/https: 这些一律不算（升级要重新装，别自作主张）。
 */
function isRegistrySpec(spec) {
  const text = String(spec || '').trim()
  if (!text) return false
  if (/^(file:|link:|portal:|workspace:|git\+|git:|github:|https?:|ssh:|\/|\.{1,2}[\\/])/i.test(text)) return false
  return /^[a-z0-9@][\w@./-]*(@[\w.^~<>=|* -]+)?$/i.test(text)
}

function updateResultFile() {
  return path.join(dshHome(), 'dsh-profile-stats', 'update.json')
}

/* ------------------------------------------------------------------ 插件本体 */

/**
 * 控制器的全部状态与行为（扫描、聚合、身份、版本检查、一键升级）。
 *
 * 和 `apply` 分开是为了让 `test/` 能直接驱动：不需要宿主、不需要等定时器，
 * `await controller.scan('test')` 就是一次完整的扫描。`apply` 只负责把路由和
 * 定时器接到控制器上。
 */
export function createController(ctx) {
  const cache = readCache()
  const state = {
    cache,
    aggregate: null,
    generatedAt: 0,
    scanning: false,
    progress: { done: 0, total: 0 },
    errors: {},
    inflight: null,
    lastKick: 0,
    /** 本轮是不是「首次全量扫描」（缓存为空、或上次首扫被打断）。只有这种扫描页面才显示进度。 */
    firstScan: false,
    /** 语料里现存的所有会话 id，用来判断继承前缀的「原件」还在不在。 */
    knownIds: new Set(Object.keys(cache.sessions)),
  }
  state.generatedAt = state.cache.generatedAt
  state.aggregate = aggregate(Object.values(state.cache.sessions), Date.now(), state.knownIds)

  const rebuild = () => {
    state.aggregate = aggregate(Object.values(state.cache.sessions), Date.now(), state.knownIds)
    return state.aggregate
  }

  const scan = async (reason) => {
    if (state.inflight) return state.inflight
    state.inflight = (async () => {
      const startedAt = Date.now()
      state.firstScan = Object.keys(state.cache.sessions).length === 0 || state.cache.complete === false
      state.scanning = true
      try {
        const records = await ctx.sessionQuery.listSessions()
        const ids = new Set()
        for (const record of records) {
          const id = record && record.header && record.header.id
          if (id !== undefined) ids.add(String(id))
        }
        // 会话被删掉/归档到别处时，旧 fold 会污染总数，这里同步剔除。
        for (const id of Object.keys(state.cache.sessions)) {
          if (!ids.has(id)) delete state.cache.sessions[id]
        }
        state.knownIds = ids
        rebuild()

        const pending = []
        for (const record of records) {
          const id = record && record.header && record.header.id
          if (id === undefined) continue
          const sessionId = String(id)
          const cached = state.cache.sessions[sessionId]
          // 只有「活着的会话」（可能还在追加）或「从没折过的会话」需要读日志：
          // 已经落盘且不在运行的会话，日志不会再变，缓存就是它的全部真相。
          if (record.live || !cached || !cached.complete) pending.push({ id: sessionId, live: Boolean(record.live) })
        }
        pending.sort((left, right) => Number(right.live) - Number(left.live))

        /** 埋点：readSession（宿主内部解压+解析）与本插件 fold 分开计时，写 timing.log。 */
        const stats = { read: 0, readMs: 0, foldMs: 0, events: 0 }
        state.progress = { done: 0, total: pending.length }
        // 并行读几个会话（zstd 解压 + JSON 解析有 I/O 成分，串行会让冷启动白等），
        // 同时每 4 个会话才重建一次聚合，避免 O(n²) 的重复合并。
        const CONCURRENCY = Math.min(8, Math.max(1, pending.length))
        let cursor = 0
        let done = 0
        const worker = async () => {
          for (;;) {
            const index = cursor
            cursor += 1
            if (index >= pending.length) return
            const target = pending[index]
            try {
              const _t0 = Date.now()
              const snapshot = await ctx.sessionQuery.readSession(target.id)
              const _t1 = Date.now()
              state.cache.sessions[target.id] = foldSnapshot(snapshot)
              stats.read += 1
              stats.readMs += _t1 - _t0
              stats.foldMs += Date.now() - _t1
              stats.events += Array.isArray(snapshot && snapshot.events) ? snapshot.events.length : 0
              delete state.errors[target.id]
            } catch (error) {
              state.errors[target.id] = error && error.message ? String(error.message) : String(error)
              console.warn(
                `[dsh-profile-stats] 会话 ${target.id} 折叠失败：`,
                error && error.message ? error.message : error,
              )
            }
            done += 1
            state.progress = { done, total: pending.length }
            if (done % 4 === 0) rebuild()
            // 每 16 个会话落一次盘：首次全量扫描被打断（关应用/崩溃）时，
            // 下次启动只需补扫剩下的部分，不必从头再来。
            if (done % 16 === 0) {
              state.cache.generatedAt = Date.now()
              if (state.firstScan) state.cache.complete = false
              writeCache(state.cache)
            }
            await yieldToLoop()
          }
        }
        await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))

          // 把「到底慢在哪」记成一行：readSession 是宿主服务内部的解压+解析，fold 是本插件自己。
          if (stats.read > 0) {
            const line = `[${new Date().toISOString()}] reason=${reason} sessions=${stats.read} events=${stats.events} readSession=${stats.readMs}ms fold=${stats.foldMs}ms total=${Date.now() - startedAt}ms concurrency=${CONCURRENCY}
`
            try {
              appendFileSync(path.join(dshHome(), 'dsh-profile-stats', 'timing.log'), line)
            } catch {
              /* 日志写不进去不影响扫描 */
            }
          }
        state.generatedAt = Date.now()
        state.cache.generatedAt = state.generatedAt
        state.cache.complete = true
        writeCache(state.cache)
        rebuild()
        console.info(
          `[dsh-profile-stats] 扫描完成（${reason}）：会话 ${records.length} 个，重读 ${pending.length} 个，`
          + `失败 ${Object.keys(state.errors).length} 个，用时 ${Date.now() - startedAt}ms`,
        )
      } catch (error) {
        console.warn('[dsh-profile-stats] 扫描失败：', error && error.message ? error.message : error)
      } finally {
        state.scanning = false
        state.firstScan = false
        state.progress = { done: 0, total: 0 }
        state.inflight = null
      }
    })()
    return state.inflight
  }

  /**
   * 何时补扫：
   *   'forced'     点刷新按钮——15 秒内刚扫过就不重复烧磁盘
   *   'view'       页面读快照——快照超过 60 秒就静默补扫
   *   'background' 宿主启动与每分钟的保鲜检查——快照超过 5 分钟（或从没扫过）就静默补扫
   */
  const kick = (reason) => {
    const age = Date.now() - state.generatedAt
    if (reason === 'forced') {
      if (age < 15000) return
    } else {
      // 缓存不完整（首次全量扫描被打断）也算「冷」：立刻补扫，别等 5 分钟的保鲜窗口。
      const cold = Object.keys(state.cache.sessions).length === 0 || state.cache.complete === false
      const staleAfter = reason === 'view' ? VIEW_STALE_MS : BACKGROUND_STALE_MS
      if (!cold && age <= staleAfter) return
      if (Date.now() - state.lastKick < 5000) return
    }
    state.lastKick = Date.now()
    scan(reason).catch(() => {})
  }

  const identity = () => {
    let user = ''
    let host = ''
    try {
      user = os.userInfo().username || ''
    } catch {
      user = ''
    }
    try {
      host = os.hostname()
    } catch {
      host = ''
    }
    // 优先级：profile.json 覆盖 → 系统账户名 → 兜底文案。
    const override = readIdentityOverride()
    const fallbackName = user || 'DSH 用户'
    const name = (override && override.name) || fallbackName
    const handle = (override && override.handle) || `@${(user || 'local').toLowerCase().replace(/\s+/g, '')}`
    const avatar = String((override && override.avatar) || name || 'D').trim().charAt(0).toUpperCase() || 'D'
    return { name, handle, avatar, source: override ? 'file' : 'os', host, file: identityFile() }
  }

  /* ---------------------------------------------------------- 版本检查与升级 */

  const updateState = {
    installed: readOwnVersion(),
    latest: '',
    available: false,
    canUpdate: false,
    source: '',
    checking: false,
    checkedAt: 0,
    running: false,
    lastResult: null,
  }
  try {
    const raw = JSON.parse(fs.readFileSync(updateResultFile(), 'utf8'))
    if (raw && typeof raw === 'object') updateState.lastResult = raw
  } catch {
    /* 没有上一次的更新结果 */
  }

  const updateInfo = () => {
    // 升级结果是「重装之后」才写盘的，新实例启动时读不到；这里按需补读一次。
    if (!updateState.lastResult) {
      try {
        const raw = JSON.parse(fs.readFileSync(updateResultFile(), 'utf8'))
        if (raw && typeof raw === 'object') updateState.lastResult = raw
      } catch {
        /* 还没有升级结果 */
      }
    }
    return {
    installed: updateState.installed,
    latest: updateState.latest,
    available: updateState.available,
    canUpdate: updateState.canUpdate,
    checking: updateState.checking,
    running: updateState.running,
      lastResult: updateState.lastResult,
    }
  }

  const readInstalledFromManager = async (manager) => {
    try {
      const bundles = await manager.listBundles()
      const mine = Array.isArray(bundles) ? bundles.find((bundle) => bundle && bundle.name === SELF_NAME) : null
      if (!mine) return
      if (mine.version) updateState.installed = String(mine.version)
      updateState.source = mine.source === undefined || mine.source === null ? '' : String(mine.source)
      // 只有从 registry 装的才能被进程内升级；link/git/tarball 一律不动。
      updateState.canUpdate = mine.installed === true && isRegistrySpec(updateState.source)
    } catch (error) {
      console.warn('[dsh-profile-stats] 读取安装信息失败：', error && error.message ? error.message : error)
    }
  }

  /** 问一次 registry 上的 latest（6 小时缓存，失败静默）。 */
  const refreshUpdateInfo = async (force) => {
    if (updateState.checking || updateState.running) return
    if (!force && Date.now() - updateState.checkedAt < UPDATE_CHECK_TTL_MS) return
    const manager = ctx.get('pluginManager')
    if (!manager || typeof manager.listBundles !== 'function') return
    updateState.checking = true
    try {
      await readInstalledFromManager(manager)
      // 不用 pluginManager.inspect：它对「已安装的包」一律返回 already-installed，
      // 问不出 registry 上的最新版本。这里直接读 registry 的 /<name>/latest。
      const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(SELF_NAME)}/latest`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      })
      if (response.ok) {
        const payload = await response.json()
        if (payload && typeof payload.version === 'string') {
          updateState.latest = payload.version
          updateState.available =
            updateState.canUpdate && compareVersions(updateState.latest, updateState.installed) > 0
        }
      }
      updateState.checkedAt = Date.now()
    } catch (error) {
      console.warn('[dsh-profile-stats] 版本检查失败：', error && error.message ? error.message : error)
    } finally {
      updateState.checking = false
    }
  }

  /**
   * 一键升级：removeBundle → installBundle。
   * 先答复请求、再延迟执行——否则 removeBundle 会在我们自己的调用栈里等自己卸载，
   * 路由先被拆掉，请求永远拿不到响应。
   */
  const startUpdate = () => {
    const manager = ctx.get('pluginManager')
    const target = updateState.latest
    if (!manager || typeof manager.removeBundle !== 'function' || typeof manager.installBundle !== 'function') {
      return { ok: false, error: 'manager-unavailable' }
    }
    if (!updateState.canUpdate) return { ok: false, error: 'not-registry-install' }
    if (!target) return { ok: false, error: 'no-target' }
    // 防重入：连点两次曾经会并发跑两轮 removeBundle → installBundle，第二轮卸掉刚装好的包。
    if (updateState.running) return { ok: false, error: 'in-progress', target }
    if (compareVersions(target, updateState.installed) <= 0) return { ok: false, error: 'up-to-date' }

    updateState.running = true
    setTimeout(async () => {
      const result = {
        target,
        from: updateState.installed,
        at: Date.now(),
        ok: false,
        step: 'remove',
        error: null,
      }
      try {
        const removed = await manager.removeBundle(SELF_NAME)
        result.remove = removed && removed.application
        result.step = 'install'
        const installed = await manager.installBundle(`${SELF_NAME}@${target}`, { saveExact: true, enabled: true })
        result.install = installed && installed.application
        result.version = installed && installed.version
        result.ok = Boolean(installed) && installed.application !== 'failed'
      } catch (error) {
        result.error = error && error.message ? String(error.message) : String(error)
      }
      try {
        const file = updateResultFile()
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, JSON.stringify(result))
      } catch {
        /* 结果文件写不了不影响升级本身 */
      }
      // 失败时放开重入锁，让用户能再试一次；成功时保持锁定（本模块马上会被卸载）。
      if (!result.ok) updateState.running = false
    }, 400)
    return { ok: true, target }
  }

  const snapshotBody = () => {
    const agg = state.aggregate || rebuild()
    return {
      ok: true,
      generatedAt: state.generatedAt,
      scanning: state.scanning,
      /** 正在进行的是首次全量扫描（数字还不完整）；后台保鲜补扫为 false，页面不必提示。 */
      firstScan: state.scanning && state.firstScan,
      progress: state.progress,
      identity: identity(),
      update: updateInfo(),
      aliases: readAliases(),
      totals: agg.totals,
      daily: agg.daily,
      projects: agg.projects || {},
      failedSessions: Object.keys(state.errors).length,
    }
  }

  return { state, scan, kick, snapshotBody, identity, updateInfo, refreshUpdateInfo, startUpdate }
}

/* ------------------------------------------------------------------ 插件本体 */

export function apply(ctx) {
  const controller = createController(ctx)
  const { state, kick, snapshotBody, startUpdate, refreshUpdateInfo } = controller

  const sendJson = (res, status, payload) => {
    const body = JSON.stringify(payload)
    res.statusCode = status
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.setHeader('content-length', Buffer.byteLength(body))
    res.end(body)
  }

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: SNAPSHOT_PATH,
      handler: (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
          return
        }
        // 先回当前快照（可能略旧），再在后台补扫，页面永远不用等一次全量扫描。
        kick('view')
        sendJson(res, 200, snapshotBody())
      },
    }),
  )

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: REFRESH_PATH,
      handler: (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
          return
        }
        kick('forced')
        sendJson(res, 200, { ok: true, accepted: true, scanning: state.scanning })
      },
    }),
  )

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: ALIAS_PATH,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
          return
        }
        let body
        try {
          body = await readJsonBody(req, ALIAS_BODY_LIMIT)
        } catch (error) {
          sendJson(res, error && error.code === 'too-large' ? 413 : 400, { ok: false, error: error && error.code === 'too-large' ? 'too-large' : 'invalid-json' })
          return
        }
        try {
          const result = writeAlias(body && body.provider, body && body.name)
          sendJson(res, result.ok ? 200 : 400, result)
        } catch (error) {
          sendJson(res, 500, { ok: false, error: 'write-failed', message: error && error.message ? error.message : String(error) })
        }
      },
    }),
  )

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: UPDATE_PATH,
      handler: (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
          return
        }
        sendJson(res, 200, startUpdate())
      },
    }),
  )

  // 冷启动就把扫描排上，之后每分钟做一次保鲜检查：用户打开页面时数据已经是新的，不用等扫描。
  ctx.effect(() => {
    const timer = setTimeout(() => kick('background'), 1500)
    const ticker = setInterval(() => kick('background'), BACKGROUND_CHECK_MS)
    const updateTimer = setTimeout(() => {
      refreshUpdateInfo(false).catch(() => {})
    }, 4000)
    return () => {
      clearTimeout(timer)
      clearInterval(ticker)
      clearTimeout(updateTimer)
    }
  })
}

/* ---------------------------------------------------------------- 测试导出面 */
/*
 * 下面这些是纯函数/纯读写，插件运行时只用 `apply` / `inject`；导出它们是为了让
 * `test/` 下的 node:test 用例能直接调用，不必启动宿主，也不必复制一份实现。
 * 新增/修改统计口径时，必须同时在 test/ 里改断言。
 */
export {
  CACHE_VERSION,
  toNumber,
  localDayKey,
  dayIndex,
  shiftDayKey,
  nextDayKey,
  emptyFold,
  projectOf,
  sanitizeAliases,
  readAliases,
  writeAlias,
  usageParts,
  stepTokens,
  usageMismatch,
  providerOf,
  normalizeModelId,
  modelFamilyOf,
  applyEvent,
  foldSnapshot,
  computeStreaks,
  aggregate,
  readCache,
  writeCache,
  readOwnVersion,
  compareVersions,
  isRegistrySpec,
}
