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

export const inject = ['webServer', 'sessionQuery']

const SNAPSHOT_PATH = '/api/dsh-profile-stats/snapshot'
const REFRESH_PATH = '/api/dsh-profile-stats/refresh'

/** 缓存结构版本：折叠口径变了就 +1，旧缓存整份丢弃重折。 */
const CACHE_VERSION = 9
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
    openTurns: {},
    firstTime: 0,
    lastTime: 0,
    /** 继承前缀（fork/seed 抄进来的来源会话事件）里的用量，单独记账。 */
    inheritedTokens: 0,
    inheritedCalls: 0,
    inheritedPerDay: {},
    inheritedPerDayCalls: {},
    inheritedInputTokens: 0,
    inheritedOutputTokens: 0,
    inheritedCacheReadTokens: 0,
    inheritedCacheWriteTokens: 0,
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
        if (time > 0) {
          const key = localDayKey(time)
          if (key) {
            fold.inheritedPerDay[key] = toNumber(fold.inheritedPerDay[key]) + tokens
            fold.inheritedPerDayCalls[key] = toNumber(fold.inheritedPerDayCalls[key]) + 1
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

  /** 每天一份 { tokens, calls, inputTokens, outputTokens, cacheTokens }，供热力图悬浮提示与对账。 */
  const mergeDay = (fold, source, callsByDay) => {
    for (const [key, value] of Object.entries(source || {})) {
      const tokens = toNumber(value)
      if (tokens <= 0) continue
      const entry = daily.get(key) || { tokens: 0, calls: 0, inputTokens: 0, outputTokens: 0, cacheTokens: 0, byProvider: {} }
      entry.tokens += tokens
      entry.calls += toNumber(callsByDay && callsByDay[key])
      entry.inputTokens += toNumber(fold && fold.perDayInput && fold.perDayInput[key])
      entry.outputTokens += toNumber(fold && fold.perDayOutput && fold.perDayOutput[key])
      entry.cacheTokens += toNumber(fold && fold.perDayCache && fold.perDayCache[key])
      const dayProviders = (fold && fold.perDayProvider && fold.perDayProvider[key]) || {}
      for (const [provider, value] of Object.entries(dayProviders)) {
        entry.byProvider[provider] = toNumber(entry.byProvider[provider]) + toNumber(value)
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
        mergeDay(fold, fold.inheritedPerDay, fold.inheritedPerDayCalls)
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

    mergeDay(fold, fold.perDay, fold.perDayCalls)
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
        for (let index = 0; index < pending.length; index += 1) {
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
          state.progress = { done: index + 1, total: pending.length }
          rebuild()
          if (index % 3 === 2) await yieldToLoop()
        }

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
    const handle = (user || 'local').toLowerCase().replace(/\s+/g, '')
    return { name: user || 'DSH 用户', handle: `@${handle}`, host }
  }

  const snapshotBody = () => {
    const agg = state.aggregate || rebuild()
    return {
      ok: true,
      generatedAt: state.generatedAt,
      scanning: state.scanning,
      progress: state.progress,
      identity: identity(),
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

  // 冷启动就把扫描排上，第一次打开页面时通常已经能直接给数。
  ctx.effect(() => {
    const timer = setTimeout(() => kick(false), 1500)
    return () => clearTimeout(timer)
  })
}
