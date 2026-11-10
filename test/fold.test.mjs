import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MIX_KEYS,
  applyEvent,
  createContext,
  emptyFold,
  estimateImage,
  estimateMessage,
  estimateSystem,
  estimateTools,
  messageCategory,
  splitByWeights,
  trackContext,
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

/* ---------------------------------------------------------------- Token 统计（八类） */

const text = (length) => ({ type: 'text', text: 'x'.repeat(length) })
const mixOf = (mix) => Object.fromEntries(MIX_KEYS.map((key, index) => [key, mix[index]]))
const systemEvent = (seq, length, surfaceOp = 'append') => ({ type: 'system/message', seq, time: 1, surfaceOp, data: { message: { role: 'system', content: [text(length)], source: { kind: 'system-prompt' } } } })
const userEvent = (seq, length, source = { kind: 'user' }, surfaceOp = 'append') => ({ type: 'user/message', seq, time: 1, surfaceOp, data: { role: 'user', content: [text(length)], source } })
const resultEvent = (seq, callId, length, surfaceOp = 'append', body) => ({
  type: 'tool/result',
  seq,
  time: 1,
  surfaceOp,
  data: { message: { role: 'tool', source: { kind: 'tool', callId }, content: [body ? { type: 'text', text: body } : text(length)] } },
})
const callEvent = (seq, callId, name) => ({ type: 'tool/call', seq, time: 1, data: { callId, name, arguments: '{}' } })
const stepEvent = (seq, usage, content, time = localNoon(2026, 11, 6)) => ({
  type: 'assistant/message',
  seq,
  time,
  surfaceOp: 'append',
  data: { usage, message: { role: 'assistant', content, source: { kind: 'model', provider: 'alpha', model: 'deepseek-v4-1-flash' } } },
})

test('estimateMessage / estimateSystem / estimateTools / estimateImage：4 个字符 ≈ 1 token，加块与角色开销；空内容是 0', () => {
  assert.deepEqual(estimateMessage({ content: [text(400)] }), { tokens: 108, reasoning: 0, answers: 104, calls: 0 })
  assert.deepEqual(
    estimateMessage({ content: [{ type: 'reasoning', text: 'r'.repeat(40) }, text(8), { type: 'tool-call', name: 'read', arguments: 'a'.repeat(16) }] }),
    { tokens: 14 + 6 + 9 + 4, reasoning: 14, answers: 6, calls: 9 },
  )
  for (const empty of [undefined, null, {}, { content: [] }, { content: 'x' }]) assert.deepEqual(estimateMessage(empty), { tokens: 0, reasoning: 0, answers: 0, calls: 0 })
  assert.equal(estimateMessage({ content: [null, 7] }).tokens, 4 + 4 + 4, '坏掉的块只算块开销')
  assert.equal(estimateSystem({ content: [text(400)] }), 104)
  assert.equal(estimateSystem({ content: [] }), 0)
  assert.equal(estimateTools([]), 0)
  assert.equal(estimateTools(undefined), 0)
  const tools = [{ name: 'read', description: 'd'.repeat(100), parameters: {} }]
  assert.equal(estimateTools(tools), Math.ceil(JSON.stringify(tools).length / 4) + 4)
  // 图片按尺寸：小图放大到 544 × 544 的面积；大图封顶 1024；没有尺寸按引用长度、同样封顶
  assert.equal(estimateImage({ type: 'image', attachment: { width: 544, height: 544 } }), 13 * 14 + 2)
  assert.equal(estimateImage({ type: 'image', attachment: { width: 100, height: 100 } }), 13 * 14 + 2)
  assert.equal(estimateImage({ type: 'image', attachment: { width: 4000, height: 3000 } }), 1024)
  assert.equal(estimateImage({ type: 'image', data: 'x'.repeat(100000) }), 1024)
  assert.ok(estimateImage({ type: 'image' }) < 10)
})

test('messageCategory：技能目录 / 调用算技能注入，来源不是用户本人的算注入内容，developer 消息算注入内容', () => {
  assert.equal(messageCategory('user/message', { kind: 'user' }), 'user')
  assert.equal(messageCategory('user/message', undefined), 'user')
  assert.equal(messageCategory('user/message', { kind: 'skill-catalog', form: 'catalog' }), 'skill')
  assert.equal(messageCategory('user/message', { kind: 'skill-invocation', form: 'instructions' }), 'skill')
  for (const kind of ['runtime-context', 'time-context', 'agent-instructions', 'compact-checkpoint', 'schedule', 'plugin']) assert.equal(messageCategory('user/message', { kind }), 'inject', kind)
  assert.equal(messageCategory('user/message', { form: 'notice' }), 'inject')
  assert.equal(messageCategory('developer/message', { kind: 'tool-registry' }), 'inject')
})

test('splitByWeights：按比例分成整数，各份之和恰好等于总数；权重全 0 / 脏值时全是 0', () => {
  assert.deepEqual(splitByWeights(100, [1, 1, 1]), [34, 33, 33])
  assert.deepEqual(splitByWeights(10, [0, 3, 1]), [0, 8, 2])
  assert.deepEqual(splitByWeights(7, [0, 0]), [0, 0])
  assert.deepEqual(splitByWeights(0, [1, 2]), [0, 0])
  assert.deepEqual(splitByWeights(5, [NaN, -1, 2]), [0, 0, 5])
  for (const total of [1, 999, 123456789]) {
    const parts = splitByWeights(total, [0.3, 17, 2.5, 0, 961.2])
    assert.equal(parts.reduce((sum, part) => sum + part, 0), total)
    assert.ok(parts.every((part) => Number.isInteger(part) && part >= 0))
  }
})

test('trackContext：一步的输入按当时上下文里各类的估算比例分摊，输出按这一步自己生成的内容分摊，八类之和 = 这一步的 token 数', () => {
  const context = createContext()
  const header = { type: 'request/header', seq: 0, time: 1, data: { header: { tools: [{ name: 'read', description: 'd'.repeat(352), parameters: {} }] } } }
  assert.equal(trackContext(context, header), null)
  trackContext(context, systemEvent(1, 384))
  trackContext(context, userEvent(2, 768))
  trackContext(context, userEvent(3, 368, { kind: 'runtime-context', form: 'snapshot' }))
  const weights = { system: 100, tools: estimateTools(header.data.header.tools), user: 200, inject: 100 }
  const first = trackContext(
    context,
    stepEvent(4, { inputTokens: 1000, cacheReadTokens: 3000, outputTokens: 300 }, [
      { type: 'reasoning', text: 'r'.repeat(784) },
      { type: 'tool-call', name: 'read', arguments: 'a'.repeat(380) },
    ]),
  )
  const firstMix = mixOf(first)
  assert.equal(first.reduce((sum, part) => sum + part, 0), 4300)
  const weightSum = weights.system + weights.tools + weights.user + weights.inject
  for (const key of ['system', 'tools', 'user', 'inject']) assert.ok(Math.abs(firstMix[key] - (4000 * weights[key]) / weightSum) < 1, key)
  assert.equal(firstMix.skill, 0)
  // 输出 300：思考 200、调用 100（估算值 200 : 100）；这一步自己的回复还不在它的输入里
  assert.equal(firstMix.thinking, 200)
  assert.equal(firstMix.toolCalls, 100)
  assert.equal(firstMix.answers, 0)

  // 第二步：上下文里多了上一步的回复（思考 200、调用 100，加角色开销 4）和工具结果
  trackContext(context, callEvent(5, 'c1', 'read'))
  trackContext(context, resultEvent(6, 'c1', 1568))
  const second = mixOf(trackContext(context, stepEvent(7, { inputTokens: 500, outputTokens: 100 }, [text(384)])))
  const total = weightSum + 304 + 400
  assert.ok(Math.abs(second.thinking - (500 * 200 * (304 / 300)) / total) < 1)
  assert.ok(Math.abs(second.toolCalls - (500 * (400 + 100 * (304 / 300))) / total) < 1)
  assert.equal(second.answers, 100, '输出全是回复正文')
  assert.equal(
    Object.values(second).reduce((sum, part) => sum + part, 0),
    600,
  )
})

test('trackContext：供应商报了 reasoningTokens 就用它分思考，其余按回复 / 调用的估算值分；什么都分不出来时算工具调用', () => {
  const run = (usage, content) => {
    const context = createContext()
    trackContext(context, userEvent(1, 400))
    return mixOf(trackContext(context, stepEvent(2, usage, content)))
  }
  const reported = run({ inputTokens: 0, outputTokens: 100, reasoningTokens: 70 }, [{ type: 'reasoning', text: 'r' }, text(396)])
  assert.equal(reported.thinking, 70)
  assert.equal(reported.answers, 30)
  assert.equal(run({ outputTokens: 100, reasoningTokens: 500 }, [text(40)]).thinking, 100, '报的思考比输出还多：封顶在输出')
  assert.equal(run({ outputTokens: 100, reasoningTokens: 40 }, []).thinking, 100, '只有思考、没有别的内容：全算思考')
  assert.equal(run({ outputTokens: 100 }, []).toolCalls, 100, '日志里没有内容：算工具调用')
  // 没有任何上下文的残缺日志：输入记在用户消息上
  const bare = mixOf(trackContext(createContext(), stepEvent(1, { inputTokens: 50, outputTokens: 0 }, [])))
  assert.equal(bare.user, 50)
  assert.equal(trackContext(createContext(), stepEvent(1, undefined, [text(8)])), null, '没有用量的回复不分摊，但进上下文')
})

test('trackContext：skill 工具加载的技能正文算技能注入；别的工具返回里出现同样的标记不算', () => {
  const body = '<skill_content name="demo">' + 'x'.repeat(373)
  const run = (name) => {
    const context = createContext()
    if (name) trackContext(context, callEvent(1, 'c1', name))
    trackContext(context, resultEvent(2, 'c1', 0, 'append', body))
    return mixOf(trackContext(context, stepEvent(3, { inputTokens: 100, outputTokens: 0 }, [])))
  }
  assert.equal(run('skill').skill, 100)
  assert.equal(run(undefined).skill, 100, '找不到对应的调用时按内容认')
  assert.equal(run('read').toolCalls, 100)
})

test('trackContext：压缩 / 裁剪后，被点名的消息从上下文里拿掉、换成摘要；系统提示词换新后按新的算', () => {
  const context = createContext()
  trackContext(context, systemEvent(1, 384))
  trackContext(context, userEvent(2, 3968))
  trackContext(context, callEvent(3, 'c1', 'read'))
  trackContext(context, resultEvent(4, 'c1', 7968))
  const before = mixOf(trackContext(context, stepEvent(5, { inputTokens: 3100, outputTokens: 0 }, [])))
  assert.deepEqual([before.system, before.user, before.toolCalls], [100, 1000, 2000])
  // 压缩：2、4 被摘要（seq 7，400 token）顶替
  trackContext(context, { type: 'compaction/summary', seq: 6, time: 1, data: { shadowedSeqs: [2, 4] } })
  trackContext(context, userEvent(7, 1568, { kind: 'compact-checkpoint' }, { op: 'replace', startSeq: 2, endSeq: 4 }))
  const after = mixOf(trackContext(context, stepEvent(8, { inputTokens: 500, outputTokens: 0 }, [])))
  assert.deepEqual([after.system, after.user, after.toolCalls, after.inject], [100, 0, 0, 400])
  // 裁剪：没点名时按 seq 范围替换
  trackContext(context, resultEvent(9, 'c2', 768))
  trackContext(context, resultEvent(10, 'c2', 368, { op: 'replace', startSeq: 9, endSeq: 9 }))
  // 系统提示词换新（replace 自己原来的 seq）
  trackContext(context, systemEvent(11, 1184, { op: 'replace', startSeq: 1, endSeq: 1 }))
  const last = mixOf(trackContext(context, stepEvent(12, { inputTokens: 800, outputTokens: 0 }, [])))
  assert.deepEqual([last.system, last.inject, last.toolCalls], [300, 400, 100])
})

test('foldSnapshot：每天的 mix 八类之和 = 当天的 token 数；继承前缀的消息算进后面每一步的上下文，但它的用量记在前缀自己的表里', () => {
  const day = localNoon(2026, 11, 6)
  const key = '2026-11-06'
  const fold = foldSnapshot({
    session: { id: 'mix', parentSession: 'origin' },
    inheritedEventCount: 3,
    events: [
      systemEvent(0, 384),
      userEvent(1, 1168),
      stepEvent(2, { inputTokens: 400, outputTokens: 0 }, [], day),
      stepEvent(3, { inputTokens: 300, cacheReadTokens: 100, outputTokens: 60 }, [text(8)], day),
      null,
      { type: 'assistant/message', seq: 5, time: day, data: { usage: { inputTokens: 7 }, message: 'broken' } },
    ],
  })
  assert.equal(fold.perDayMix[key].length, 8)
  assert.equal(
    fold.perDayMix[key].reduce((sum, part) => sum + part, 0),
    fold.perDay[key],
  )
  assert.equal(fold.perDay[key], 467)
  const own = mixOf(fold.perDayMix[key])
  assert.equal(own.system + own.user, 407, '前缀里的系统提示词和用户消息仍在本体每一步的输入里')
  assert.equal(own.answers, 60)
  assert.deepEqual(mixOf(fold.inheritedPerDayMix[key]), { ...mixOf(MIX_KEYS.map(() => 0)), system: 100, user: 300 })
})

test('applyEvent：单独调用、没有传分摊结果时，这一步照常计入用量，只是不进 mix', () => {
  const fold = emptyFold('solo', 0)
  applyEvent(fold, assistantEvent({ seq: 1, time: localNoon(2026, 11, 6), input: 10, output: 5 }))
  assert.equal(fold.tokens, 15)
  assert.deepEqual(fold.perDayMix, {})
})
