import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyEvent,
  emptyFold,
  foldSnapshot,
  modelFamilyOf,
  normalizeModelId,
  providerOf,
  stepParts,
  stepTokens,
  usageMismatch,
  usageParts,
} from '../index.js'
import { assistantEvent, turnEndEvent, turnStartEvent } from './helpers/fake-host.mjs'

const localNoon = (year, month, day, hour = 12) => new Date(year, month - 1, day, hour, 0, 0, 0).getTime()

test('stepTokens：总量 = 未缓存输入 + 缓存读 + 缓存写 + 输出（四项互不重叠）', () => {
  assert.equal(stepTokens({ inputTokens: 100, outputTokens: 50 }), 150)
  assert.equal(stepTokens({ inputTokens: 100, cacheReadTokens: 900, cacheWriteTokens: 20, outputTokens: 50, totalTokens: 1070 }), 1070)
  // 旧版 DSH 日志（2026-08 ~ 09）有的步骤没写 totalTokens：旧实现退回「输入 + 输出」= 150，缓存 900 整块漏掉
  assert.equal(stepTokens({ inputTokens: 100, cacheReadTokens: 900, outputTokens: 50 }), 1050)
  // totalTokens 和四项对不上时不拿它当总量（只在 usageMismatch 里计数）
  assert.equal(stepTokens({ inputTokens: 100, outputTokens: 50, totalTokens: 120 }), 150)
  assert.equal(stepTokens({ inputTokens: 100, outputTokens: 50, totalTokens: 999 }), 150)
  // 四项都没有时才用 totalTokens
  assert.equal(stepTokens({ totalTokens: 300 }), 300)
  assert.equal(stepTokens({}), 0)
  assert.equal(stepTokens({ inputTokens: '100', outputTokens: NaN, totalTokens: null }), 0)
  assert.equal(stepTokens({ inputTokens: -5, outputTokens: 10 }), 10, '负数按 0')
  assert.equal(stepTokens({ totalTokens: -5 }), 0)
})

test('usageParts / usageMismatch：只计数对不上的 totalTokens，没给 totalTokens 不算对不上', () => {
  assert.deepEqual(usageParts({ inputTokens: 5, cacheReadTokens: -1, outputTokens: 'x' }), {
    inputTokens: 5,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
  })
  assert.deepEqual(usageParts(undefined), { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 })
  assert.equal(usageMismatch({ inputTokens: 100, cacheReadTokens: 900, outputTokens: 50 }), false)
  assert.equal(usageMismatch({ inputTokens: 100, cacheReadTokens: 900, outputTokens: 50, totalTokens: 1050 }), false)
  assert.equal(usageMismatch({ inputTokens: 100, cacheReadTokens: 900, outputTokens: 50, totalTokens: 150 }), true)
  assert.equal(usageMismatch({ totalTokens: 10 }), true)
  assert.equal(usageMismatch(undefined), false)
})

test('providerOf：读 message.source.provider，缺失回落 unknown', () => {
  const event = (source) => ({ type: 'assistant/message', data: { message: { source } } })
  assert.equal(providerOf(event({ provider: 'alpha' })), 'alpha')
  assert.equal(providerOf(event({ provider: '  bravo  ' })), 'bravo')
  assert.equal(providerOf(event({ provider: '' })), 'unknown')
  assert.equal(providerOf(event({})), 'unknown')
  assert.equal(providerOf(event({ provider: 42 })), 'unknown')
  assert.equal(providerOf(event({ provider: '__proto__' })), '(__proto__)', '__proto__ 当不了普通对象的键')
  assert.equal(providerOf(event({ provider: 'a\u0000b' })), 'ab', '\u0000 是 slots 键的分隔符')
  assert.equal(providerOf({}), 'unknown')
  assert.equal(providerOf(null), 'unknown')
})

test('normalizeModelId：抹平大小写、点、下划线、厂商前缀、日期与版本后缀', () => {
  const cases = [
    ['deepseek-v4-1-flash-261017', 'deepseek-v4-1-flash'],
    ['deepseek-v4.1-flash', 'deepseek-v4-1-flash'],
    ['DeepSeek-V4-1-Flash', 'deepseek-v4-1-flash'],
    ['deepseek-v4-pro-20250101', 'deepseek-v4-pro'],
    ['openai/gpt-4o-2024-08-06', 'gpt-4o'],
    ['anthropic/claude-sonnet-4-5', 'claude-sonnet-4-5'],
    ['azure/gpt-4o-mini', 'gpt-4o-mini'],
    ['qwen-plus-latest', 'qwen-plus'],
    ['deepseek-v4-1-flash-preview', 'deepseek-v4-1-flash'],
    // 去掉版本号后不剩数字的不去：deepseek-v3 / v4 不能都变成 deepseek
    ['some-model-v2', 'some-model-v2'],
    ['deepseek-v3', 'deepseek-v3'],
    ['deepseek-v3-0324', 'deepseek-v3'],
    ['model-20250101-v2', 'model'],
    // 噪音反复去到不变；推理档位留在最后
    ['kimi-k2-0905-preview', 'kimi-k2'],
    ['kimi-k2-0905', 'kimi-k2'],
    ['claude-sonnet-4-5-20250929-thinking', 'claude-sonnet-4-5-thinking'],
    ['o3-high', 'o3-high'],
    // 「平台/厂商/模型」只取最后一段
    ['deepseek-ai/DeepSeek-V3', 'deepseek-v3'],
    ['Pro/deepseek-ai/DeepSeek-R1', 'deepseek-r1'],
    ['DeepSeek V4 Flash', 'deepseek-v4-flash'],
    // 不能当普通对象键的名字被换掉
    ['__proto__', 'proto'],
    ['  DeepSeek-V4-Pro  ', 'deepseek-v4-pro'],
    ['', ''],
    [undefined, ''],
    [null, ''],
    [42, '42'],
  ]
  for (const [input, expected] of cases) {
    assert.equal(normalizeModelId(input), expected, String(input))
  }
  // 幂等：归一化过的 id 再归一化一次不变（聚合时会重复取键，幂等才安全）。
  for (const [, expected] of cases) {
    if (!expected) continue
    assert.equal(normalizeModelId(expected), expected, expected)
  }
})

test('modelFamilyOf：没有模型信息时记 unknown，而不是空键', () => {
  const withModel = (model) => ({ type: 'assistant/message', data: { message: { source: { model } } } })
  assert.equal(modelFamilyOf(withModel('deepseek-v4-1-flash-261017')), 'deepseek-v4-1-flash')
  assert.equal(modelFamilyOf(withModel('')), 'unknown')
  assert.equal(modelFamilyOf({}), 'unknown')
  assert.equal(modelFamilyOf(null), 'unknown')
})

test('applyEvent：一次模型调用的全部口径同步累加', () => {
  const day = localNoon(2026, 11, 6)
  const fold = emptyFold('s1', day)
  // 没写 totalTokens 的旧日志步骤：总量按四项相加，缓存不能漏
  const event = assistantEvent({
    seq: 3,
    time: day,
    input: 1000,
    output: 100,
    cacheRead: 600,
    cacheWrite: 40,
    model: 'deepseek-v4-1-flash-261017',
    provider: 'alpha',
  })
  applyEvent(fold, event)

  assert.equal(fold.seq, 3)
  assert.equal(fold.calls, 1)
  assert.equal(fold.tokens, 1740)
  assert.equal(fold.inputTokens, 1000)
  assert.equal(fold.outputTokens, 100)
  assert.equal(fold.cacheReadTokens, 600)
  assert.equal(fold.cacheWriteTokens, 40)
  assert.equal(fold.maxStepTokens, 1740)
  assert.equal(fold.usageMismatchCalls, 0)
  assert.equal(fold.firstTime, day)
  assert.equal(fold.lastTime, day)
  assert.deepEqual(fold.perDay, { '2026-11-06': 1740 })
  assert.deepEqual(fold.perDayCalls, { '2026-11-06': 1 })
  assert.deepEqual(fold.perDayInput, { '2026-11-06': 1000 })
  assert.deepEqual(fold.perDayOutput, { '2026-11-06': 100 })
  assert.deepEqual(fold.perDayCacheRead, { '2026-11-06': 600 })
  assert.deepEqual(fold.perDayCacheWrite, { '2026-11-06': 40 })
  assert.deepEqual(fold.perProvider, { alpha: 1740 })
  assert.deepEqual(fold.perDayProvider, { '2026-11-06': { alpha: 1740 } })
  assert.deepEqual(fold.perDayProviderUsage, {
    '2026-11-06': { alpha: { inputTokens: 1000, cacheReadTokens: 600, cacheWriteTokens: 40, outputTokens: 100 } },
  })
  assert.deepEqual(fold.perModel, { 'deepseek-v4-1-flash': 1740 })
  assert.deepEqual(fold.perDayModel, { '2026-11-06': { 'deepseek-v4-1-flash': 1740 } })

  // totalTokens 和四项对不上：总量仍按四项，只计一次 mismatch
  applyEvent(fold, assistantEvent({ seq: 4, time: day, input: 10, output: 5, total: 999, provider: 'alpha' }))
  assert.equal(fold.tokens, 1755)
  assert.equal(fold.usageMismatchCalls, 1)
})

test('applyEvent：没有 usage 的 assistant/message 不算一次调用', () => {
  const fold = emptyFold('s1', 0)
  applyEvent(fold, assistantEvent({ seq: 1, time: localNoon(2026, 11, 6), usage: false }))
  assert.equal(fold.calls, 0)
  assert.equal(fold.tokens, 0)
  assert.equal(fold.maxStepTokens, 0)
  assert.deepEqual(fold.perDay, {}, '没有用量就不该出现在每日表里')
  assert.deepEqual(fold.perModel, {})
  assert.deepEqual(fold.perProvider, {})
})

test('applyEvent：没有时间戳也要计数（只是进不了每日表）', () => {
  const fold = emptyFold('s1', 0)
  applyEvent(fold, assistantEvent({ seq: 1, time: 0, input: 10, output: 5, provider: 'alpha', model: 'x' }))
  assert.equal(fold.tokens, 15)
  assert.equal(fold.calls, 1)
  assert.deepEqual(fold.perDay, {})
  assert.deepEqual(fold.perDayProvider, {})
  assert.deepEqual(fold.perDayModel, {})
  // 不需要日期的口径必须照记，否则按 provider / 模型拆出来的合计会小于总量。
  assert.deepEqual(fold.perProvider, { alpha: 15 })
  assert.deepEqual(fold.perModel, { x: 15 })
})

test('applyEvent：多次调用累加，seq / 时间取首末与最大', () => {
  const fold = emptyFold('s1', 0)
  const early = localNoon(2026, 11, 5)
  const late = localNoon(2026, 11, 6)
  applyEvent(fold, assistantEvent({ seq: 5, time: late, input: 100, output: 0 }))
  applyEvent(fold, assistantEvent({ seq: 2, time: early, input: 200, output: 0 }))
  assert.equal(fold.seq, 5)
  assert.equal(fold.firstTime, early)
  assert.equal(fold.lastTime, late)
  assert.equal(fold.tokens, 300)
  assert.deepEqual(fold.perDay, { '2026-11-05': 200, '2026-11-06': 100 })
})

test('applyEvent：turn/start → turn/end 记录最长任务用时', () => {
  const fold = emptyFold('s1', 0)
  const start = localNoon(2026, 11, 6, 10)
  applyEvent(fold, turnStartEvent({ seq: 1, time: start, turn: 't1' }))
  applyEvent(fold, turnStartEvent({ seq: 2, time: start + 1000, turn: 't2' }))
  assert.equal(fold.longestTurnMs, 0, 'turn 还没结束时不产生用时')
  applyEvent(fold, turnEndEvent({ seq: 3, time: start + 60000, turn: 't1' }))
  assert.equal(fold.longestTurnMs, 60000)
  applyEvent(fold, turnEndEvent({ seq: 4, time: start + 5000, turn: 't2' }))
  assert.equal(fold.longestTurnMs, 60000, '更短的 turn 不覆盖最长值')
  assert.deepEqual(fold.openTurns, {}, '结束的 turn 必须从 openTurns 里删掉')
})

test('applyEvent：畸形 turn 事件不污染用时', () => {
  const fold = emptyFold('s1', 0)
  const start = localNoon(2026, 11, 6, 10)
  applyEvent(fold, turnEndEvent({ seq: 1, time: start, turn: 'never-started' }))
  assert.equal(fold.longestTurnMs, 0)
  applyEvent(fold, turnStartEvent({ seq: 2, time: start, turn: 7 }))
  applyEvent(fold, turnEndEvent({ seq: 3, time: start - 1000, turn: 7 }))
  assert.equal(fold.longestTurnMs, 0, '时钟回拨（end < start）不该产生负数/超大值')
  assert.deepEqual(fold.openTurns, {})
  // turn 缺省
  applyEvent(fold, { type: 'turn/start', data: {} })
  applyEvent(fold, { type: 'turn/end', data: {} })
  assert.equal(fold.longestTurnMs, 0)
})

test('applyEvent：不认识的事件类型不动统计口径（只推进水位）', () => {
  const fold = emptyFold('s1', 0)
  const before = {
    tokens: fold.tokens,
    calls: fold.calls,
    perDay: JSON.stringify(fold.perDay),
    perProvider: JSON.stringify(fold.perProvider),
    perModel: JSON.stringify(fold.perModel),
    longestTurnMs: fold.longestTurnMs,
  }
  applyEvent(fold, { seq: 9, time: localNoon(2026, 11, 6), type: 'user/message', data: { text: 'hi' } })
  assert.deepEqual(
    {
      tokens: fold.tokens,
      calls: fold.calls,
      perDay: JSON.stringify(fold.perDay),
      perProvider: JSON.stringify(fold.perProvider),
      perModel: JSON.stringify(fold.perModel),
      longestTurnMs: fold.longestTurnMs,
    },
    before,
  )
  assert.equal(fold.seq, 9, 'seq 水位照常推进，缓存续扫才能接上')
})

test('foldSnapshot：继承前缀单独记账，主口径从 inheritedEventCount 之后开始', () => {
  const day1 = localNoon(2026, 11, 4)
  const day2 = localNoon(2026, 11, 6)
  const snapshot = {
    session: { id: 'copy', createdAt: day2, parentSession: 'origin' },
    inheritedEventCount: 2,
    events: [
      assistantEvent({ seq: 0, time: day1, input: 400, output: 100, model: 'deepseek-v4-1-flash', provider: 'alpha' }),
      assistantEvent({ seq: 1, time: day1, input: 400, output: 100, model: 'deepseek-v4-1-flash', provider: 'alpha' }),
      assistantEvent({ seq: 2, time: day2, input: 700, output: 100, model: 'deepseek-v4-pro', provider: 'bravo' }),
      turnStartEvent({ seq: 3, time: day2, turn: 't1' }),
      turnEndEvent({ seq: 4, time: day2 + 30000, turn: 't1' }),
    ],
  }
  const fold = foldSnapshot(snapshot)

  assert.equal(fold.sessionId, 'copy')
  assert.equal(fold.parentSession, 'origin')
  assert.equal(fold.createdAt, day2)
  assert.equal(fold.complete, true)
  assert.equal(fold.seq, 4)

  // 主口径只有 seq >= 2
  assert.equal(fold.calls, 1)
  assert.equal(fold.tokens, 800)
  assert.equal(fold.inputTokens, 700)
  assert.equal(fold.outputTokens, 100)
  assert.deepEqual(fold.perDay, { '2026-11-06': 800 })
  assert.deepEqual(fold.perProvider, { bravo: 800 })
  assert.deepEqual(fold.perModel, { 'deepseek-v4-pro': 800 })
  assert.equal(fold.longestTurnMs, 30000)
  assert.equal(fold.firstTime, day2, '首末时间只看主口径')

  // 前缀
  assert.equal(fold.inheritedTokens, 1000)
  assert.equal(fold.inheritedCalls, 2)
  assert.equal(fold.inheritedInputTokens, 800)
  assert.equal(fold.inheritedOutputTokens, 200)
  assert.deepEqual(fold.inheritedPerDay, { '2026-11-04': 1000 })
  assert.deepEqual(fold.inheritedPerDayCalls, { '2026-11-04': 2 })
  assert.deepEqual(fold.inheritedPerDayInput, { '2026-11-04': 800 })
  assert.deepEqual(fold.inheritedPerDayOutput, { '2026-11-04': 200 })
  assert.deepEqual(fold.inheritedPerProvider, { alpha: 1000 })
  assert.deepEqual(fold.inheritedPerDayProvider, { '2026-11-04': { alpha: 1000 } })
  assert.deepEqual(fold.inheritedPerModel, { 'deepseek-v4-1-flash': 1000 })
  assert.deepEqual(fold.inheritedPerDayModel, { '2026-11-04': { 'deepseek-v4-1-flash': 1000 } })
})

test('foldSnapshot：inheritedEventCount 为 0 / 缺失时全部按主口径', () => {
  const day = localNoon(2026, 11, 6)
  const snapshot = {
    session: { id: 'solo' },
    events: [assistantEvent({ seq: 0, time: day, input: 10, output: 5 })],
  }
  const fold = foldSnapshot(snapshot)
  assert.equal(fold.tokens, 15)
  assert.equal(fold.inheritedTokens, 0)
  assert.equal(fold.parentSession, '')
})

test('foldSnapshot：整份日志都是继承前缀时主口径为空、前缀完整', () => {
  const day = localNoon(2026, 11, 4)
  const fold = foldSnapshot({
    session: { id: 'copy-only', parentSession: 'origin' },
    inheritedEventCount: 2,
    events: [
      assistantEvent({ seq: 0, time: day, input: 100, output: 50, total: 150 }),
      assistantEvent({ seq: 1, time: day, input: 100, output: 50, total: 150 }),
    ],
  })
  assert.equal(fold.tokens, 0)
  assert.equal(fold.calls, 0)
  assert.equal(fold.firstTime, 0, '前缀不参与主口径的首末时间')
  assert.equal(fold.inheritedTokens, 300)
  assert.equal(fold.inheritedCalls, 2)
  assert.deepEqual(fold.inheritedPerDay, { '2026-11-04': 300 })
  assert.equal(fold.complete, true)
})

test('foldSnapshot：空日志 / 缺字段都不炸', () => {
  for (const snapshot of [undefined, null, {}, { session: null, events: null }, { session: {}, events: [] }]) {
    const fold = foldSnapshot(snapshot)
    assert.equal(fold.tokens, 0)
    assert.equal(fold.calls, 0)
    assert.equal(fold.complete, true)
    assert.equal(fold.sessionId, '')
    assert.deepEqual(fold.perDay, {})
  }
})

test('foldSnapshot：事件乱序也取到正确的 seq 与首末时间', () => {
  const day1 = localNoon(2026, 11, 5)
  const day2 = localNoon(2026, 11, 6)
  const fold = foldSnapshot({
    session: { id: 's1' },
    events: [
      assistantEvent({ seq: 9, time: day2, input: 10, output: 0 }),
      assistantEvent({ seq: 2, time: day1, input: 20, output: 0 }),
    ],
  })
  assert.equal(fold.seq, 9)
  assert.equal(fold.firstTime, day1)
  assert.equal(fold.lastTime, day2)
  assert.equal(fold.tokens, 30)
})

test('stepParts：只给 totalTokens 的调用记作未缓存输入，各项与总量对得上', () => {
  assert.deepEqual(stepParts({ totalTokens: 2000 }), { inputTokens: 2000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 })
  assert.deepEqual(stepParts({ inputTokens: 5, outputTokens: 1, totalTokens: 999 }), { inputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1 })
  assert.deepEqual(stepParts({ totalTokens: -3 }), { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 })
  const time = localNoon(2026, 11, 6)
  const fold = foldSnapshot({
    session: { id: 'only-total' },
    events: [{ seq: 0, time, type: 'assistant/message', data: { usage: { totalTokens: 2000 }, message: { source: { provider: 'p', model: 'm' } } } }],
  })
  assert.equal(fold.tokens, 2000)
  assert.equal(fold.inputTokens, 2000)
  const [slot] = Object.values(Object.values(fold.perDaySlots)[0])
  assert.deepEqual(slot, [2000, 0, 0, 0])
  assert.deepEqual(Object.values(fold.perDayProviderUsage)[0].p, { inputTokens: 2000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 })
})

test('foldSnapshot：坏掉的单条事件（null、数字、data 不是对象）跳过，不让整个会话读失败', () => {
  const time = localNoon(2026, 11, 6)
  const fold = foldSnapshot({
    session: { id: 'messy' },
    events: [null, 42, 'x', { seq: 1, time, type: 'turn/start', data: 'oops' }, assistantEvent({ seq: 2, time, input: 10, output: 5 })],
  })
  assert.equal(fold.tokens, 15)
  assert.equal(fold.calls, 1)
  assert.equal(foldSnapshot({ session: { id: 'e' }, events: 'nope' }).tokens, 0)
})

test('foldSnapshot：继承前缀单独记单次峰值与最长任务（孤儿前缀补回时要用）', () => {
  const time = localNoon(2026, 11, 6)
  const fold = foldSnapshot({
    session: { id: 'copy', parentSession: 'gone' },
    inheritedEventCount: 4,
    events: [
      turnStartEvent({ seq: 0, time, turn: 1 }),
      assistantEvent({ seq: 1, time: time + 1000, input: 900000, output: 100000 }),
      assistantEvent({ seq: 2, time: time + 2000, input: 10, output: 5 }),
      turnEndEvent({ seq: 3, time: time + 7200000, turn: 1 }),
      turnStartEvent({ seq: 4, time: time + 8000000, turn: 2 }),
      assistantEvent({ seq: 5, time: time + 8000100, input: 10, output: 5 }),
      turnEndEvent({ seq: 6, time: time + 8060000, turn: 2 }),
    ],
  })
  assert.equal(fold.inheritedMaxStepTokens, 1000000)
  assert.equal(fold.inheritedLongestTurnMs, 7200000)
  assert.equal(fold.maxStepTokens, 15, '本体的峰值不含前缀')
  assert.equal(fold.longestTurnMs, 60000)
})
