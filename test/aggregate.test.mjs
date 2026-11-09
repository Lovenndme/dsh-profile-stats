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
    assistantEvent({ seq: 0, time: DAY_1, input: 400, output: 100, total: 500, provider: 'alpha', model: 'deepseek-v4-1-flash' }),
    assistantEvent({ seq: 1, time: DAY_2, input: 200, output: 200, cacheRead: 600, total: 1000, provider: 'bravo', model: 'deepseek-v4-pro' }),
    turnStartEvent({ seq: 2, time: DAY_2, turn: 't1' }),
    turnEndEvent({ seq: 3, time: DAY_2 + 45000, turn: 't1' }),
  ])
  const s2 = foldOf('s2', [
    assistantEvent({ seq: 0, time: DAY_2, input: 100, output: 50, total: 150, provider: 'alpha', model: 'deepseek-v4-1-flash' }),
  ])
  return [s1, s2]
}

test('aggregate：总量、每日、峰值、连续天数口径一致', () => {
  const { totals, daily } = aggregate(corpus(), NOW, new Set(['s1', 's2']))

  assert.equal(totals.tokens, 1650)
  assert.equal(totals.calls, 3)
  assert.equal(totals.inputTokens, 700)
  assert.equal(totals.outputTokens, 350)
  assert.equal(totals.cacheReadTokens, 600)
  assert.equal(totals.cacheWriteTokens, 0)
  assert.equal(totals.usageMismatchCalls, 0)
  assert.equal(totals.sessions, 2)
  assert.equal(totals.activeDays, 2)
  assert.equal(totals.firstDay, '2026-11-05')
  assert.equal(totals.lastDay, '2026-11-06')

  assert.deepEqual(daily.map((entry) => entry.date), ['2026-11-05', '2026-11-06'])
  const [day1, day2] = daily
  const shape = (entry) => ({
    tokens: entry.tokens,
    calls: entry.calls,
    input: entry.inputTokens,
    output: entry.outputTokens,
    cacheRead: entry.cacheReadTokens,
    cacheWrite: entry.cacheWriteTokens,
  })
  assert.deepEqual(shape(day1), { tokens: 500, calls: 1, input: 400, output: 100, cacheRead: 0, cacheWrite: 0 })
  assert.deepEqual(shape(day2), { tokens: 1150, calls: 2, input: 300, output: 250, cacheRead: 600, cacheWrite: 0 })
  // 每天四项之和 = 当天总量（Token 构成的几行加起来等于大数字）
  for (const entry of daily) {
    assert.equal(entry.inputTokens + entry.cacheReadTokens + entry.cacheWriteTokens + entry.outputTokens, entry.tokens, entry.date)
  }
  assert.deepEqual(day2.byProvider, { bravo: 1000, alpha: 150 })
  assert.deepEqual(day2.providerUsage, {
    bravo: { inputTokens: 200, cacheReadTokens: 600, cacheWriteTokens: 0, outputTokens: 200 },
    alpha: { inputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 50 },
  })
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
    assistantEvent({ seq: 0, time: DAY_1, input: 200, output: 100, total: 300, provider: 'alpha', model: 'deepseek-v4-1-flash' }),
    assistantEvent({ seq: 1, time: DAY_1, input: 200, output: 100, total: 300, provider: 'alpha', model: 'deepseek-v4-1-flash' }),
  ]
  const copy = foldOf(
    'copy',
    [...prefix, assistantEvent({ seq: 2, time: DAY_2, input: 400, output: 100, total: 500, provider: 'bravo', model: 'deepseek-v4-pro' })],
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
  assert.deepEqual(daily[0].byProvider, { alpha: 600 })
  assert.deepEqual(daily[1].byProvider, { bravo: 500 })
  assert.equal(daily[0].inputTokens, 400)
  assert.equal(daily[0].outputTokens, 200)
  assert.equal(totals.inputTokens, 800)
  assert.equal(totals.outputTokens, 300)
  assert.deepEqual(totals.byProvider, { alpha: 600, bravo: 500 })
  assert.deepEqual(totals.byModel, { 'deepseek-v4-1-flash': 600, 'deepseek-v4-pro': 500 })
  assert.equal(daily.reduce((sum, entry) => sum + entry.tokens, 0), totals.tokens)
})

test('aggregate：原件还在语料里时不重复计数（前缀只记账、不进总量与每日）', () => {
  const origin = foldOf('origin', [
    assistantEvent({ seq: 0, time: DAY_1, input: 200, output: 100, total: 300, provider: 'alpha', model: 'deepseek-v4-1-flash' }),
    assistantEvent({ seq: 1, time: DAY_1, input: 200, output: 100, total: 300, provider: 'alpha', model: 'deepseek-v4-1-flash' }),
  ])
  const copyFold = foldSnapshot({
    session: { id: 'copy', parentSession: 'origin' },
    inheritedEventCount: 2,
    events: [
      assistantEvent({ seq: 0, time: DAY_1, input: 200, output: 100, total: 300, provider: 'alpha', model: 'deepseek-v4-1-flash' }),
      assistantEvent({ seq: 1, time: DAY_1, input: 200, output: 100, total: 300, provider: 'alpha', model: 'deepseek-v4-1-flash' }),
      assistantEvent({ seq: 2, time: DAY_2, input: 400, output: 100, total: 500, provider: 'bravo', model: 'deepseek-v4-pro' }),
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
  assert.deepEqual(daily[0].byProvider, { alpha: 600 })
  assert.equal(totals.byProvider.alpha, 600)
})

test('aggregate：多个孤儿前缀各按自己的明细补回', () => {
  const makeCopy = (id) =>
    foldSnapshot({
      session: { id, parentSession: `gone-${id}` },
      inheritedEventCount: 1,
      events: [
        assistantEvent({ seq: 0, time: DAY_1, input: 100, output: 20, total: 120, provider: 'charlie', model: 'deepseek-v4-pro' }),
        assistantEvent({ seq: 1, time: DAY_2, input: 10, output: 5, total: 15, provider: 'bravo', model: 'deepseek-v4-1-flash' }),
      ],
    })
  const { totals, daily } = aggregate([makeCopy('a'), makeCopy('b')], NOW, new Set(['a', 'b']))
  assert.equal(totals.orphanedTokens, 240)
  assert.equal(totals.orphanedSessions, 2)
  assert.equal(totals.tokens, 2 * 120 + 2 * 15)
  assert.equal(daily.find((entry) => entry.date === '2026-11-05').tokens, 240)
  assert.deepEqual(daily.find((entry) => entry.date === '2026-11-05').byProvider, { 'charlie': 240 })
})

test('aggregate：孤儿前缀补回时，缓存读写和各家四项用量也用前缀自己的数', () => {
  const copy = foldSnapshot({
    session: { id: 'copy', parentSession: 'gone' },
    inheritedEventCount: 1,
    events: [
      // 前缀：旧日志没有 totalTokens，缓存 900 不能丢
      assistantEvent({ seq: 0, time: DAY_1, input: 100, cacheRead: 900, cacheWrite: 30, output: 20, provider: 'alpha' }),
      assistantEvent({ seq: 1, time: DAY_1, input: 50, cacheRead: 0, output: 10, total: 60, provider: 'bravo' }),
    ],
  })
  const { totals, daily } = aggregate([copy], NOW, new Set(['copy']))
  assert.equal(totals.tokens, 1050 + 60)
  assert.equal(totals.cacheReadTokens, 900)
  assert.equal(totals.cacheWriteTokens, 30)
  assert.equal(daily.length, 1)
  assert.equal(daily[0].cacheReadTokens, 900)
  assert.equal(daily[0].cacheWriteTokens, 30)
  assert.deepEqual(daily[0].providerUsage, {
    alpha: { inputTokens: 100, cacheReadTokens: 900, cacheWriteTokens: 30, outputTokens: 20 },
    bravo: { inputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 10 },
  })
  assert.equal(daily[0].tokens, totals.tokens)
})

test('aggregate：单日峰值取严格最大，最早出现的胜出', () => {
  const first = foldOf('d1', [assistantEvent({ seq: 0, time: localNoon(2026, 11, 1), input: 1000, output: 0, total: 1000 })])
  const second = foldOf('d2', [assistantEvent({ seq: 0, time: localNoon(2026, 11, 2), input: 900, output: 0, total: 900 })])
  const { totals } = aggregate([first, second], NOW, new Set(['d1', 'd2']))
  assert.deepEqual(totals.peakDay, { date: '2026-11-01', tokens: 1000 })
})

test('projectOf：工作目录 → 项目键；Windows 路径不分大小写、斜杠统一，末尾分隔符去掉', async () => {
  const { projectOf } = await import('../index.js')
  assert.deepEqual(projectOf('C:\\Users\\me\\code\\atlas\\'), { key: 'c:/users/me/code/atlas', path: 'C:\\Users\\me\\code\\atlas' })
  assert.equal(projectOf('c:/users/me/code/atlas').key, projectOf('C:\\Users\\Me\\Code\\Atlas').key, '同一个目录的不同写法归到同一个项目')
  assert.deepEqual(projectOf('/home/me/proj/'), { key: '/home/me/proj', path: '/home/me/proj' }, 'POSIX 路径区分大小写，原样当键')
  assert.deepEqual(projectOf('  '), { key: '', path: '' })
  assert.deepEqual(projectOf(undefined), { key: '', path: '' })
  assert.deepEqual(projectOf(42), { key: '', path: '' })
})

test('aggregate：按项目（工作目录）记每天的 token，子代理会话另记一份；孤儿前缀也记到会话自己的项目', () => {
  const main = foldSnapshot({
    session: { id: 'main', cwd: 'C:\\code\\atlas' },
    events: [
      assistantEvent({ seq: 0, time: DAY_1, input: 100, output: 0, total: 100 }),
      assistantEvent({ seq: 1, time: DAY_2, input: 50, output: 0, total: 50 }),
    ],
  })
  const helper = foldSnapshot({
    session: { id: 'helper', cwd: 'c:/code/atlas/', origin: 'subagent', parentSession: 'main', delegationDepth: 1 },
    events: [assistantEvent({ seq: 0, time: DAY_2, input: 30, output: 0, total: 30 })],
  })
  const other = foldSnapshot({
    session: { id: 'other', cwd: '/srv/beacon' },
    inheritedEventCount: 1,
    events: [
      // 孤儿前缀（原件不在）：补回时也记到这个会话的项目
      assistantEvent({ seq: 0, time: DAY_1, input: 7, output: 0, total: 7 }),
      assistantEvent({ seq: 1, time: DAY_2, input: 9, output: 0, total: 9 }),
    ],
  })
  const unknown = foldSnapshot({ session: { id: 'nocwd' }, events: [assistantEvent({ seq: 0, time: DAY_2, input: 4, output: 0, total: 4 })] })
  assert.equal(helper.subagent, true)
  assert.equal(main.subagent, false)
  assert.equal(main.cwd, 'C:\\code\\atlas')

  const { daily, projects, totals } = aggregate([main, helper, other, unknown], NOW, new Set(['main', 'helper', 'other', 'nocwd']))
  const [day1, day2] = daily
  assert.deepEqual(day1.byProject, { 'c:/code/atlas': 100, '/srv/beacon': 7 })
  assert.deepEqual(day2.byProject, { 'c:/code/atlas': 80, '/srv/beacon': 9, '': 4 })
  assert.deepEqual(day2.byProjectSubagent, { 'c:/code/atlas': 30 })
  assert.deepEqual(day1.byProjectSubagent, {})
  assert.deepEqual(projects, { 'c:/code/atlas': 'C:\\code\\atlas', '/srv/beacon': '/srv/beacon' })
  // 各项目之和 = 当天总量
  for (const entry of daily) {
    assert.equal(Object.values(entry.byProject).reduce((sum, value) => sum + value, 0), entry.tokens, entry.date)
  }
  assert.equal(daily.reduce((sum, entry) => sum + entry.tokens, 0), totals.tokens)
})
