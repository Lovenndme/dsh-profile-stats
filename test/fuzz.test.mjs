import assert from 'node:assert/strict'
import test from 'node:test'

import { loadClientHelpers } from './helpers/client-source.mjs'

/*
 * 随机输入测试：固定种子造几百组用量 / 计费方式 / 日期范围，检查费用与日期窗口的不变量。
 * 失败时打印种子与场景序号，换成同样的种子就能复现。
 */

function mulberry32(seed) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

const helpers = loadClientHelpers({
  extraCode: ['const isChineseLocale = () => true'],
  constants: ['OFFICIAL_PRICES', 'CN_HOLIDAYS', 'OFFICIAL_PROVIDERS', 'BILLING_MODES', 'holidayKeys'],
  functions: [
    'computeCosts', 'officialRate', 'isPeakHour', 'priceFamily', 'modelBaseId', 'holidaySet', 'billingOf', 'daysInMonth', 'validDateKey',
    'indexDaily', 'parseDateKey', 'localDateKey', 'addDays', 'startOfDay', 'toNumber', 'rangeWindow', 'deltaWindows', 'daysBetween', 'startOfWeek',
  ],
})
const { computeCosts, rangeWindow, deltaWindows, parseDateKey, localDateKey, addDays, daysBetween } = helpers

const TABLE = { 'claude-sonnet-5-5': [2, 10, 0.1, 2.5], 'gpt-5-5': [5, 30, 0.5, null], 'qwen-max': [1.6, 6.4, null, null] }
const MODELS = ['deepseek-flash', 'deepseek-v4-1-flash', 'deepseek-v4-pro', 'claude-sonnet-5-5', 'gpt-5-5', 'qwen-max', 'mystery']
const PROVIDERS = ['deepseek-official', 'deepseek-account', 'relay-a', 'relay-b', 'plan-x', 'work', 'unset-y']
const PROJECTS = ['', 'c:/a', 'c:/b', '/srv/c']

const pick = (rand, list) => list[Math.floor(rand() * list.length)]
const int = (rand, max) => Math.floor(rand() * max)

/** 一段随机的日明细：2026-08-01 起若干天，每天若干条 slots（小时序号与日期一致）。 */
function randomDaily(rand) {
  const start = new Date(2026, 7, 1 + int(rand, 40))
  const days = 1 + int(rand, 70)
  const daily = []
  for (let offset = 0; offset < days; offset += 1) {
    if (rand() < 0.3) continue
    const date = addDays(start, offset)
    const slots = []
    const count = 1 + int(rand, 6)
    for (let index = 0; index < count; index += 1) {
      const hour = Math.floor(new Date(date.getFullYear(), date.getMonth(), date.getDate(), int(rand, 24)).getTime() / 3600000)
      const big = () => (rand() < 0.15 ? 0 : int(rand, 2e7))
      slots.push([hour, pick(rand, PROVIDERS), pick(rand, MODELS), pick(rand, PROJECTS), big(), big(), rand() < 0.7 ? 0 : big(), big()])
    }
    daily.push({ date: localDateKey(date), slots })
  }
  return daily
}

function randomSettings(rand) {
  const settings = {}
  if (rand() < 0.7) settings['relay-a'] = { mode: 'multiplier', factor: Math.round(rand() * 2000) / 1000 }
  if (rand() < 0.6) settings['relay-b'] = { mode: 'official' }
  if (rand() < 0.6) settings['plan-x'] = rand() < 0.5 ? { mode: 'plan', monthly: 199 } : { mode: 'plan', monthly: 40, since: '2026-08-20' }
  if (rand() < 0.7) settings.work = { mode: 'free' }
  if (rand() < 0.2) settings['deepseek-account'] = { mode: 'multiplier', factor: 0.5 }
  return settings
}

const finite = (value) => typeof value === 'number' && Number.isFinite(value)
const close = (a, b, label) => assert.ok(Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b)), `${label}: ${a} ≠ ${b}`)

test('fuzz computeCosts：不出 NaN；各家之和 = 合计；没有包月时项目之和 = 合计；相邻两段相加 = 合起来那段', () => {
  const rand = mulberry32(20261109)
  for (let scenario = 0; scenario < 400; scenario += 1) {
    const daily = randomDaily(rand)
    if (!daily.length) continue
    const settings = randomSettings(rand)
    const keys = daily.map((entry) => entry.date)
    const todayKey = localDateKey(addDays(parseDateKey(keys[keys.length - 1]), int(rand, 5)))
    const options = { table: TABLE, usdCny: 6 + rand() * 2 }
    const where = `scenario ${scenario}`
    const all = computeCosts(daily, '', todayKey, settings, todayKey, options)
    for (const field of ['spend', 'value', 'peakValue', 'peakBase', 'usdValue', 'unpricedTokens']) assert.ok(finite(all[field]) && all[field] >= 0, `${where} ${field}=${all[field]}`)
    let providerSum = 0
    let valueSum = 0
    for (const [id, row] of Object.entries(all.byProvider)) {
      assert.ok(finite(row.value), `${where} ${id} value`)
      valueSum += row.value
      if (row.spend === null) assert.equal(row.mode, 'unset', `${where} ${id} spend null 只能是未设置`)
      else {
        assert.ok(finite(row.spend) && row.spend >= 0, `${where} ${id} spend=${row.spend}`)
        providerSum += row.spend
      }
    }
    close(providerSum, all.spend, `${where} 各家之和`)
    close(valueSum, all.value, `${where} 官方价折算之和`)
    assert.ok(all.peakValue <= all.peakBase + 1e-9 && all.peakBase <= all.value + 1e-9, `${where} 高峰 ≤ 有峰谷价的 ≤ 全部`)
    const projectSum = Object.values(all.byProject).reduce((sum, value) => sum + value, 0)
    for (const value of Object.values(all.byProject)) assert.ok(finite(value) && value >= 0, `${where} 项目费用`)
    close(projectSum, all.spend, `${where} 项目之和 = 合计（包月的钱也直接算在项目上）`)
    // 相邻两段：[first, mid] + [mid+1, todayKey] = [first, todayKey]
    const first = keys[0]
    const mid = keys[int(rand, keys.length)]
    const next = localDateKey(addDays(parseDateKey(mid), 1))
    const left = computeCosts(daily, first, mid, settings, todayKey, options)
    const right = computeCosts(daily, next, todayKey, settings, todayKey, options)
    const whole = computeCosts(daily, first, todayKey, settings, todayKey, options)
    close(left.spend + right.spend, whole.spend, `${where} 花费可加（${first}~${mid} + ${next}~${todayKey}）`)
    close(left.value + right.value, whole.value, `${where} 官方价折算可加`)
  }
})

test('fuzz computeCosts：倍数与汇率是线性的', () => {
  const rand = mulberry32(7)
  for (let scenario = 0; scenario < 200; scenario += 1) {
    const daily = randomDaily(rand)
    if (!daily.length) continue
    const todayKey = daily[daily.length - 1].date
    const factor = 0.05 + rand()
    const everyone = Object.fromEntries(PROVIDERS.map((id) => [id, { mode: 'multiplier', factor }]))
    const base = computeCosts(daily, '', todayKey, everyone, todayKey, { table: TABLE, usdCny: 7 })
    close(base.spend, base.value * factor, `scenario ${scenario} 全部打折：花费 = 官方价 × 倍数`)
    // 只看美元计价的那部分：汇率翻倍，它也翻倍
    const doubled = computeCosts(daily, '', todayKey, everyone, todayKey, { table: TABLE, usdCny: 14 })
    close(doubled.value - base.value, base.usdValue, `scenario ${scenario} 汇率翻倍只影响美元部分`)
  }
})

test('fuzz computeCosts：包月 = 用量按统一价（高峰价）换算，和设成「打折 ×1」完全一样；只有官方价分峰谷，所以不会比统一价贵', () => {
  const rand = mulberry32(11)
  for (let scenario = 0; scenario < 150; scenario += 1) {
    const daily = randomDaily(rand)
    if (!daily.length) continue
    const todayKey = daily[daily.length - 1].date
    const options = { table: TABLE, usdCny: 7 }
    const asPlan = computeCosts(daily, '', todayKey, Object.fromEntries(PROVIDERS.map((id) => [id, { mode: 'plan', monthly: 199 }])), todayKey, options)
    const asFactor = computeCosts(daily, '', todayKey, Object.fromEntries(PROVIDERS.map((id) => [id, { mode: 'multiplier', factor: 1 }])), todayKey, options)
    const asOfficial = computeCosts(daily, '', todayKey, Object.fromEntries(PROVIDERS.map((id) => [id, { mode: 'official' }])), todayKey, options)
    close(asPlan.spend, asFactor.spend, `scenario ${scenario} 包月 = 打折 ×1`)
    for (const id of PROVIDERS) if (asPlan.byProvider[id]) close(asPlan.byProvider[id].spend, asFactor.byProvider[id].spend, `scenario ${scenario} ${id}`)
    assert.equal(asPlan.peakBase, 0, `scenario ${scenario} 包月不进高峰占比`)
    assert.ok(asOfficial.spend <= asPlan.spend + 1e-9, `scenario ${scenario} 官方价（有空闲时段）不高于统一价（全按高峰价）`)
  }
})
test('fuzz rangeWindow / deltaWindows：窗口在今天以内、天数对得上；上一期在本期之前且不更长', () => {
  const rand = mulberry32(3)
  const base = new Date(2026, 0, 1)
  for (let scenario = 0; scenario < 600; scenario += 1) {
    const today = addDays(base, int(rand, 365 * 3))
    const todayKey = localDateKey(today)
    const range = pick(rand, ['day', 'week', 'month', 'all', 'custom'])
    const custom = { startKey: localDateKey(addDays(today, -int(rand, 400) + 20)), endKey: localDateKey(addDays(today, -int(rand, 400) + 20)) }
    const win = rangeWindow(range, todayKey, custom)
    const where = `${range} ${todayKey} ${JSON.stringify(custom)}`
    assert.ok(win.endKey <= todayKey, `${where} 终点不晚于今天`)
    if (!win.startKey) {
      assert.equal(range, 'all', `${where} 只有累计没有起点`)
      continue
    }
    assert.ok(win.startKey <= win.endKey, `${where} 起点不晚于终点`)
    if (range === 'week') assert.equal(parseDateKey(win.startKey).getDay(), 1, `${where} 本周从周一起算`)
    if (range === 'day') assert.ok(win.startKey === todayKey && win.endKey === todayKey, `${where} 本日就是今天`)
    assert.equal(win.days, daysBetween(parseDateKey(win.startKey), parseDateKey(win.endKey)), `${where} 天数`)
    const delta = deltaWindows(win, todayKey)
    if (!delta) continue
    const length = (window) => daysBetween(parseDateKey(window.startKey), parseDateKey(window.endKey))
    assert.ok(delta.previous.endKey < delta.current.startKey, `${where} 上一期在本期之前`)
    assert.ok(delta.current.startKey === win.startKey && delta.current.endKey <= win.endKey, `${where} 本期在窗口内`)
    assert.ok(length(delta.previous) <= length(delta.current), `${where} 上一期不比本期长`)
    if (range === 'week') assert.equal(parseDateKey(delta.previous.startKey).getDay(), 1, `${where} 上一期也从周一起算`)
    if (range !== 'month') assert.equal(length(delta.previous), length(delta.current), `${where} 本周 / 自定义：一样长`)
  }
})

/* -------------------------------------------------------- 宿主：折叠与聚合 */

import { aggregate, foldSnapshot, slotRows } from '../index.js'

const HOST_PROVIDERS = ['deepseek-official', 'gw|east', 'relay', '__proto__', '', 'a\u0000b']
const HOST_MODELS = ['deepseek-v4-1-flash-261017', 'DeepSeek-V4-Pro', 'claude-sonnet-4-5-20250929-thinking', 'kimi-k2-0905-preview', 'my|model', undefined]
const HOST_CWDS = ['C:\code\atlas', 'c:/code/atlas/', '/srv/a|b', '', undefined, '__proto__']

/** 一步的用量：各种坏写法都来一点（负数、字符串、只有 totalTokens、整个 usage 缺失）。 */
function randomUsage(rand) {
  const roll = rand()
  if (roll < 0.05) return undefined
  if (roll < 0.12) return { totalTokens: int(rand, 5000) }
  const part = () => (rand() < 0.1 ? pick(rand, [-5, 'x', null, Number.NaN]) : int(rand, 3000))
  const usage = { inputTokens: part(), outputTokens: part(), cacheReadTokens: part(), cacheWriteTokens: rand() < 0.7 ? 0 : part() }
  if (rand() < 0.5) usage.totalTokens = int(rand, 9000)
  return usage
}

test('fuzz aggregate：每天的 slots 四项之和 = 当天总量；各家四项之和 = 各家总量；每天之和 = 总量；不改到对象原型', () => {
  const rand = mulberry32(424242)
  const base = new Date(2026, 9, 25).getTime()
  for (let scenario = 0; scenario < 150; scenario += 1) {
    const sessions = []
    const count = 1 + int(rand, 6)
    for (let index = 0; index < count; index += 1) {
      const events = []
      let time = base + int(rand, 20) * 86400000
      for (let seq = 0; seq < 1 + int(rand, 25); seq += 1) {
        time += int(rand, 5 * 3600000)
        if (rand() < 0.04) {
          events.push(pick(rand, [null, 7, 'x']))
          continue
        }
        const source = {}
        const provider = pick(rand, HOST_PROVIDERS)
        const model = pick(rand, HOST_MODELS)
        if (provider !== undefined) source.provider = provider
        if (model !== undefined) source.model = model
        events.push({ seq, time, type: 'assistant/message', data: { usage: randomUsage(rand), message: { source } } })
      }
      const parent = rand() < 0.3 && index > 0 ? `s${int(rand, index)}` : rand() < 0.2 ? 'gone' : undefined
      sessions.push(foldSnapshot({ session: { id: `s${index}`, cwd: pick(rand, HOST_CWDS), parentSession: parent }, inheritedEventCount: parent ? int(rand, 4) : 0, events }))
    }
    const { totals, daily } = aggregate(sessions, base + 30 * 86400000, new Set(sessions.map((fold) => fold.sessionId)))
    const where = `scenario ${scenario}`
    assert.equal({}.inputTokens, undefined, `${where} 原型被改了`)
    let dailySum = 0
    for (const entry of daily) {
      const slotSum = entry.slots.reduce((sum, row) => sum + row[4] + row[5] + row[6] + row[7], 0)
      assert.equal(slotSum, entry.tokens, `${where} ${entry.date} slots`)
      const usageSum = Object.values(entry.providerUsage).reduce((sum, usage) => sum + usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens + usage.outputTokens, 0)
      assert.equal(usageSum, entry.tokens, `${where} ${entry.date} providerUsage`)
      for (const [provider, tokens] of Object.entries(entry.byProvider)) {
        const usage = entry.providerUsage[provider]
        assert.equal(usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens + usage.outputTokens, tokens, `${where} ${entry.date} ${provider}`)
      }
      assert.equal(entry.inputTokens + entry.cacheReadTokens + entry.cacheWriteTokens + entry.outputTokens, entry.tokens, `${where} ${entry.date} 四项`)
      assert.equal(Object.values(entry.byProject).reduce((sum, value) => sum + value, 0), entry.tokens, `${where} ${entry.date} 项目`)
      for (const row of entry.slots) assert.ok(typeof row[1] === 'string' && typeof row[2] === 'string' && typeof row[3] === 'string', `${where} slot 名字`)
      dailySum += entry.tokens
    }
    // 没有时间的步也算进总量但进不了每天：这里每步都有时间，两边必须相等
    assert.equal(dailySum, totals.tokens, `${where} 每天之和`)
    assert.ok(Number.isFinite(totals.tokens) && totals.tokens >= 0, `${where} 总量`)
  }
})

test('fuzz slotRows：键里的名字带 | 也能原样拆回来', () => {
  const rand = mulberry32(99)
  for (let scenario = 0; scenario < 300; scenario += 1) {
    const name = () => Array.from({ length: int(rand, 6) }, () => pick(rand, ['a', '|', '/', ' ', '中'])).join('')
    const parts = [int(rand, 9e5), name(), name(), name()]
    const [row] = slotRows({ [parts.join('\u0000')]: [1, 2, 3, 4] })
    assert.deepEqual(row, [...parts, 1, 2, 3, 4], JSON.stringify(parts))
  }
})
