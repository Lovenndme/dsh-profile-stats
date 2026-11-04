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
 * 浏览器半区通过两个只读 GET 路由取数：
 *   GET  /api/dsh-profile-stats/snapshot  当前快照（扫描中也会返回进度）
 *   POST /api/dsh-profile-stats/refresh   强制后台重扫（页面打开/点刷新时用）
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const inject = ['webServer', 'sessionQuery']

const SNAPSHOT_PATH = '/api/dsh-profile-stats/snapshot'
const REFRESH_PATH = '/api/dsh-profile-stats/refresh'
const UPDATE_PATH = '/api/dsh-profile-stats/update'

/** 本插件自己的包名 / 目录（用于读自身版本、给 pluginManager 传 spec）。 */
const SELF_NAME = 'dsh-profile-stats'
const SELF_DIR = path.dirname(fileURLToPath(import.meta.url))
/** 版本检查的缓存时长：打开面板最多每 6 小时问一次 registry。 */
const UPDATE_CHECK_TTL_MS = 6 * 60 * 60 * 1000

/**
 * 缓存结构版本：折叠口径变了就 +1，旧缓存整份丢弃重折。
 * 12：继承前缀补记 provider / 每日 input·output·cache 明细（孤儿前缀补回时用它自己的数）。
 */
const CACHE_VERSION = 12
const DAY_MS = 86400000
/** 打开页面时如果快照比这个更旧，就顺手在后台重扫。 */
const STALE_AFTER_MS = 5 * 60 * 1000

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

/** 'YYYY-MM-DD' → UTC 毫秒（只用来做日期间隔算术，不受时区影响）。 */
function dayIndex(key) {
  const parts = key.split('-')
  if (parts.length !== 3) return Number.NaN
  return Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
}

function nextDayKey(key) {
  const index = dayIndex(key)
  if (!Number.isFinite(index)) return ''
  return localDayKey(index + DAY_MS)
}

function yieldToLoop() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/* -------------------------------------------------------------- 单个会话折叠 */

function emptyFold(sessionId, createdAt, parentSession) {
  return {
    sessionId,
    seq: -1,
    createdAt: toNumber(createdAt),
    /** 头部记下的来源会话（fork/seed 时存在），用来判断继承前缀有没有「原件」。 */
    parentSession: parentSession ? String(parentSession) : '',
    calls: 0,
    tokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    maxStepTokens: 0,
    longestTurnMs: 0,
    perDay: {},
    perDayCalls: {},
    perDayInput: {},
    perDayOutput: {},
    perDayCache: {},
    /** 按 provider 拆的用量（wincode / arkcli-coding-plan / myapi …），用于和网关账单对账。 */
    perProvider: {},
    perDayProvider: {},
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
    inheritedPerDayInput: {},
    inheritedPerDayOutput: {},
    inheritedPerDayCache: {},
    complete: false,
  }
}

/**
 * 一次模型调用的 token 数。`totalTokens` 由 provider 直接给，优先用它；缺失或
 * 小于输入+输出（个别适配器只填部分字段）时退回输入+输出。
 */
function stepTokens(usage) {
  const input = toNumber(usage.inputTokens)
  const output = toNumber(usage.outputTokens)
  const total = toNumber(usage.totalTokens)
  return Math.max(total, input + output)
}

/** 这一步是谁服务的（wincode / arkcli-coding-plan / myapi …），用于和网关账单对账。 */
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
      const tokens = stepTokens(usage)
      fold.calls += 1
      fold.tokens += tokens
      fold.inputTokens += toNumber(usage.inputTokens)
      fold.outputTokens += toNumber(usage.outputTokens)
      fold.cacheReadTokens += toNumber(usage.cacheReadTokens)
      fold.cacheWriteTokens += toNumber(usage.cacheWriteTokens)
      if (tokens > fold.maxStepTokens) fold.maxStepTokens = tokens
      const modelFamily = modelFamilyOf(event)
      fold.perModel[modelFamily] = toNumber(fold.perModel[modelFamily]) + tokens
      if (time > 0) {
        const key = localDayKey(time)
        if (key) {
          fold.perDay[key] = toNumber(fold.perDay[key]) + tokens
          fold.perDayCalls[key] = toNumber(fold.perDayCalls[key]) + 1
          fold.perDayInput[key] = toNumber(fold.perDayInput[key]) + toNumber(usage.inputTokens)
          fold.perDayOutput[key] = toNumber(fold.perDayOutput[key]) + toNumber(usage.outputTokens)
          fold.perDayCache[key] =
            toNumber(fold.perDayCache[key]) + toNumber(usage.cacheReadTokens) + toNumber(usage.cacheWriteTokens)
          const provider = providerOf(event)
          fold.perProvider[provider] = toNumber(fold.perProvider[provider]) + tokens
          const day = fold.perDayProvider[key] || {}
          day[provider] = toNumber(day[provider]) + tokens
          fold.perDayProvider[key] = day
          const modelDay = fold.perDayModel[key] || {}
          modelDay[modelFamily] = toNumber(modelDay[modelFamily]) + tokens
          fold.perDayModel[key] = modelDay
        }
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
  const events = (snapshot && snapshot.events) || []
  for (const event of events) {
    const seq = toNumber(event.seq)
    if (seq < inherited) {
      // 继承前缀：只累加用量，不进任务用时/首末时间。
      const usage = event.type === 'assistant/message' && event.data ? event.data.usage : undefined
      if (usage) {
        const tokens = stepTokens(usage)
        fold.inheritedTokens += tokens
        fold.inheritedCalls += 1
        fold.inheritedInputTokens += toNumber(usage.inputTokens)
        fold.inheritedOutputTokens += toNumber(usage.outputTokens)
        fold.inheritedCacheReadTokens += toNumber(usage.cacheReadTokens)
        fold.inheritedCacheWriteTokens += toNumber(usage.cacheWriteTokens)
        const time = toNumber(event.time)
        const inheritedModelFamily = modelFamilyOf(event)
        fold.inheritedPerModel[inheritedModelFamily] = toNumber(fold.inheritedPerModel[inheritedModelFamily]) + tokens
        if (time > 0) {
          const key = localDayKey(time)
          if (key) {
            fold.inheritedPerDay[key] = toNumber(fold.inheritedPerDay[key]) + tokens
            fold.inheritedPerDayCalls[key] = toNumber(fold.inheritedPerDayCalls[key]) + 1
            fold.inheritedPerDayInput[key] = toNumber(fold.inheritedPerDayInput[key]) + toNumber(usage.inputTokens)
            fold.inheritedPerDayOutput[key] = toNumber(fold.inheritedPerDayOutput[key]) + toNumber(usage.outputTokens)
            fold.inheritedPerDayCache[key] =
              toNumber(fold.inheritedPerDayCache[key]) + toNumber(usage.cacheReadTokens) + toNumber(usage.cacheWriteTokens)
            // provider 与主口径一致：只记有日期的步（主口径 perProvider 也在 time > 0 分支里）。
            const inheritedProvider = providerOf(event)
            fold.inheritedPerProvider[inheritedProvider] = toNumber(fold.inheritedPerProvider[inheritedProvider]) + tokens
            const inheritedDayProviders = fold.inheritedPerDayProvider[key] || {}
            inheritedDayProviders[inheritedProvider] = toNumber(inheritedDayProviders[inheritedProvider]) + tokens
            fold.inheritedPerDayProvider[key] = inheritedDayProviders
            const inheritedDayModels = fold.inheritedPerDayModel[key] || {}
            inheritedDayModels[inheritedModelFamily] = toNumber(inheritedDayModels[inheritedModelFamily]) + tokens
            fold.inheritedPerDayModel[key] = inheritedDayModels
          }
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
  const sorted = activeDays.slice().sort()
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
  const yesterday = localDayKey(now - DAY_MS)
  const active = new Set(sorted)
  let cursor = active.has(today) ? today : active.has(yesterday) ? yesterday : null
  let current = 0
  while (cursor !== null && active.has(cursor)) {
    current += 1
    const previous = localDayKey(dayIndex(cursor) - DAY_MS)
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
   * 每天一份 { tokens, calls, inputTokens, outputTokens, cacheTokens, byProvider, byModel }。
   * `maps` 里的每张表必须来自同一份来源（会话自身 或 它的继承前缀）：
   * 旧实现补回孤儿前缀时拿的是会话自身的每日明细，同一天会把自身用量算两次、前缀明细一笔不进。
   */
  const mergeDay = (maps) => {
    for (const [key, value] of Object.entries(maps.tokens || {})) {
      const tokens = toNumber(value)
      if (tokens <= 0) continue
      const entry = daily.get(key) || { tokens: 0, calls: 0, inputTokens: 0, outputTokens: 0, cacheTokens: 0, byProvider: {}, byModel: {} }
      entry.tokens += tokens
      entry.calls += toNumber(maps.calls && maps.calls[key])
      entry.inputTokens += toNumber(maps.input && maps.input[key])
      entry.outputTokens += toNumber(maps.output && maps.output[key])
      entry.cacheTokens += toNumber(maps.cache && maps.cache[key])
      for (const [provider, amount] of Object.entries((maps.providers && maps.providers[key]) || {})) {
        entry.byProvider[provider] = toNumber(entry.byProvider[provider]) + toNumber(amount)
      }
      for (const [modelFamily, amount] of Object.entries((maps.models && maps.models[key]) || {})) {
        entry.byModel[modelFamily] = toNumber(entry.byModel[modelFamily]) + toNumber(amount)
      }
      daily.set(key, entry)
    }
  }

  for (const fold of sessions) {
    totals.tokens += fold.tokens
    totals.inputTokens += fold.inputTokens
    totals.outputTokens += fold.outputTokens
    totals.cacheReadTokens += fold.cacheReadTokens
    totals.cacheWriteTokens += fold.cacheWriteTokens
    totals.calls += fold.calls
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
        mergeDay({
          tokens: fold.inheritedPerDay,
          calls: fold.inheritedPerDayCalls,
          input: fold.inheritedPerDayInput,
          output: fold.inheritedPerDayOutput,
          cache: fold.inheritedPerDayCache,
          providers: fold.inheritedPerDayProvider,
          models: fold.inheritedPerDayModel,
        })
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

    mergeDay({
      tokens: fold.perDay,
      calls: fold.perDayCalls,
      input: fold.perDayInput,
      output: fold.perDayOutput,
      cache: fold.perDayCache,
      providers: fold.perDayProvider,
      models: fold.perDayModel,
    })
  }

  const dailyList = Array.from(daily.entries())
    .map(([date, entry]) => ({
      date,
      tokens: entry.tokens,
      calls: entry.calls,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      cacheTokens: entry.cacheTokens,
      byProvider: entry.byProvider,
      byModel: entry.byModel,
    }))
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
  }
}

/* ---------------------------------------------------------------- 缓存读写 */

function readCache() {
  const empty = { version: CACHE_VERSION, generatedAt: 0, sessions: {} }
  try {
    const parsed = JSON.parse(fs.readFileSync(cacheFile(), 'utf8'))
    if (!parsed || parsed.version !== CACHE_VERSION || typeof parsed.sessions !== 'object') return empty
    return {
      version: CACHE_VERSION,
      generatedAt: toNumber(parsed.generatedAt),
      sessions: parsed.sessions,
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

/** 够用的 semver 比较：-1 / 0 / 1；同号时预发布版本低于正式版。 */
function compareVersions(left, right) {
  const parse = (value) => {
    const [core, ...rest] = String(value || '').split('-')
    const parts = core.split('.').map((piece) => Number.parseInt(piece, 10) || 0)
    return { parts, pre: rest.join('-') }
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
  return a.pre > b.pre ? 1 : -1
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

export function apply(ctx) {
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

        state.progress = { done: 0, total: pending.length }
        // 并行读几个会话（zstd 解压 + JSON 解析有 I/O 成分，串行会让冷启动白等），
        // 同时每 4 个会话才重建一次聚合，避免 O(n²) 的重复合并。
        const CONCURRENCY = Math.min(4, Math.max(1, pending.length))
        let cursor = 0
        let done = 0
        const worker = async () => {
          for (;;) {
            const index = cursor
            cursor += 1
            if (index >= pending.length) return
            const target = pending[index]
            try {
              const snapshot = await ctx.sessionQuery.readSession(target.id)
              state.cache.sessions[target.id] = foldSnapshot(snapshot)
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
              writeCache(state.cache)
            }
            await yieldToLoop()
          }
        }
        await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))

        state.generatedAt = Date.now()
        state.cache.generatedAt = state.generatedAt
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
        state.progress = { done: 0, total: 0 }
        state.inflight = null
      }
    })()
    return state.inflight
  }

  const kick = (forced) => {
    const stale = Date.now() - state.generatedAt > STALE_AFTER_MS
    const cold = Object.keys(state.cache.sessions).length === 0
    // 页面每次挂载都会 POST 一次强制刷新；刚扫过就别重复烧磁盘。
    if (forced && Date.now() - state.generatedAt < 15000) return
    if (!forced && !stale && !cold) return
    if (!forced && Date.now() - state.lastKick < 5000) return
    state.lastKick = Date.now()
    scan(forced ? 'forced' : 'stale').catch(() => {})
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
    }, 400)
    return { ok: true, target }
  }

  const snapshotBody = () => {
    const agg = state.aggregate || rebuild()
    return {
      ok: true,
      generatedAt: state.generatedAt,
      scanning: state.scanning,
      progress: state.progress,
      identity: identity(),
      update: updateInfo(),
      totals: agg.totals,
      daily: agg.daily,
      failedSessions: Object.keys(state.errors).length,
    }
  }

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
        kick(false)
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
        kick(true)
        sendJson(res, 200, { ok: true, accepted: true, scanning: state.scanning })
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

  // 冷启动就把扫描排上，第一次打开页面时通常已经能直接给数。
  ctx.effect(() => {
    const timer = setTimeout(() => kick(false), 1500)
    const updateTimer = setTimeout(() => {
      refreshUpdateInfo(false).catch(() => {})
    }, 4000)
    return () => {
      clearTimeout(timer)
      clearTimeout(updateTimer)
    }
  })
}
