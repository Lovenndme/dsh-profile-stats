import assert from 'node:assert/strict'
import test from 'node:test'

import { aggregate, foldSnapshot } from '../index.js'
import { assistantEvent, turnEndEvent, turnStartEvent } from './helpers/fake-host.mjs'

const localNoon = (year, month, day, hour = 12) => new Date(year, month - 1, day, hour, 0, 0, 0).getTime()

const DAY_1 = localNoon(2026, 11, 5)
const DAY_2 = localNoon(2026, 11, 6)
const NOW = localNoon(2026, 11, 6, 18)

function foldOf(id, events, extra = {}) {
  return foldSnapshot({ session: { id }, events, ...extra })
}

/** 两个普通会话：s1 跨两天两种供应商/模型，s2 只有一天一次调用。 */
function corpus() {
  const s1 = foldOf('s1', [
    assistantEvent({ seq: 0, time: DAY_1, input: 400, output: 100, total: 500, provider: 'myapi', model: 'deepseek-v4-1-flash' }),
    assistantEvent({ seq: 1, time: DAY_2, input: 800, output: 200, cacheRead: 600, total: 1000, provider: 'wincode', model: 'deepseek-v4-pro' }),
    turnStartEvent({ seq: 2, time: DAY_2, turn: 't1' }),
    turnEndEvent({ seq: 3, time: DAY_2 + 45000, turn: 't1' }),
  ])
  const s2 = foldOf('s2', [
    assistantEvent({ seq: 0, time: DAY_2, input: 100, output: 50, total: 150, provider: 'myapi', model: 'deepseek-v4-1-flash' }),
  ])
  return [s1, s2]
}

test('aggregate：总量、每日、峰值、连续天数口径一致', () => {
  const { totals, daily } = aggregate(corpus(), NOW, new Set(['s1', 's2']))

  assert.equal(totals.tokens, 1650)
  assert.equal(totals.calls, 3)
  assert.equal(totals.inputTokens, 1300)
  assert.equal(totals.outputTokens, 350)
  assert.equal(totals.cacheReadTokens, 600)
  assert.equal(totals.cacheWriteTokens, 0)
  assert.equal(totals.sessions, 2)
  assert.equal(totals.activeDays, 2)
  assert.equal(totals.firstDay, '2026-11-05')
  assert.equal(totals.lastDay, '2026-11-06')

  assert.deepEqual(daily.map((entry) => entry.date), ['2026-11-05', '2026-11-06'])
  const [day1, day2] = daily
  assert.deepEqual(
    { tokens: day1.tokens, calls: day1.calls, input: day1.inputTokens, output: day1.outputTokens, cache: day1.cacheTokens },
    { tokens: 500, calls: 1, input: 400, output: 100, cache: 0 },
  )
  assert.deepEqual(
    { tokens: day2.tokens, calls: day2.calls, input: day2.inputTokens, output: day2.outputTokens, cache: day2.cacheTokens },
    { tokens: 1150, calls: 2, input: 900, output: 250, cache: 600 },
  )
  assert.deepEqual(day2.byProvider, { wincode: 1000, myapi: 150 })
  assert.deepEqual(day2.byModel, { 'deepseek-v4-pro': 1000, 'deepseek-v4-1-flash': 150 })

  assert.deepEqual(totals.peakDay, { date: '2026-11-06', tokens: 1150 })
  assert.equal(totals.peakStepTokens, 1000)
  assert.equal(totals.peakStepSession, 's1')
  assert.equal(totals.peakSessionTokens, 1500)
  assert.equal(totals.peakSession, 's1')
  assert.equal(totals.longestTurnMs, 45000)
  assert.equal(totals.longestTurnSession, 's1')
  assert.equal(totals.longestStreak, 2)
  assert.equal(totals.currentStreak, 2)

  // 按 provider / 模型拆出来的合计必须等于总量，否则页面上两处相加对不上。
  const providerSum = Object.values(totals.byProvider).reduce((sum, value) => sum + value, 0)
  const modelSum = Object.values(totals.byModel).reduce((sum, value) => sum + value, 0)
  assert.equal(providerSum, totals.tokens)
  assert.equal(modelSum, totals.tokens)
  assert.equal(daily.reduce((sum, entry) => sum + entry.tokens, 0), totals.tokens)
  assert.equal(totals.inheritedTokens, 0)
  assert.equal(totals.orphanedTokens, 0)
  assert.equal(totals.tokensWithInherited, totals.tokens)
})

test('aggregate：空语料返回全零结构（不出现 NaN / undefined）', () => {
  const { totals, daily } = aggregate([], NOW, new Set())
  assert.deepEqual(daily, [])
  for (const [key, value] of Object.entries(totals)) {
    if (typeof value === 'number') assert.ok(Number.isFinite(value), `${key} 必须是有限数字，实际 ${value}`)
  }
  assert.equal(totals.sessions, 0)
  assert.equal(totals.activeDays, 0)
  assert.equal(totals.firstDay, '')
  assert.equal(totals.lastDay, '')
  assert.deepEqual(totals.peakDay, { date: '', tokens: 0 })
  assert.equal(totals.longestStreak, 0)
  assert.equal(totals.currentStreak, 0)
  assert.deepEqual(totals.byProvider, {})
  assert.deepEqual(totals.byModel, {})
})

test('aggregate：孤儿继承前缀补回总量与每日明细（原件已不在语料里）', () => {
  const prefix = [
    assistantEvent({ seq: 0, time: DAY_1, input: 200, output: 100, total: 300, provider: 'myapi', model: 'deepseek-v4-1-flash' }),
    assistantEvent({ seq: 1, time: DAY_1, input: 200, output: 100, total: 300, provider: 'myapi', model: 'deepseek-v4-1-flash' }),
  ]
  const copy = foldOf(
    'copy',
    [...prefix, assistantEvent({ seq: 2, time: DAY_2, input: 400, output: 100, total: 500, provider: 'wincode', model: 'deepseek-v4-pro' })],
    { inheritedEventCount: 2 },
  )
  const { totals, daily } = aggregate([copy], NOW, new Set(['copy']))

  assert.equal(totals.tokens, 1100, '总花费 600（前缀）+ 500（本体）都要算进去')
  assert.equal(totals.calls, 3)
  assert.equal(totals.inheritedTokens, 0)
  assert.equal(totals.orphanedTokens, 600)
  assert.equal(totals.orphanedSessions, 1)
  assert.equal(totals.tokensWithInherited, totals.tokens, '已经补进来的前缀不该再被 tokensWithInherited 加一次')

  // 每日明细也必须用「前缀自己的数」，不能把本体的 500 当成前缀金额补到第一天。
  assert.deepEqual(daily.map((entry) => entry.date), ['2026-11-05', '2026-11-06'])
  assert.equal(daily[0].tokens, 600)
  assert.equal(daily[1].tokens, 500)
  assert.deepEqual(daily[0].byProvider, { myapi: 600 })
  assert.deepEqual(daily[1].byProvider, { wincode: 500 })
  assert.equal(daily[0].inputTokens, 400)
  assert.equal(daily[0].outputTokens, 200)
  assert.equal(totals.inputTokens, 800)
  assert.equal(totals.outputTokens, 300)
  assert.deepEqual(totals.byProvider, { myapi: 600, wincode: 500 })
  assert.deepEqual(totals.byModel, { 'deepseek-v4-1-flash': 600, 'deepseek-v4-pro': 500 })
  assert.equal(daily.reduce((sum, entry) => sum + entry.tokens, 0), totals.tokens)
})

test('aggregate：原件还在语料里时不重复计数（前缀只记账、不进总量与每日）', () => {
  const origin = foldOf('origin', [
    assistantEvent({ seq: 0, time: DAY_1, input: 200, output: 100, total: 300, provider: 'myapi', model: 'deepseek-v4-1-flash' }),
    assistantEvent({ seq: 1, time: DAY_1, input: 200, output: 100, total: 300, provider: 'myapi', model: 'deepseek-v4-1-flash' }),
  ])
  const copyFold = foldSnapshot({
    session: { id: 'copy', parentSession: 'origin' },
    inheritedEventCount: 2,
    events: [
      assistantEvent({ seq: 0, time: DAY_1, input: 200, output: 100, total: 300, provider: 'myapi', model: 'deepseek-v4-1-flash' }),
      assistantEvent({ seq: 1, time: DAY_1, input: 200, output: 100, total: 300, provider: 'myapi', model: 'deepseek-v4-1-flash' }),
      assistantEvent({ seq: 2, time: DAY_2, input: 400, output: 100, total: 500, provider: 'wincode', model: 'deepseek-v4-pro' }),
    ],
  })
  assert.equal(copyFold.inheritedTokens, 600)
  const { totals, daily } = aggregate([origin, copyFold], NOW, new Set(['origin', 'copy']))

  assert.equal(totals.tokens, 600 + 500, '两份会话本体 + 原件本体，前缀不算')
  assert.equal(totals.inheritedTokens, 600, '前缀单独记账，供页面核对')
  assert.equal(totals.inheritedSessions, 1)
  assert.equal(totals.orphanedTokens, 0)
  assert.equal(totals.tokensWithInherited, 1700, '日志原始合计 = 去重总量 + 重复前缀')
  assert.deepEqual(daily.map((entry) => entry.date), ['2026-11-05', '2026-11-06'])
  assert.equal(daily[0].tokens, 600, '第一天只有原件本体，副本前缀不重复进每日')
  assert.deepEqual(daily[0].byProvider, { myapi: 600 })
  assert.equal(totals.byProvider.myapi, 600)
})

test('aggregate：多个孤儿前缀各按自己的明细补回', () => {
  const makeCopy = (id) =>
    foldSnapshot({
      session: { id, parentSession: `gone-${id}` },
      inheritedEventCount: 1,
      events: [
        assistantEvent({ seq: 0, time: DAY_1, input: 100, output: 0, total: 120, provider: 'arkcli-coding-plan', model: 'deepseek-v4-pro' }),
        assistantEvent({ seq: 1, time: DAY_2, input: 10, output: 5, total: 15, provider: 'wincode', model: 'deepseek-v4-1-flash' }),
      ],
    })
  const { totals, daily } = aggregate([makeCopy('a'), makeCopy('b')], NOW, new Set(['a', 'b']))
  assert.equal(totals.orphanedTokens, 240)
  assert.equal(totals.orphanedSessions, 2)
  assert.equal(totals.tokens, 2 * 120 + 2 * 15)
  assert.equal(daily.find((entry) => entry.date === '2026-11-05').tokens, 240)
  assert.deepEqual(daily.find((entry) => entry.date === '2026-11-05').byProvider, { 'arkcli-coding-plan': 240 })
})

test('aggregate：单日峰值取严格最大，最早出现的胜出', () => {
  const first = foldOf('d1', [assistantEvent({ seq: 0, time: localNoon(2026, 11, 1), input: 1000, output: 0, total: 1000 })])
  const second = foldOf('d2', [assistantEvent({ seq: 0, time: localNoon(2026, 11, 2), input: 900, output: 0, total: 900 })])
  const { totals } = aggregate([first, second], NOW, new Set(['d1', 'd2']))
  assert.deepEqual(totals.peakDay, { date: '2026-11-01', tokens: 1000 })
})
