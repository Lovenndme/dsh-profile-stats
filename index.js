/**
 * dsh-profile-stats — Host half.
 *
 * 把「本机所有会话日志」折叠成一份个人用量快照：
 *   · 累计 Token 数 / 输入·输出·缓存明细 / 模型调用次数
 *   · 每日 Token（GitHub 贡献图口径，本地时区）
 *   · 单日峰值、单会话峰值、单次调用峰值
 *   · 最长任务用时（同一 turn 内 turn/start → turn/end 的最大跨度）
 *   · 活跃天数、最长连续天数、当前连续天数
 *   · 每天的 token 按内容分成八类（系统提示词 / 工具定义 / 用户消息 / 注入内容 / 技能注入 / 工具调用 / 模型思考 / 模型回复）
 *
 * 数据源只有一个：`ctx.sessionQuery` 读到的会话日志（唯一真相）。这里算出来的
 * 一切都可以从日志重建，磁盘缓存只是把「已经折过的会话」记下来，避免每次打开
 * 页面都重读几十 MB 日志；缓存丢了只是慢一次，不会出现和日志不一致的数字。
 *
 * 浏览器半区只走这几个同源路由：
 *   GET  /api/dsh-profile-stats/snapshot  当前快照（扫描中也会返回进度），唯一的数据来源；带 ETag，没变时回 304
 *   POST /api/dsh-profile-stats/refresh   请求立即重扫（点刷新按钮时用；平时由后台定时保鲜）
 *   POST /api/dsh-profile-stats/update    一键升级（仅 registry 安装且有新版本时）
 *   POST /api/dsh-profile-stats/alias     改供应商的显示名
 *   POST /api/dsh-profile-stats/billing   改供应商的计费方式 / 美元汇率
 * POST 一律只接受同源请求（看 Sec-Fetch-Site / Origin），带请求体的只接受 JSON。
 */

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const inject = ['webServer', 'sessionQuery']

const SNAPSHOT_PATH = '/api/dsh-profile-stats/snapshot'
const REFRESH_PATH = '/api/dsh-profile-stats/refresh'
const UPDATE_PATH = '/api/dsh-profile-stats/update'
const ALIAS_PATH = '/api/dsh-profile-stats/alias'
const BILLING_PATH = '/api/dsh-profile-stats/billing'

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
 * 15：每天按「小时 × 供应商 × 模型」记四项用量（slots），用于按调用时间折算费用。
 * 16：会话记下折叠时是否还在运行（结束后补读一次尾巴）；只有 totalTokens 的调用记作未缓存输入；
 *     slots 键改用 \u0000 分隔；模型名归一化改为反复去后缀；继承前缀记单次峰值与最长任务；缓存记下时区。
 * 17：每天按内容分类记八类用量（mix：系统提示词 / 工具定义 / 用户消息 / 注入内容 / 技能注入 / 工具调用 / 模型思考 / 模型回复）。
 */
const CACHE_VERSION = 17
const DAY_MS = 86400000
/**
 * 数据保鲜不依赖用户打开页面：宿主运行期间每分钟看一眼，快照超过 5 分钟就在后台静默补扫；
 * 页面读快照时更在意新鲜度，超过 60 秒也顺手静默补扫一次（先回旧快照，补扫完页面自己刷新数字）。
 */
const BACKGROUND_CHECK_MS = 60 * 1000
const BACKGROUND_STALE_MS = 5 * 60 * 1000
const VIEW_STALE_MS = 60 * 1000
/** 扫描中途最多每 2 秒重算一次聚合、每 10 秒落一次缓存。 */
const REBUILD_INTERVAL_MS = 2000
const CACHE_WRITE_INTERVAL_MS = 10 * 1000
/** 缓存非空时，会话列表要连续空一分钟才当真（清空统计）。 */
const EMPTY_LISTING_GRACE_MS = 60 * 1000
/** timing.log 超过 256 KB 就换成 timing.log.1 重新开始，最多留两份。 */
const TIMING_LOG_LIMIT = 256 * 1024

/* ------------------------------------------------------------------ 基础工具 */

function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

/**
 * 日志、缓存文件、请求体里的 id 都会被拿来当普通对象的键。`__proto__` 当键时读到的是 Object.prototype，
 * addUsage 这类「读出来再改」的写法会把字段写进所有对象的原型，这里统一换成一个普通的键。
 * \u0000 是 slots 键的分隔符，也从 id 里去掉。
 */
function safeKey(id) {
  const text = String(id).replace(/\u0000/g, '')
  return text === '__proto__' ? '(__proto__)' : text
}

/** JSON.parse 会把 "__proto__" 建成自有属性，之后再拷贝就会改到原型上：读本地文件和请求体时直接丢掉这种键。 */
function parseJson(text) {
  return JSON.parse(text, (key, value) => (key === '__proto__' ? undefined : value))
}

/** 按字符（不是 UTF-16 码元）截断，免得把 emoji 这类代理对切成半个。 */
function truncateText(text, max) {
  const chars = Array.from(text)
  return chars.length > max ? chars.slice(0, max).join('') : text
}

function cacheFile() {
  return path.join(dshHome(), 'dsh-profile-stats', 'cache.json')
}

/** 扫描耗时记一行。目录还没建（第一次扫描）时先建；文件太大就轮换，不会无限增长。写不进去不影响扫描。 */
function appendTimingLog(line) {
  try {
    const file = path.join(dshHome(), 'dsh-profile-stats', 'timing.log')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    let size = 0
    try {
      size = fs.statSync(file).size
    } catch {
      size = 0
    }
    if (size > TIMING_LOG_LIMIT) fs.renameSync(file, `${file}.1`)
    fs.appendFileSync(file, line)
  } catch {
    /* 日志写不进去不影响扫描 */
  }
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
    const label = typeof name === 'string' ? truncateText(name.trim(), ALIAS_MAX_NAME) : ''
    if (!validProviderId(key) || !label) continue
    providers[key] = label
  }
  return { providers }
}

/** 能当供应商 id 存进本地文件的字符串：非空、不太长、不是 __proto__。 */
function validProviderId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= ALIAS_MAX_ID && id === safeKey(id)
}

function readAliases() {
  try {
    return sanitizeAliases(parseJson(fs.readFileSync(aliasFile(), 'utf8')))
  } catch {
    return { providers: {} }
  }
}

/**
 * 改一个供应商的显示名；名字为空串或 null 表示删掉（回到原始 id）。没带 name 字段（拼错了）不删，直接报错。
 * 先写临时文件再改名，写到一半不会留下坏文件。
 */
function writeAlias(provider, name) {
  const id = typeof provider === 'string' ? provider.trim() : ''
  if (!validProviderId(id)) return { ok: false, error: 'invalid-provider' }
  if (name !== null && typeof name !== 'string') return { ok: false, error: 'invalid-name' }
  const label = typeof name === 'string' ? truncateText(name.trim(), ALIAS_MAX_NAME) : ''
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

/**
 * 每个供应商的计费方式（只存在本机，不进仓库、不进 npm 包）：{ "providers": { "<provider id>": { mode, ... } } }。
 *   official   官方直连：花费 = 按官方价折算
 *   multiplier 按官方价打折：花费 = 官方价折算 × factor
 *   plan       包月：monthly 元 / 月，since 起（YYYY-MM-DD，可空）
 *   free       不计入（公司付费、免费额度）
 * 没设置的供应商由页面决定默认值（官方直连的 id 自动当作 official，其余只显示官方价折算）。
 * 顶层可以手写 usdCny（美元兑人民币，0.1 ~ 100），不写就用 DEFAULT_USD_CNY；页面上不改它。
 */
function billingFile() {
  return path.join(dshHome(), 'dsh-profile-stats', 'billing.json')
}

const BILLING_MODES = ['official', 'multiplier', 'plan', 'free']
const PRICE_LIMIT = 100000

/** 非负、有限、不超过上限的数；否则返回 null。 */
function priceNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= PRICE_LIMIT ? value : null
}

/** 美元兑人民币：页面把美元价换算成人民币显示。默认值是中国外汇交易中心 2026-11-06 的中间价（100 美元 = 671.68 元）。 */
const DEFAULT_USD_CNY = 6.7168

function usdRate(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0.1 && value <= 100 ? value : null
}

/** 单个供应商的计费方式：不认识的 mode 或缺字段时返回 null（等于没设置）。 */
function sanitizeBillingEntry(raw) {
  if (!raw || typeof raw !== 'object' || !BILLING_MODES.includes(raw.mode)) return null
  if (raw.mode === 'official' || raw.mode === 'free') return { mode: raw.mode }
  if (raw.mode === 'multiplier') {
    const factor = priceNumber(raw.factor)
    return factor === null || factor > 100 ? null : { mode: 'multiplier', factor }
  }
  const monthly = priceNumber(raw.monthly)
  if (monthly === null) return null
  const since = validSince(raw.since) ? raw.since : ''
  return since ? { mode: 'plan', monthly, since } : { mode: 'plan', monthly }
}

/** 包月起始日：真实存在的日历日（2026-02-31 不算），年份在 2000 ~ 2100 之间（0202 年会让月费摊出上百万）。 */
function validSince(value) {
  if (typeof value !== 'string' || !Number.isFinite(dayIndex(value))) return false
  const year = Number(value.slice(0, 4))
  return year >= 2000 && year <= 2100
}

function sanitizeBilling(raw) {
  const providers = {}
  const source = raw && typeof raw === 'object' && raw.providers && typeof raw.providers === 'object' && !Array.isArray(raw.providers) ? raw.providers : {}
  for (const [id, entry] of Object.entries(source)) {
    if (Object.keys(providers).length >= ALIAS_MAX_COUNT) break
    const key = String(id).trim()
    const clean = sanitizeBillingEntry(entry)
    if (!validProviderId(key) || !clean) continue
    providers[key] = clean
  }
  const rate = raw && typeof raw === 'object' ? usdRate(raw.usdCny) : null
  return rate === null ? { providers } : { providers, usdCny: rate }
}

function readBilling() {
  try {
    return sanitizeBilling(parseJson(fs.readFileSync(billingFile(), 'utf8')))
  } catch {
    return { providers: {} }
  }
}

function saveBilling(next) {
  const file = billingFile()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`)
  fs.renameSync(temporary, file)
}

/**
 * 改一个供应商的计费方式；billing 为 null 表示删掉（回到默认），没带这个字段（拼错了）不删、直接报错。
 * 读文件时坏数据静默丢掉；写的时候不行：倍数 / 月费超上限、起始日不存在，都整条拒绝，
 * 免得页面以为存上了。写法同 writeAlias：先写临时文件再改名。
 */
function writeBilling(provider, billing) {
  const id = typeof provider === 'string' ? provider.trim() : ''
  if (!validProviderId(id)) return { ok: false, error: 'invalid-provider' }
  if (billing === undefined) return { ok: false, error: 'invalid-billing' }
  const current = readBilling()
  if (billing === null) delete current.providers[id]
  else {
    const clean = sanitizeBillingEntry(billing)
    if (!clean) return { ok: false, error: 'invalid-billing' }
    if (clean.mode === 'plan' && billing.since !== undefined && billing.since !== null && billing.since !== '' && !clean.since) {
      return { ok: false, error: 'invalid-since' }
    }
    current.providers[id] = clean
  }
  const next = sanitizeBilling(current)
  if (billing && !next.providers[id]) return { ok: false, error: 'too-many' }
  saveBilling(next)
  return { ok: true, billing: next }
}

/* ---------------------------------------------------------------- 价格表 */

/**
 * prices.json（tools/update-prices.mjs 从 LiteLLM 的公开价格表生成，MIT）：各厂商直供对话模型的美元价。
 * 只在第一次用到时读一次；读不到就当没有（页面把这些模型算「未定价」）。
 */
let priceTable = null
function loadPriceTable() {
  if (priceTable) return priceTable
  try {
    const parsed = parseJson(fs.readFileSync(path.join(SELF_DIR, 'prices.json'), 'utf8'))
    const models = parsed && parsed.models && typeof parsed.models === 'object' ? parsed.models : {}
    priceTable = { fetchedAt: typeof parsed.fetchedAt === 'string' ? parsed.fetchedAt : '', models }
  } catch {
    priceTable = { fetchedAt: '', models: {} }
  }
  return priceTable
}

/**
 * 中转站常在模型名后面加的推理档位后缀；价格表里没有时退回基础模型的价格。
 * 不含 -fast / -free / -online / -search：这些通常是另一档价格（快速档更贵、联网另收费），按基础价算会算错，宁可算未定价。
 */
const MODEL_VARIANTS = /-(thinking|reasoning|non-reasoning|high|medium|low|minimal|nothink|no-think)$/

/**
 * 价格表里能用的一行：输入、输出是非负数。输入、输出都是 0 时只有四项全 0 才算（生成器只给官方标明免费的模型这么写）；
 * [0, 0, null, null] 是上游还没定价的占位，当未定价，不能当免费。
 */
function usablePriceRow(row) {
  if (!Array.isArray(row) || row.length < 2 || !row.slice(0, 2).every((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0)) return false
  return row[0] > 0 || row[1] > 0 || (row[2] === 0 && row[3] === 0)
}

/** 模型 → 价格表里的一行 [输入, 输出, 缓存读, 缓存写]（美元 / 百万 token）；找不到返回 null。 */
function priceRowOf(model, table) {
  const models = (table || loadPriceTable()).models
  let id = String(model || '')
  for (let attempt = 0; attempt < 3 && id; attempt += 1) {
    const row = Object.prototype.hasOwnProperty.call(models, id) ? models[id] : null
    if (usablePriceRow(row)) return row
    if (!MODEL_VARIANTS.test(id)) break
    id = id.replace(MODEL_VARIANTS, '')
  }
  return null
}

/** 快照里只带上用到的模型的价格，免得每次都发整张表。 */
function pricesFor(daily, table) {
  const used = new Set()
  for (const entry of daily || []) for (const slot of entry.slots || []) used.add(slot[2])
  const models = {}
  for (const model of used) {
    const row = priceRowOf(model, table)
    if (row) models[model] = row
  }
  const source = table || loadPriceTable()
  return { currency: 'USD', unit: 'per 1M tokens', fetchedAt: source.fetchedAt, defaultUsdCny: DEFAULT_USD_CNY, models }
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
  return text ? parseJson(text) : {}
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
  return { key: safeKey(windows ? display.replace(/\\/g, '/').toLowerCase() : display), path: display }
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
    /** 折叠时会话还在运行：日志之后还会追加，会话结束后要再读一次，补上最后一次扫描之后的那段。 */
    live: false,
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
    /** 继承前缀里的单次调用峰值与最长任务：孤儿前缀补回总量时，峰值记录也要跟着补。 */
    inheritedMaxStepTokens: 0,
    inheritedLongestTurnMs: 0,
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
 * 一步记账用的四项。四项都没有、只给了 totalTokens 时，把总量记作未缓存输入：
 * 否则总量里有它、各项明细与 slots 里没有，费用按 0 算还不提示未定价。
 */
function stepParts(usage) {
  const parts = usageParts(usage)
  if (partsSum(parts) === 0) parts.inputTokens = Math.max(0, toNumber(usage && usage.totalTokens))
  return parts
}

/**
 * 一次模型调用的 token 数 = 未缓存输入 + 缓存读 + 缓存写 + 输出。
 * 不再以 totalTokens 为准：2026-08 ~ 09 的旧版 DSH 日志里有的步骤没写它，旧实现退回「输入 + 输出」，
 * 把缓存整块漏掉了。四项都没有时才用 totalTokens（见 stepParts）。
 */
function stepTokens(usage) {
  return partsSum(stepParts(usage))
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
      slots: map('inheritedPerDaySlots'),
      mix: map('inheritedPerDayMix'),
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
    slots: map('perDaySlots'),
    mix: map('perDayMix'),
    models: map('perDayModel'),
  }
}

/** slots 键的分隔符。供应商、模型、项目路径里都可能有「|」，\u0000 不会出现在这些名字里（safeKey 也会去掉）。 */
const SLOT_SEP = '\u0000'

/**
 * 一步记进某一天。slots 再按「UTC 小时序号 × 供应商 × 模型」记四项用量：价格按调用时间选
 * （DeepSeek 分高峰 / 空闲时段、会调价），时段边界都在整点，存到小时就够，页面现算费用、改价不用重扫。
 */
function addStepToDay(maps, key, parts, tokens, provider, modelFamily, time, mix) {
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
  const slots = maps.slots[key] || (maps.slots[key] = {})
  const slotKey = `${Math.floor(toNumber(time) / 3600000)}${SLOT_SEP}${provider}${SLOT_SEP}${modelFamily}`
  const slot = slots[slotKey] || (slots[slotKey] = [0, 0, 0, 0])
  slot[0] += parts.inputTokens
  slot[1] += parts.cacheReadTokens
  slot[2] += parts.cacheWriteTokens
  slot[3] += parts.outputTokens
  if (Array.isArray(mix)) {
    const sum = maps.mix[key] || (maps.mix[key] = MIX_KEYS.map(() => 0))
    for (let index = 0; index < MIX_KEYS.length; index += 1) sum[index] += toNumber(mix[index])
  }
}

/** 这一步是谁服务的（deepseek-official / deepseek-account …），用于和网关账单对账。 */
function providerOf(event) {
  const source = event && event.data && event.data.message && event.data.message.source
  const provider = source && typeof source.provider === 'string' ? safeKey(source.provider.trim()) : ''
  return provider || 'unknown'
}

/** 尾部的日期 / 快照 / 渠道噪音：2024-08-06、20250929、261017、0613、-latest、-preview。 */
const MODEL_NOISE = [/-\d{4}-\d{2}-\d{2}$/, /-\d{6,8}$/, /-\d{4}$/, /-(latest|preview|stable|exp)$/]
/** 尾部的版本号：只有去掉后还剩数字时才去（deepseek-v3 去掉 -v3 就只剩 deepseek，会和 v4 混成一个）。 */
const MODEL_VERSION_TAG = /-v\d+$/

/**
 * 模型 id 归一化：把中转站常见的写法差异（前缀、点/下划线、日期快照后缀）抹平，
 * 让同一个模型的多种写法落到同一个 family 上。例如
 *   deepseek-v4-1-flash-261017 / deepseek-v4.1-flash / DeepSeek-V4-1-Flash
 * 都归一成 deepseek-v4-1-flash。
 *   - 「厂商/模型」「平台/厂商/模型」只取最后一段（openai/gpt-4o、deepseek-ai/DeepSeek-V3）；
 *   - 末尾的推理档位（-thinking、-high …）先摘下来，去完噪音再接回去：
 *     claude-sonnet-4-5-20250929-thinking → claude-sonnet-4-5-thinking；
 *   - 噪音反复去到不再变化：kimi-k2-0905-preview → kimi-k2，不会因为顺序固定而停在 kimi-k2-0905。
 */
function normalizeModelId(raw) {
  let id = String(raw || '').trim().toLowerCase()
  if (!id) return ''
  id = id.slice(id.lastIndexOf('/') + 1)
  id = id.replace(/^(openai|anthropic|google|azure|aliyun|zhipu|baidu|moonshot):/, '')
  // 点、下划线、空白统一成分隔符
  id = id.replace(/[._\s]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  let variant = ''
  const tail = id.match(MODEL_VARIANTS)
  if (tail && tail.index > 0) {
    variant = tail[0]
    id = id.slice(0, tail.index)
  }
  for (;;) {
    let next = id
    for (const pattern of MODEL_NOISE) next = next.replace(pattern, '')
    const unversioned = next.replace(MODEL_VERSION_TAG, '')
    if (/\d/.test(unversioned)) next = unversioned
    if (next === id || !next) break
    id = next
  }
  return safeKey(id + variant)
}

/** 这一步实际用的模型族（模型 id 归一化后的结果，原样作为统计键）。 */
function modelFamilyOf(event) {
  const source = event && event.data && event.data.message && event.data.message.source
  const raw = source && typeof source.model === 'string' ? source.model : ''
  return normalizeModelId(raw) || 'unknown'
}

/* ------------------------------------------------------------ Token 统计（按内容分类） */

/**
 * 每一步的 token 按「花在什么内容上」分成八类（页面的 Token 统计）：
 *   system 系统提示词 · tools 工具定义 · user 用户消息 · inject 注入内容 · skill 技能注入 ·
 *   toolCalls 工具调用（调用的名称与参数 + 工具返回的结果）· thinking 模型思考 · answers 模型回复
 * 供应商只报每一步的四项用量，不报这八类。这里的做法（设计取自 dsh-context，见 FINDINGS 的设计参考）：
 *   1. 跟着日志重建「这一步发出去的上下文」里每一类有多少，用固定密度估算（4 个字符 ≈ 1 token）；
 *   2. 这一步的输入（未缓存 + 缓存读 + 缓存写）按上下文里各类的估算值比例分摊；
 *   3. 这一步的输出按它自己生成的思考 / 回复 / 工具调用分摊（供应商报了 reasoningTokens 就用它）。
 * 分摊用最大余数法取整，八类之和恰好等于这一步的 token 数：估算只决定比例，总量仍是日志里的数。
 */
const MIX_KEYS = ['system', 'tools', 'user', 'inject', 'skill', 'toolCalls', 'thinking', 'answers']
const MIX_INDEX = Object.fromEntries(MIX_KEYS.map((key, index) => [key, index]))
const CHARS_PER_TOKEN = 4
const ROLE_OVERHEAD = 4
const BLOCK_OVERHEAD = 4
const charTokens = (length) => Math.ceil(toNumber(length) / CHARS_PER_TOKEN)
/**
 * 图片按尺寸估：切成 42px 的格子（14px 的块、3 倍下采样），每行多一个换行位，再加首尾两个；
 * 小图先放大到 544 × 544 的面积，一张图封顶 1024。日志里没有尺寸时按引用的 JSON 长度估，同样封顶。
 */
const IMAGE_TOKENS_MAX = 1024
const IMAGE_CELL = 42
const IMAGE_MIN_PIXELS = 544 * 544

function estimateImage(block) {
  const ref = block && block.attachment && typeof block.attachment === 'object' ? block.attachment : null
  const width = ref ? toNumber(ref.width) : 0
  const height = ref ? toNumber(ref.height) : 0
  if (!(width > 0) || !(height > 0)) return Math.min(IMAGE_TOKENS_MAX, charTokens(jsonLength(block)))
  const scale = Math.max(1, Math.sqrt(IMAGE_MIN_PIXELS / (width * height)))
  const rows = Math.ceil((height * scale) / IMAGE_CELL)
  const columns = Math.ceil((width * scale) / IMAGE_CELL)
  return Math.min(IMAGE_TOKENS_MAX, rows * (columns + 1) + 2)
}


function jsonLength(value) {
  try {
    const text = JSON.stringify(value)
    return typeof text === 'string' ? text.length : 0
  } catch {
    return 0
  }
}

/** 一个内容块的估算值，以及它算哪一种（reasoning / text / tool-call，其余是 other）。 */
function blockEstimate(block) {
  if (!block || typeof block !== 'object') return { kind: 'other', tokens: BLOCK_OVERHEAD }
  const text = typeof block.text === 'string' ? block.text : ''
  if (block.type === 'text') return { kind: 'text', tokens: charTokens(text.length) + BLOCK_OVERHEAD }
  if (block.type === 'reasoning') return { kind: 'reasoning', tokens: charTokens(text.length) + BLOCK_OVERHEAD }
  if (block.type === 'tool-call') {
    const name = typeof block.name === 'string' ? block.name : ''
    const args = typeof block.arguments === 'string' ? block.arguments : ''
    return { kind: 'tool-call', tokens: charTokens(name.length) + charTokens(args.length) + BLOCK_OVERHEAD }
  }
  if (block.type === 'image') return { kind: 'other', tokens: estimateImage(block) + BLOCK_OVERHEAD }
  return { kind: 'other', tokens: charTokens(jsonLength(block)) + BLOCK_OVERHEAD }
}

/** 一条消息的估算：{ tokens（含角色开销）, reasoning, answers, calls }。没有内容的消息是 0。 */
function estimateMessage(message) {
  const blocks = message && Array.isArray(message.content) ? message.content : []
  const out = { tokens: 0, reasoning: 0, answers: 0, calls: 0 }
  if (!blocks.length) return out
  for (const block of blocks) {
    const part = blockEstimate(block)
    out.tokens += part.tokens
    if (part.kind === 'reasoning') out.reasoning += part.tokens
    else if (part.kind === 'text') out.answers += part.tokens
    else if (part.kind === 'tool-call') out.calls += part.tokens
  }
  out.tokens += ROLE_OVERHEAD
  return out
}

/** 系统提示词：文字块量字符数，其余块量 JSON 长度，合起来再加一次角色开销。 */
function estimateSystem(message) {
  const blocks = message && Array.isArray(message.content) ? message.content : []
  if (!blocks.length) return 0
  let characters = 0
  for (const block of blocks) {
    characters += block && block.type === 'text' && typeof block.text === 'string' ? block.text.length : jsonLength(block)
  }
  return charTokens(characters) + ROLE_OVERHEAD
}

/** 工具定义：请求头里整份工具清单（名称、描述、参数 schema）的 JSON 长度。 */
function estimateTools(tools) {
  return Array.isArray(tools) && tools.length ? charTokens(jsonLength(tools)) + BLOCK_OVERHEAD : 0
}

/** 事件里的消息：assistant / tool / system / developer 在 data.message，user 直接在 data 上。 */
function eventMessage(data) {
  if (data && data.message && typeof data.message === 'object') return data.message
  return data && Array.isArray(data.content) ? data : null
}

/** 用户消息这一侧的分类：技能目录 / 技能调用算技能注入；来源不是用户本人的（或带 form 的）算注入内容。 */
function messageCategory(type, source) {
  if (type === 'developer/message') return 'inject'
  const kind = source && typeof source.kind === 'string' ? source.kind : ''
  if (kind === 'skill-invocation' || kind === 'skill-catalog') return 'skill'
  if ((kind && kind !== 'user') || (source && typeof source.form === 'string')) return 'inject'
  return 'user'
}

const SKILL_CONTENT = /<skill_content\s+name="[^"]+"/

/** 工具结果是不是 skill 工具加载进来的技能正文（第一个非空文字块以技能标记开头的那种）。 */
function isSkillResult(message) {
  const blocks = message && Array.isArray(message.content) ? message.content : []
  for (const block of blocks) {
    if (block && block.type === 'text' && typeof block.text === 'string' && block.text !== '') return SKILL_CONTENT.test(block.text)
  }
  return false
}

function createContext() {
  return {
    /** 系统提示词的各个版本（seq, tokens），生效的是最后一个非零的。 */
    systems: [],
    tools: 0,
    /** 上下文里的消息：seq → { cat, tokens, reasoning, answers, calls }。 */
    nodes: new Map(),
    sums: { user: 0, inject: 0, skill: 0, tool: 0, assistant: 0, reasoning: 0, answers: 0, calls: 0 },
    /** 压缩 / 裁剪事件点名要拿掉的消息，等下一条 replace 消息来替换。 */
    shadowed: null,
    /** callId → 工具名，用来认出 skill 工具的结果。 */
    callNames: new Map(),
  }
}

function contextRemove(context, seq) {
  const node = context.nodes.get(seq)
  if (!node) return
  context.nodes.delete(seq)
  context.sums[node.cat] -= node.tokens
  if (node.cat === 'assistant') {
    context.sums.reasoning -= node.reasoning
    context.sums.answers -= node.answers
    context.sums.calls -= node.calls
  }
}

function contextAdd(context, seq, node) {
  contextRemove(context, seq)
  context.nodes.set(seq, node)
  context.sums[node.cat] += node.tokens
  if (node.cat === 'assistant') {
    context.sums.reasoning += node.reasoning
    context.sums.answers += node.answers
    context.sums.calls += node.calls
  }
}

/** replace 类的 surfaceOp：{ op: 'replace', startSeq, endSeq }；其余（append）返回 null。 */
function replaceRange(surfaceOp) {
  if (!surfaceOp || typeof surfaceOp !== 'object' || surfaceOp.op !== 'replace') return null
  const start = surfaceOp.startSeq
  const end = surfaceOp.endSeq
  return typeof start === 'number' && Number.isFinite(start) && typeof end === 'number' && Number.isFinite(end) ? { start, end } : null
}

/** 一条消息进上下文：先按 replace 拿掉被它顶替的那些（压缩点名的，或 seq 落在范围里的），再把它加进去。 */
function contextPut(context, event, node) {
  const shadowed = context.shadowed
  context.shadowed = null
  const range = replaceRange(event.surfaceOp)
  if (range) {
    if (shadowed && shadowed.length) for (const seq of shadowed) contextRemove(context, seq)
    else for (const seq of Array.from(context.nodes.keys())) if (seq >= range.start && seq <= range.end) contextRemove(context, seq)
  }
  contextAdd(context, toNumber(event.seq), node)
}

/** 把 total 按 weights 的比例分成整数，各份之和恰好等于 total（最大余数法）；权重全为 0 时返回全 0。 */
function splitByWeights(total, weights) {
  const amount = Math.max(0, Math.round(toNumber(total)))
  const clean = weights.map((weight) => (Number.isFinite(weight) && weight > 0 ? weight : 0))
  const sum = clean.reduce((left, right) => left + right, 0)
  const parts = clean.map(() => 0)
  if (!(sum > 0) || amount === 0) return parts
  const remainders = []
  let assigned = 0
  clean.forEach((weight, index) => {
    const exact = (amount * weight) / sum
    parts[index] = Math.floor(exact)
    assigned += parts[index]
    remainders.push([exact - parts[index], index])
  })
  remainders.sort((left, right) => right[0] - left[0] || left[1] - right[1])
  for (let rest = amount - assigned, at = 0; rest > 0; rest -= 1, at += 1) parts[remainders[at % remainders.length][1]] += 1
  return parts
}

/**
 * 一步的八类分摊。context 是这一步发出请求时的上下文（还不含这一步自己的回复），
 * generated 是这一步自己生成内容的估算，parts 是这一步的四项用量。
 */
function stepMix(context, generated, parts, usage) {
  const mix = MIX_KEYS.map(() => 0)
  const sums = context.sums
  // 上下文里历史回复的估算值按思考 / 回复 / 调用分；分不出来的（没有这三种块）都算工具调用
  const content = sums.reasoning + sums.answers + sums.calls
  const scale = content > 0 ? sums.assistant / content : 0
  const weights = MIX_KEYS.map(() => 0)
  const system = context.systems.reduce((latest, node) => (node.tokens > 0 ? node.tokens : latest), 0)
  weights[MIX_INDEX.system] = system
  weights[MIX_INDEX.tools] = context.tools
  weights[MIX_INDEX.user] = sums.user
  weights[MIX_INDEX.inject] = sums.inject
  weights[MIX_INDEX.skill] = sums.skill
  weights[MIX_INDEX.toolCalls] = sums.tool + (content > 0 ? sums.calls * scale : sums.assistant)
  weights[MIX_INDEX.thinking] = sums.reasoning * scale
  weights[MIX_INDEX.answers] = sums.answers * scale
  const input = parts.inputTokens + parts.cacheReadTokens + parts.cacheWriteTokens
  // 日志里看不到任何上下文（残缺的日志）时，输入记在用户消息上：一次请求至少有一条消息
  if (!weights.some((weight) => weight > 0)) weights[MIX_INDEX.user] = 1
  splitByWeights(input, weights).forEach((value, index) => {
    mix[index] += value
  })

  const output = parts.outputTokens
  const reported = usage && typeof usage.reasoningTokens === 'number' && Number.isFinite(usage.reasoningTokens) ? Math.max(0, Math.round(usage.reasoningTokens)) : null
  const thinking = Math.min(output, reported === null ? -1 : reported)
  if (thinking >= 0) {
    // 供应商报了思考 token：思考用它，其余按回复 / 调用的估算值分；两样都没有就全算调用（只有思考时全算思考）
    const rest = output - thinking
    const split = splitByWeights(rest, [generated.answers, generated.calls])
    const placed = split[0] + split[1]
    mix[MIX_INDEX.thinking] += thinking
    mix[MIX_INDEX.answers] += split[0]
    mix[MIX_INDEX.toolCalls] += split[1]
    if (placed < rest) mix[thinking > 0 ? MIX_INDEX.thinking : MIX_INDEX.toolCalls] += rest - placed
  } else {
    const split = splitByWeights(output, [generated.reasoning, generated.answers, generated.calls])
    mix[MIX_INDEX.thinking] += split[0]
    mix[MIX_INDEX.answers] += split[1]
    mix[MIX_INDEX.toolCalls] += split[2]
    const placed = split[0] + split[1] + split[2]
    if (placed < output) mix[MIX_INDEX.toolCalls] += output - placed
  }
  return mix
}

/**
 * 让上下文跟上一个事件。assistant/message 带用量时返回这一步的八类分摊（先分摊、再把它的回复加进上下文），
 * 其余事件返回 null。坏掉的事件不影响别的事件。
 */
function trackContext(context, event) {
  const data = event.data && typeof event.data === 'object' ? event.data : {}
  switch (event.type) {
    case 'request/header': {
      const header = data.header && typeof data.header === 'object' ? data.header : {}
      context.tools = estimateTools(header.tools)
      return null
    }
    case 'system/message': {
      context.shadowed = null
      const range = replaceRange(event.surfaceOp)
      if (range) {
        context.systems = context.systems.filter((node) => node.seq < range.start || node.seq > range.end)
        for (const seq of Array.from(context.nodes.keys())) if (seq >= range.start && seq <= range.end) contextRemove(context, seq)
      }
      context.systems.push({ seq: toNumber(event.seq), tokens: estimateSystem(eventMessage(data)) })
      if (context.systems.length > 8) context.systems = context.systems.slice(-8)
      return null
    }
    case 'tool/call': {
      if (typeof data.callId === 'string' && typeof data.name === 'string') context.callNames.set(data.callId, data.name)
      return null
    }
    case 'user/message':
    case 'developer/message': {
      const message = eventMessage(data)
      if (!message || !Array.isArray(message.content)) return null
      const estimate = estimateMessage(message)
      contextPut(context, event, { cat: messageCategory(event.type, message.source), tokens: estimate.tokens })
      return null
    }
    case 'tool/result': {
      const message = eventMessage(data)
      const estimate = estimateMessage(message)
      const callId = message && message.source && typeof message.source.callId === 'string' ? message.source.callId : ''
      const name = callId ? context.callNames.get(callId) : undefined
      if (callId) context.callNames.delete(callId)
      const skill = (name === 'skill' || name === undefined) && isSkillResult(message)
      contextPut(context, event, { cat: skill ? 'skill' : 'tool', tokens: estimate.tokens })
      return null
    }
    case 'compaction/summary':
    case 'compaction/prune': {
      if (Array.isArray(data.shadowedSeqs)) context.shadowed = data.shadowedSeqs.filter((seq) => typeof seq === 'number')
      return null
    }
    case 'assistant/message': {
      const message = eventMessage(data)
      const estimate = estimateMessage(message)
      const mix = data.usage ? stepMix(context, estimate, stepParts(data.usage), data.usage) : null
      contextPut(context, event, { cat: 'assistant', tokens: estimate.tokens, reasoning: estimate.reasoning, answers: estimate.answers, calls: estimate.calls })
      return mix
    }
    default:
      return null
  }
}

/** mix 是这一步的八类分摊（trackContext 算的）；单独调用、没有上下文时不传，这一步就不进 mix。 */
function applyEvent(fold, event, mix) {
  const seq = toNumber(event.seq)
  if (seq > fold.seq) fold.seq = seq

  const time = toNumber(event.time)
  if (time > 0) {
    if (fold.firstTime === 0 || time < fold.firstTime) fold.firstTime = time
    if (time > fold.lastTime) fold.lastTime = time
  }

  const data = event.data && typeof event.data === 'object' ? event.data : {}
  switch (event.type) {
    case 'assistant/message': {
      const usage = data.usage
      if (!usage) break
      const parts = stepParts(usage)
      const tokens = partsSum(parts)
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
        if (key) addStepToDay(dayMapsOf(fold, false), key, parts, tokens, provider, modelFamily, time, mix)
      }
      break
    }
    case 'turn/start': {
      const turn = data.turn
      if (turn !== undefined && time > 0) fold.openTurns[safeKey(turn)] = time
      break
    }
    case 'turn/end': {
      const turn = data.turn
      if (turn === undefined) break
      const key = safeKey(turn)
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
  const events = snapshot && Array.isArray(snapshot.events) ? snapshot.events : []
  /** 继承前缀里还没结束的 turn：前缀不进本体的任务用时，单独算它自己的最长任务。 */
  const inheritedTurns = {}
  /** 上下文从日志第一条事件跟起：继承前缀里的消息也在后面每一步的提示词里。只活在这次折叠里，不进缓存。 */
  const context = createContext()
  for (const event of events) {
    // 坏掉的单条事件（null、数字）跳过，不能让整个会话折叠失败
    if (!event || typeof event !== 'object') continue
    let mix = null
    try {
      mix = trackContext(context, event)
    } catch {
      mix = null
    }
    const seq = toNumber(event.seq)
    if (seq < inherited) {
      // 继承前缀：只累加用量，不进本体的任务用时/首末时间。
      const turn = event.data && event.data.turn
      if (event.type === 'turn/start' && turn !== undefined && toNumber(event.time) > 0) inheritedTurns[safeKey(turn)] = toNumber(event.time)
      if (event.type === 'turn/end' && turn !== undefined) {
        const started = inheritedTurns[safeKey(turn)]
        if (typeof started === 'number' && toNumber(event.time) >= started) {
          fold.inheritedLongestTurnMs = Math.max(fold.inheritedLongestTurnMs, toNumber(event.time) - started)
        }
        delete inheritedTurns[safeKey(turn)]
      }
      const usage = event.type === 'assistant/message' && event.data ? event.data.usage : undefined
      if (usage) {
        const parts = stepParts(usage)
        const tokens = partsSum(parts)
        if (tokens > fold.inheritedMaxStepTokens) fold.inheritedMaxStepTokens = tokens
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
          if (key) addStepToDay(dayMapsOf(fold, true), key, parts, tokens, inheritedProvider, inheritedModelFamily, time, mix)
        }
      }
      if (seq > fold.seq) fold.seq = seq
      continue
    }
    applyEvent(fold, event, mix)
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

/** slots 表 → 按时间排好的元组：[小时序号, 供应商, 模型, 项目键, 未缓存输入, 缓存读, 缓存写, 输出]。 */
function slotRows(slots) {
  const rows = []
  for (const [key, parts] of Object.entries(slots || {})) {
    const [hour, provider = '', model = '', project = ''] = key.split(SLOT_SEP)
    rows.push([Number(hour), provider, model, project, ...parts])
  }
  return rows.sort((left, right) => left[0] - right[0] || (left[1] < right[1] ? -1 : left[1] > right[1] ? 1 : 0))
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
        slots: {},
        mix: MIX_KEYS.map(() => 0),
      }
      entry.tokens += tokens
      const dayMix = maps.mix[key]
      if (Array.isArray(dayMix)) for (let index = 0; index < MIX_KEYS.length; index += 1) entry.mix[index] += toNumber(dayMix[index])
      // 每小时用量再带上项目：[UTC 小时序号, 供应商, 模型, 项目键, 未缓存输入, 缓存读, 缓存写, 输出]
      for (const [slotKey, parts] of Object.entries(maps.slots[key] || {})) {
        const fullKey = `${slotKey}${SLOT_SEP}${project.key}`
        const sum = entry.slots[fullKey] || (entry.slots[fullKey] = [0, 0, 0, 0])
        for (let index = 0; index < 4; index += 1) sum[index] += toNumber(parts && parts[index])
      }
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

  /**
   * 原件「在」= 它的折叠结果就在这批会话里。只看会话列表不够：原件列出来了却读失败（没有折叠结果）时，
   * 副本的前缀两边都不算，这笔花费就丢了。首次全量扫描中途，副本先于原件折完时前缀会暂时多算，原件折完就回正。
   */
  const folded = new Set(sessions.map((fold) => fold.sessionId))
  const parentPresent = (parent) => Boolean(parent) && folded.has(parent) && (!knownIds || knownIds.has(parent))

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
    /** 这个会话的「自己的」峰值记录；孤儿前缀补回时，前缀里的峰值也算它的。 */
    let sessionTokens = fold.tokens
    let sessionMaxStep = fold.maxStepTokens
    let sessionLongestTurn = fold.longestTurnMs
    if (inheritedTokens > 0) {
      // 前缀是不是「重复计数」，取决于它的原件还在不在语料里。
      // 已知限制：A → B → C 连续 fork、中间的 B 被删而 A 还在时，C 的前缀里属于 A 的那段会被补回、重复计一次
      // （要知道前缀里哪段来自哪个会话，得记逐事件的来源，日志里没有）。
      if (parentPresent(fold.parentSession)) {
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
        sessionTokens += inheritedTokens
        sessionMaxStep = Math.max(sessionMaxStep, toNumber(fold.inheritedMaxStepTokens))
        sessionLongestTurn = Math.max(sessionLongestTurn, toNumber(fold.inheritedLongestTurnMs))
      }
    }

    if (sessionTokens > peakSessionTokens) {
      peakSessionTokens = sessionTokens
      peakSession = fold.sessionId
    }
    if (sessionMaxStep > peakStepTokens) {
      peakStepTokens = sessionMaxStep
      peakStepSession = fold.sessionId
    }
    if (sessionLongestTurn > longestTurnMs) {
      longestTurnMs = sessionLongestTurn
      longestTurnSession = fold.sessionId
    }

    mergeDay(dayMapsOf(fold, false), project)
  }

  const dailyList = Array.from(daily.entries())
    .map(([date, entry]) => ({ date, ...entry, slots: slotRows(entry.slots) }))
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

/**
 * 缓存里的每日键是折叠时按本地时区算的：换了时区（出差、系统改时区），旧会话还留在旧时区的日子上，
 * 和新会话的分天对不上。缓存记下时区名，读的时候不一样就整份重折。
 */
function cacheTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || ''
  } catch {
    return ''
  }
}

/** 折叠结果里的字段：数字必须是有限数，表必须是普通对象、值的形状对得上。 */
const FOLD_NUMBERS = [
  'seq', 'createdAt', 'calls', 'tokens', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens',
  'maxStepTokens', 'longestTurnMs', 'usageMismatchCalls', 'firstTime', 'lastTime', 'inheritedTokens', 'inheritedCalls',
  'inheritedInputTokens', 'inheritedOutputTokens', 'inheritedCacheReadTokens', 'inheritedCacheWriteTokens',
  'inheritedMaxStepTokens', 'inheritedLongestTurnMs',
]
const FOLD_STRINGS = ['sessionId', 'parentSession', 'cwd']
const FOLD_NUMBER_MAPS = [
  'perDay', 'perDayCalls', 'perDayInput', 'perDayOutput', 'perDayCacheRead', 'perDayCacheWrite', 'perProvider', 'perModel',
  'openTurns', 'inheritedPerDay', 'inheritedPerDayCalls', 'inheritedPerModel', 'inheritedPerProvider', 'inheritedPerDayInput',
  'inheritedPerDayOutput', 'inheritedPerDayCacheRead', 'inheritedPerDayCacheWrite',
]
const FOLD_NESTED_MAPS = ['perDayProvider', 'perDayModel', 'inheritedPerDayProvider', 'inheritedPerDayModel']
const FOLD_USAGE_MAPS = ['perDayProviderUsage', 'inheritedPerDayProviderUsage']
const FOLD_SLOT_MAPS = ['perDaySlots', 'inheritedPerDaySlots']
const FOLD_MIX_MAPS = ['perDayMix', 'inheritedPerDayMix']

/**
 * 校验一条缓存里的折叠结果；哪里不对就返回 null（丢掉，下次扫描重折）。
 * 旧实现只看是不是对象：`{}` 进聚合让总量变成 NaN，`tokens: "5"` 让总量变成字符串拼接，
 * `{ complete: true }` 还永远不会被重读。
 */
function validFold(raw) {
  const finite = (value) => typeof value === 'number' && Number.isFinite(value)
  const plain = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  const mapOf = (value, check) => plain(value) && Object.values(value).every(check)
  const usage = (value) => plain(value) && ['inputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens'].every((name) => finite(value[name]))
  const slot = (value) => Array.isArray(value) && value.length === 4 && value.every(finite)
  const mix = (value) => Array.isArray(value) && value.length === MIX_KEYS.length && value.every(finite)
  if (!plain(raw) || raw.complete !== true) return null
  if (!FOLD_NUMBERS.every((name) => finite(raw[name]))) return null
  if (!FOLD_STRINGS.every((name) => typeof raw[name] === 'string')) return null
  const fold = { ...raw, subagent: raw.subagent === true, live: raw.live === true }
  const maps = [
    [FOLD_NUMBER_MAPS, finite],
    [FOLD_NESTED_MAPS, (value) => mapOf(value, finite)],
    [FOLD_USAGE_MAPS, (value) => mapOf(value, usage)],
    [FOLD_SLOT_MAPS, (value) => mapOf(value, slot)],
    [FOLD_MIX_MAPS, mix],
  ]
  for (const [names, check] of maps) {
    // 没有的表（还没记过东西）由 dayMapsOf 用到时再建
    for (const name of names) if (fold[name] !== undefined && !mapOf(fold[name], check)) return null
  }
  return fold
}

function readCache() {
  const empty = { version: CACHE_VERSION, generatedAt: 0, sessions: {}, complete: false }
  try {
    const parsed = parseJson(fs.readFileSync(cacheFile(), 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.version !== CACHE_VERSION) return empty
    if (parsed.timeZone !== cacheTimeZone()) return empty
    // 缓存文件是本地可改的：sessions 可能是 null / 数组，单条记录也可能被写坏。
    // 这类记录直接丢掉（下次扫描会重折），不能让 Object.keys(null) 或 fold.tokens 在启动时抛错。
    const sessions = {}
    const source = parsed.sessions
    if (source && typeof source === 'object' && !Array.isArray(source)) {
      for (const [id, raw] of Object.entries(source)) {
        const fold = validFold(raw)
        if (fold) sessions[id] = fold
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
    fs.writeFileSync(temporary, JSON.stringify({ ...cache, timeZone: cacheTimeZone() }))
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
    /** 缓存里的会话变了、聚合还没重算。聚合在有人要快照时才算（最多每 2 秒一次），扫描本身不再反复重算。 */
    dirty: false,
    rebuiltAt: 0,
    /** 会话列表从什么时候开始一直是空的（缓存非空时）：空一下多半是宿主还没准备好，持续一分钟才当真。 */
    emptySince: 0,
    /** 快照里编码过的每日明细，跟着聚合结果走（聚合不变就不用重新编码）。 */
    encoded: null,
  }
  state.generatedAt = state.cache.generatedAt

  const rebuild = () => {
    state.aggregate = aggregate(Object.values(state.cache.sessions), Date.now(), state.knownIds)
    state.dirty = false
    state.rebuiltAt = Date.now()
    state.encoded = null
    return state.aggregate
  }
  rebuild()

  /** 当前的聚合结果：扫描中途要快照时，离上次重算超过 2 秒才重算一次。 */
  const currentAggregate = () => {
    if (!state.aggregate || (state.dirty && Date.now() - state.rebuiltAt >= REBUILD_INTERVAL_MS)) rebuild()
    return state.aggregate
  }

  const scan = async (reason) => {
    if (state.inflight) return state.inflight
    state.inflight = (async () => {
      const startedAt = Date.now()
      state.firstScan = Object.keys(state.cache.sessions).length === 0 || state.cache.complete === false
      state.scanning = true
      try {
        const listed = await ctx.sessionQuery.listSessions()
        if (!Array.isArray(listed)) throw new Error('listSessions 没有返回列表')
        /** 会话 id（__proto__ 这种当不了普通对象键的跳过）。 */
        const idOf = (record) => {
          const id = record && record.header && record.header.id
          if (id === undefined || id === null) return ''
          const text = String(id)
          return text && text === safeKey(text) ? text : ''
        }
        const records = listed.filter((record) => idOf(record))
        if (records.length === 0 && Object.keys(state.cache.sessions).length > 0) {
          // 一次空列表多半是宿主那边还没准备好（启动中、目录暂时读不到）：先不动缓存，持续一分钟还是空的再当真
          if (!state.emptySince) state.emptySince = Date.now()
          if (Date.now() - state.emptySince < EMPTY_LISTING_GRACE_MS) return
        }
        state.emptySince = 0
        const ids = new Set(records.map(idOf))
        // 会话被删掉/归档到别处时，旧 fold 会污染总数，这里同步剔除；它的读取失败记录也一起清掉。
        for (const id of Object.keys(state.cache.sessions)) {
          if (!ids.has(id)) {
            delete state.cache.sessions[id]
            state.dirty = true
          }
        }
        for (const id of Object.keys(state.errors)) if (!ids.has(id)) delete state.errors[id]
        if (ids.size !== state.knownIds.size || [...ids].some((id) => !state.knownIds.has(id))) state.dirty = true
        state.knownIds = ids

        const pending = []
        for (const record of records) {
          const sessionId = idOf(record)
          const cached = state.cache.sessions[sessionId]
          // 需要读日志的：活着的会话（可能还在追加）、从没折过的会话，以及上次折的时候还活着、现在结束了的会话
          // （最后一次扫描之后到结束之间写下的那段还没读过）。已经结束且结束后读过的会话，日志不会再变。
          if (record.live || !cached || !cached.complete || cached.live) pending.push({ id: sessionId, live: Boolean(record.live) })
        }
        pending.sort((left, right) => Number(right.live) - Number(left.live))

        /** 埋点：readSession（宿主内部解压+解析）与本插件 fold 分开计时，写 timing.log。 */
        const stats = { read: 0, readMs: 0, foldMs: 0, events: 0 }
        state.progress = { done: 0, total: pending.length }
        // 并行读几个会话（zstd 解压 + JSON 解析有 I/O 成分，串行会让冷启动白等）。
        // 聚合不在这里重算（有人要快照时才算，见 currentAggregate），缓存每 10 秒才落一次盘：
        // 旧实现每 4 个会话重算、每 16 个会话写一次整份缓存，冷启动的耗时随会话数平方增长。
        const CONCURRENCY = Math.min(8, Math.max(1, pending.length))
        let cursor = 0
        let done = 0
        let writtenAt = Date.now()
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
              const fold = foldSnapshot(snapshot)
              fold.live = target.live
              state.cache.sessions[target.id] = fold
              state.dirty = true
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
            // 每 10 秒落一次盘：首次全量扫描被打断（关应用/崩溃）时，
            // 下次启动只需补扫剩下的部分，不必从头再来。
            if (Date.now() - writtenAt >= CACHE_WRITE_INTERVAL_MS) {
              writtenAt = Date.now()
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
          appendTimingLog(
            `[${new Date().toISOString()}] reason=${reason} sessions=${stats.read} events=${stats.events} readSession=${stats.readMs}ms fold=${stats.foldMs}ms total=${Date.now() - startedAt}ms concurrency=${CONCURRENCY}\n`,
          )
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

  /**
   * 快照里的每日明细：slots 里的供应商 / 模型 / 项目路径换成编号，对照表放在 slotKeys 里（页面收到后还原）。
   * 这三个字符串在每一行里重复，占了快照的大半体积（一年重度使用约 1.7 MB，编号后约三分之一）。
   * 跟着聚合结果缓存，聚合不变就不重新编码。
   */
  const encodedDaily = (agg) => {
    if (state.encoded && state.encoded.aggregate === agg) return state.encoded
    const slotKeys = { providers: [], models: [], projects: [] }
    const lookup = { providers: new Map(), models: new Map(), projects: new Map() }
    const code = (kind, value) => {
      let index = lookup[kind].get(value)
      if (index === undefined) {
        index = slotKeys[kind].length
        slotKeys[kind].push(value)
        lookup[kind].set(value, index)
      }
      return index
    }
    const daily = agg.daily.map((entry) => ({
      ...entry,
      slots: entry.slots.map(([hour, provider, model, project, ...parts]) => [hour, code('providers', provider), code('models', model), code('projects', project), ...parts]),
    }))
    state.encoded = { aggregate: agg, daily, slotKeys, prices: pricesFor(agg.daily) }
    return state.encoded
  }

  const snapshotBody = () => {
    const agg = currentAggregate()
    const encoded = encodedDaily(agg)
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
      billing: readBilling(),
      prices: encoded.prices,
      totals: agg.totals,
      /** slots 的元组：[UTC 小时序号, 供应商编号, 模型编号, 项目编号, 未缓存输入, 缓存读, 缓存写, 输出]，编号查 slotKeys。 */
      daily: encoded.daily,
      slotKeys: encoded.slotKeys,
      projects: agg.projects || {},
      failedSessions: Object.keys(state.errors).length,
    }
  }

  return { state, scan, kick, snapshotBody, identity, updateInfo, refreshUpdateInfo, startUpdate }
}

/**
 * 只接受同源的 POST，否则别的网页可以在后台发请求改你的计费设置、触发升级。
 * 浏览器会带 Sec-Fetch-Site（同源是 same-origin，地址栏 / 书签是 none）；没有这个头的老浏览器看 Origin 的
 * host 是否等于请求的 Host。两个都没有（curl、脚本）放行：那不是网页发的。
 */
function sameOriginRequest(req) {
  const headers = (req && req.headers) || {}
  const site = headers['sec-fetch-site']
  if (typeof site === 'string' && site) return site === 'same-origin' || site === 'none'
  const origin = headers.origin
  if (typeof origin !== 'string' || !origin) return true
  try {
    return new URL(origin).host === String(headers.host || '')
  } catch {
    return false
  }
}

/** 带请求体的 POST 只接受 JSON：跨站的表单只能发 text/plain / form，发不了 application/json（要预检，预检过不了）。 */
function jsonRequest(req) {
  const type = req && req.headers ? req.headers['content-type'] : ''
  return /^application\/json\s*(;|$)/i.test(String(type || ''))
}

/** 快照的 ETag：内容的哈希。页面轮询时内容没变就回 304，不用每次重发整份快照。 */
function snapshotTag(body) {
  return `"${createHash('sha1').update(body).digest('base64url')}"`
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

  /** POST 的公共检查：方法、同源、（带请求体的）JSON。不通过时已经回了错误，返回 false。 */
  const acceptPost = (req, res, withBody) => {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
      return false
    }
    if (!sameOriginRequest(req)) {
      sendJson(res, 403, { ok: false, error: 'cross-origin' })
      return false
    }
    if (withBody && !jsonRequest(req)) {
      sendJson(res, 415, { ok: false, error: 'json-only' })
      return false
    }
    return true
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
        const body = JSON.stringify(snapshotBody())
        const tag = snapshotTag(body)
        // no-cache（不是 no-store）：浏览器留一份，下次带 If-None-Match 来问，没变就回 304
        res.setHeader('etag', tag)
        res.setHeader('cache-control', 'no-cache')
        if (req.headers && req.headers['if-none-match'] === tag) {
          res.statusCode = 304
          res.end()
          return
        }
        res.statusCode = 200
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.setHeader('content-length', Buffer.byteLength(body))
        res.end(body)
      },
    }),
  )

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: REFRESH_PATH,
      handler: (req, res) => {
        if (!acceptPost(req, res, false)) return
        kick('forced')
        sendJson(res, 200, { ok: true, accepted: true, scanning: state.scanning })
      },
    }),
  )

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: BILLING_PATH,
      handler: async (req, res) => {
        if (!acceptPost(req, res, true)) return
        let body
        try {
          body = await readJsonBody(req, ALIAS_BODY_LIMIT)
        } catch (error) {
          sendJson(res, error && error.code === 'too-large' ? 413 : 400, { ok: false, error: error && error.code === 'too-large' ? 'too-large' : 'invalid-json' })
          return
        }
        try {
          const has = (name) => Boolean(body) && typeof body === 'object' && Object.prototype.hasOwnProperty.call(body, name)
          const result = writeBilling(has('provider') ? body.provider : undefined, has('billing') ? body.billing : undefined)
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
      path: ALIAS_PATH,
      handler: async (req, res) => {
        if (!acceptPost(req, res, true)) return
        let body
        try {
          body = await readJsonBody(req, ALIAS_BODY_LIMIT)
        } catch (error) {
          sendJson(res, error && error.code === 'too-large' ? 413 : 400, { ok: false, error: error && error.code === 'too-large' ? 'too-large' : 'invalid-json' })
          return
        }
        try {
          const has = (name) => Boolean(body) && typeof body === 'object' && Object.prototype.hasOwnProperty.call(body, name)
          const result = writeAlias(has('provider') ? body.provider : undefined, has('name') ? body.name : undefined)
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
        if (!acceptPost(req, res, false)) return
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
  slotRows,
  priceRowOf,
  pricesFor,
  sanitizeBilling,
  readBilling,
  writeBilling,
  sanitizeAliases,
  readAliases,
  writeAlias,
  usageParts,
  stepParts,
  stepTokens,
  usageMismatch,
  safeKey,
  validFold,
  cacheTimeZone,
  sameOriginRequest,
  jsonRequest,
  providerOf,
  normalizeModelId,
  modelFamilyOf,
  MIX_KEYS,
  estimateMessage,
  estimateImage,
  estimateSystem,
  estimateTools,
  messageCategory,
  splitByWeights,
  createContext,
  trackContext,
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
