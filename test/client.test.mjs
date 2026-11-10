import assert from 'node:assert/strict'
import test from 'node:test'

import { loadClientHelpers, readClientSource } from './helpers/client-source.mjs'

/* 这些用例测的是 client.js 里的纯函数（数值格式、日期窗口、图表几何、Token 统计口径）。
 * 组件渲染由 profile-stats-verify/client-smoke.mjs 那套 smoke 覆盖，这里只管算得对不对。 */

const withLocale = { extraCode: ["const currentLocaleId = () => 'zh-CN'", 'const isChineseLocale = () => true'] }
const withEnglish = { extraCode: ["const currentLocaleId = () => 'en-US'", 'const isChineseLocale = () => false'] }
const NUMBER_HELPERS = ['toNumber', 'bigNumberParts', 'unitGap', 'tokenParts', 'formatTokens']

const lensHelpers = () => loadClientHelpers({ functions: ['deriveLens', 'cacheHitRate', 'toNumber'], constants: ['MIX_KEYS'] })

test('deriveLens：八类按宿主 mix 数组的顺序取用，各类之和是占比的分母；总用量是日明细的 tokens', () => {
  const { deriveLens } = lensHelpers()
  const MIX_KEYS = ['system', 'tools', 'user', 'inject', 'skill', 'toolCalls', 'thinking', 'answers']
  const lens = deriveLens({ tokens: 1000, mix: [10, 50, 20, 60, 0, 560, 250, 50] })
  assert.equal(lens.total, 1000)
  assert.deepEqual(
    lens.parts.map((part) => part.key),
    MIX_KEYS,
  )
  assert.deepEqual(
    lens.parts.map((part) => part.value),
    [10, 50, 20, 60, 0, 560, 250, 50],
  )
  assert.equal(lens.partsTotal, 1000)
  const percent = lens.parts.reduce((sum, part) => sum + (part.value / lens.partsTotal) * 100, 0)
  assert.equal(Math.round(percent * 1e6) / 1e6, 100)
})

test('deriveLens：旧版宿主没有 mix、空快照、脏值都不产生 NaN，八类全是 0', () => {
  const { deriveLens } = lensHelpers()
  for (const totals of [undefined, {}, { tokens: 500 }, { tokens: null, mix: 'x' }, { tokens: 5, mix: [NaN, -3, 'a'] }]) {
    const lens = deriveLens(totals)
    assert.ok(Number.isFinite(lens.total))
    assert.equal(lens.parts.length, 8)
    assert.equal(lens.partsTotal, 0)
    for (const part of lens.parts) assert.equal(part.value, 0)
  }
})

test('cacheHitRate：输入 ≥ 缓存时不再减掉缓存（旧算法在真实命中率 ≤ 50% 时算高，50% 直接跳成 100%）', () => {
  const { cacheHitRate } = lensHelpers()
  const half = cacheHitRate({ tokens: 2000, inputTokens: 1000, cacheReadTokens: 1000, outputTokens: 0 })
  assert.equal(half, 50, '旧算法：未缓存 = 1000 − 1000 = 0 → 100%')
  const third = cacheHitRate({ tokens: 1500, inputTokens: 1000, cacheReadTokens: 500, outputTokens: 0 })
  assert.equal(Number(third.toFixed(4)), Number(((500 / 1500) * 100).toFixed(4)), '旧算法给 50%')
  // 命中率随缓存连续变化，没有跳变
  const below = cacheHitRate({ tokens: 1999, inputTokens: 1000, cacheReadTokens: 999, outputTokens: 0 })
  assert.ok(Math.abs(below - half) < 0.1)
})

test('cacheHitRate：缓存写入不算命中，只进分母；没有输入时是 null（页面写「—」），不是 0%', () => {
  const { cacheHitRate } = lensHelpers()
  assert.equal(cacheHitRate({ tokens: 650, inputTokens: 400, outputTokens: 100, cacheReadTokens: 100, cacheWriteTokens: 50 }), (100 / 550) * 100)
  for (const totals of [undefined, {}, { tokens: 0 }, { tokens: null, inputTokens: 'x' }, { inputTokens: -5, cacheReadTokens: -1 }]) assert.equal(cacheHitRate(totals), null)
  assert.equal(cacheHitRate({ outputTokens: 100 }), null, '只有输出、没有输入')
  assert.equal(cacheHitRate({ inputTokens: 100 }), 0)
  assert.equal(cacheHitRate({ cacheReadTokens: 100 }), 100)
})

test('tokenParts / formatTokens：中文单位按一位小数，亿 / 万不出现 10000.0 万', () => {
  const { tokenParts, formatTokens } = loadClientHelpers({
    ...withLocale,
    functions: NUMBER_HELPERS,
  })
  assert.deepEqual(tokenParts(0), { value: '0', unit: '' })
  assert.deepEqual(tokenParts(-100), { value: '0', unit: '' })
  assert.deepEqual(tokenParts(999), { value: '999', unit: '' })
  assert.deepEqual(tokenParts(10000), { value: '1.0', unit: '万' })
  assert.deepEqual(tokenParts(149490), { value: '14.9', unit: '万' })
  assert.deepEqual(tokenParts(99999999), { value: '1.0', unit: '亿' })
  assert.deepEqual(tokenParts(1e8), { value: '1.0', unit: '亿' })
  assert.equal(formatTokens(149490), '14.9 万')
  assert.equal(formatTokens(99999999), '1.0 亿')
  assert.equal(formatTokens(0), '0')
})

test('tokenParts / formatTokens：英文界面用 K / M / B，紧挨着数字，不出现 1000.0K', () => {
  const { tokenParts, formatTokens } = loadClientHelpers({ ...withEnglish, functions: NUMBER_HELPERS })
  assert.deepEqual(tokenParts(9999), { value: '9,999', unit: '' })
  assert.deepEqual(tokenParts(10000), { value: '10.0', unit: 'K' })
  assert.deepEqual(tokenParts(999950), { value: '1.0', unit: 'M' })
  assert.deepEqual(tokenParts(16500000), { value: '16.5', unit: 'M' })
  assert.deepEqual(tokenParts(3.33e9), { value: '3.3', unit: 'B' })
  assert.equal(formatTokens(16500000), '16.5M')
  assert.equal(formatTokens(3.33e9), '3.3B')
})

test('formatAxis：纵轴刻度去掉多余的 .0', () => {
  const { formatAxis } = loadClientHelpers({ ...withLocale, functions: [...NUMBER_HELPERS, 'formatAxis'] })
  assert.equal(formatAxis(0), '0')
  assert.equal(formatAxis(1e8), '1 亿')
  assert.equal(formatAxis(2e4), '2 万')
  assert.equal(formatAxis(149490), '14.9 万')
  assert.equal(formatAxis(999), '999')
  const english = loadClientHelpers({ ...withEnglish, functions: [...NUMBER_HELPERS, 'formatAxis'] }).formatAxis
  assert.equal(english(1e9), '1B')
  assert.equal(english(2.5e6), '2.5M')
})

test('formatPercent：极小值写 <0.1%，不足 100 不会被凑成 100%', () => {
  const { formatPercent } = loadClientHelpers({ functions: ['toNumber', 'formatPercent'] })
  assert.equal(formatPercent(0), '0%')
  assert.equal(formatPercent(-3), '0%')
  assert.equal(formatPercent(Number.NaN), '0%')
  assert.equal(formatPercent(0.01), '<0.1%')
  assert.equal(formatPercent(0.049), '<0.1%')
  assert.equal(formatPercent(0.05), '0.1%')
  assert.equal(formatPercent(33.333), '33.3%')
  assert.equal(formatPercent(99.94), '99.9%')
  assert.equal(formatPercent(99.95), '>99.9%')
  assert.equal(formatPercent(99.99), '>99.9%')
  assert.equal(formatPercent(100), '100%')
  assert.equal(formatPercent(250), '100%')
})

test('niceStep / niceScale：整数刻度、整齐步长', () => {
  const { niceStep, niceScale } = loadClientHelpers({ functions: ['toNumber', 'niceStep', 'niceScale'] })
  assert.equal(niceStep(1000, 4), 250)
  assert.equal(niceStep(12, 4), 5)
  assert.equal(niceStep(0, 4), 1)
  assert.equal(niceStep(1, 4), 1, 'token 是整数，步长不能小于 1')

  assert.deepEqual(niceScale(1000, 4), { max: 1000, step: 250, ticks: [0, 250, 500, 750, 1000] })
  assert.deepEqual(niceScale(12, 4), { max: 15, step: 5, ticks: [0, 5, 10, 15] })
  assert.deepEqual(niceScale(0, 4), { max: 1, step: 1, ticks: [0, 1] })
  const scale = niceScale(1999, 4)
  assert.equal(scale.max, 2000)
  assert.equal(scale.step, 500)
  assert.equal(scale.ticks.at(-1), 2000)
  for (const value of scale.ticks) assert.equal(Number.isInteger(value), true, `刻度 ${value} 必须是整数`)
})

test('日期工具：本地日历加减不受固定 86400000 影响', () => {
  const { startOfDay, addDays, startOfWeek, localDateKey, parseDateKey } = loadClientHelpers({
    functions: ['startOfDay', 'addDays', 'startOfWeek', 'localDateKey', 'parseDateKey'],
  })
  assert.equal(localDateKey(new Date(2026, 10, 6, 23, 30)), '2026-11-06')
  assert.equal(localDateKey(startOfDay(new Date(2026, 10, 6, 23, 30))), '2026-11-06')
  assert.equal(localDateKey(addDays(new Date(2026, 10, 30), 1)), '2026-12-01')
  assert.equal(localDateKey(addDays(new Date(2026, 0, 1), -1)), '2025-12-31')
  assert.equal(localDateKey(addDays(new Date(2024, 1, 28), 1)), '2024-02-29', '闰日')

  // 周一起算：任意一天都回落到同一周的周一
  for (const day of [1, 2, 3, 4, 5, 6, 7, 8, 14, 21, 28]) {
    const monday = startOfWeek(new Date(2026, 10, day))
    assert.equal(monday.getDay(), 1, `${day} 号所属周的起点应该是周一`)
    assert.ok(monday.getTime() <= new Date(2026, 10, day).getTime())
    assert.ok(new Date(2026, 10, day).getTime() - monday.getTime() < 7 * 86400000)
  }

  assert.equal(parseDateKey('2026-11-06').getFullYear(), 2026)
  assert.equal(parseDateKey('2026-11-06').getMonth(), 10)
  assert.equal(parseDateKey('2026-11-06').getDate(), 6)
  assert.equal(parseDateKey(''), null)
  assert.equal(parseDateKey('2026-11'), null)
  assert.equal(parseDateKey('16/11/2026'), null)
})

test('buildActivity：53 列、周一起始、逐日连续、累计不倒退', () => {
  const { buildActivity, localDateKey, parseDateKey, addDays, startOfWeek, startOfDay } = loadClientHelpers({
    extraCode: ["const ACTIVITY_WEEKS = 53", "const monthLabel = () => 'M'"],
    functions: [
      'toNumber',
      'buildActivity',
      'indexDaily',
      'parseDateKey',
      'localDateKey',
      'startOfDay',
      'addDays',
      'startOfWeek',
    ],
  })

  const today = new Date(2026, 10, 6, 12)
  const todayStart = startOfDay(today)
  const todayKey = localDateKey(todayStart)
  const beforeWindow = '2025-01-15'
  const insideWindow = localDateKey(addDays(todayStart, -10))
  const daily = [
    { date: beforeWindow, tokens: 500 },
    { date: insideWindow, tokens: 300 },
    { date: todayKey, tokens: 100 },
  ]

  const activity = buildActivity(daily, today)
  assert.equal(activity.columns, 53)
  assert.equal(activity.weeks.length, 53)
  assert.equal(activity.cells.length, 53 * 7)
  assert.equal(activity.todayKey, todayKey)

  // 每列 7 天，列首都是周一，列之间恰好隔 7 天。
  for (const week of activity.weeks) {
    const start = parseDateKey(week.startKey)
    assert.equal(start.getDay(), 1, `${week.startKey} 必须是周一`)
  }
  for (let index = 1; index < activity.weeks.length; index += 1) {
    const previous = parseDateKey(activity.weeks[index - 1].startKey)
    assert.equal(activity.weeks[index].startKey, localDateKey(addDays(previous, 7)))
  }

  // 最后一列就是本周，终点截到今天。
  const lastWeek = activity.weeks.at(-1)
  assert.equal(lastWeek.startKey, localDateKey(startOfWeek(todayStart)))
  assert.equal(lastWeek.endKey, todayKey)

  // 窗口之前的用量进 baseline，累计从它开始且单调不减。
  assert.equal(activity.baseline, 500)
  let previousCumulative = -1
  for (const week of activity.weeks) {
    assert.ok(week.cumulative >= previousCumulative, '累计用量不能倒退')
    previousCumulative = week.cumulative
  }
  assert.equal(activity.weeks[0].cumulative, 500 + activity.weeks[0].tokens)
  assert.equal(lastWeek.cumulative, activity.baseline + activity.windowTokens)

  const expectedWindow = daily
    .filter((entry) => entry.date >= activity.weeks[0].startKey && entry.date <= todayKey)
    .reduce((sum, entry) => sum + entry.tokens, 0)
  assert.equal(activity.windowTokens, expectedWindow)

  // 今天之后的格子是 future：不算量、不点灯。
  const todayCell = activity.cells.find((cell) => cell.today)
  assert.ok(todayCell, '必须有一个格标成今天')
  assert.equal(todayCell.key, todayKey)
  assert.equal(todayCell.tokens, 100)
  const futureCells = activity.cells.filter((cell) => cell.future)
  assert.equal(futureCells.length, 6 - ((todayStart.getDay() + 6) % 7))
  for (const cell of futureCells) {
    assert.equal(cell.tokens, 0)
    assert.equal(cell.level, 0)
  }

  // 有量的格子点灯 1–4，没量的格子是 0。
  for (const cell of activity.cells) {
    if (cell.future) continue
    assert.ok(cell.level >= 0 && cell.level <= 4)
    if (cell.tokens === 0) assert.equal(cell.level, 0)
    else assert.ok(cell.level >= 1)
  }
})

test('buildActivity：空数据也能画出 53 列空白', () => {
  const { buildActivity } = loadClientHelpers({
    extraCode: ["const ACTIVITY_WEEKS = 53", "const monthLabel = () => 'M'"],
    functions: [
      'toNumber',
      'buildActivity',
      'indexDaily',
      'parseDateKey',
      'localDateKey',
      'startOfDay',
      'addDays',
      'startOfWeek',
    ],
  })
  const activity = buildActivity([], new Date(2026, 10, 6, 12))
  assert.equal(activity.columns, 53)
  assert.equal(activity.windowTokens, 0)
  assert.equal(activity.baseline, 0)
  assert.equal(activity.weeks.at(-1).cumulative, 0)
})

test('modelBucketFrames：按日 7 个、按周 4 个、按月 6 个桶，连续且本周（月）终点截到今天', () => {
  const { modelBucketFrames, modelBucketKeyOf, localDateKey, startOfWeek, startOfDay, addDays } = loadClientHelpers({
    extraCode: ['const MODEL_COUNTS = { day: 7, week: 4, month: 6 }'],
    functions: ['modelBucketFrames', 'modelBucketKeyOf', 'localDateKey', 'startOfWeek', 'startOfDay', 'addDays', 'toNumber'],
  })

  // 选一个跨过夏令时切换的日期，周桶仍然逐周连续。
  const today = new Date(2026, 2, 20, 12)
  const todayStart = startOfDay(today)

  const days = modelBucketFrames('day', today)
  assert.equal(days.length, 7)
  assert.equal(days.at(-1).key, localDateKey(todayStart))
  for (let index = 1; index < days.length; index += 1) {
    assert.equal(days[index].key, localDateKey(addDays(todayStart, index - 6)))
  }

  const weeks = modelBucketFrames('week', today)
  assert.equal(weeks.length, 4)
  assert.equal(weeks.at(-1).start.getTime(), startOfWeek(todayStart).getTime())
  assert.equal(weeks.at(-1).end.getTime(), todayStart.getTime(), '本周截到今天')
  for (const frame of weeks) assert.equal(frame.start.getDay(), 1, `${frame.key} 必须是周一`)
  for (let index = 1; index < weeks.length; index += 1) {
    assert.equal(weeks[index].key, localDateKey(addDays(weeks[index - 1].start, 7)))
  }

  const months = modelBucketFrames('month', today)
  assert.equal(months.length, 6)
  assert.equal(months.at(-1).key, '2026-03')
  assert.equal(months.at(-1).end.getTime(), todayStart.getTime())
  assert.equal(months[0].key, '2025-10')
  for (const frame of months) assert.match(frame.key, /^\d{4}-\d{2}$/)

  // 任意日期归桶：周口径用周一，月口径用 YYYY-MM，日口径当天。
  const wednesday = new Date(2026, 2, 18, 12)
  assert.equal(modelBucketKeyOf(wednesday, 'week'), localDateKey(startOfWeek(wednesday)))
  assert.equal(modelBucketKeyOf(wednesday, 'month'), '2026-03')
  assert.equal(modelBucketKeyOf(wednesday, 'day'), '2026-03-18')
})

test('deriveKpis：不跟范围走的几个指标（累计总量、最长任务、连续天数）；今天的用量看「本日」范围，不单独算', () => {
  const { deriveKpis } = loadClientHelpers({ functions: ['toNumber', 'deriveKpis'] })
  const snapshot = {
    totals: { tokens: 1234, longestTurnMs: 60000, longestStreak: 3, currentStreak: 2 },
    daily: [{ date: '2026-11-06', tokens: 42 }],
  }
  const kpis = deriveKpis(snapshot)
  assert.equal(kpis.tokens, 1234)
  assert.equal(kpis.longestTurnMs, 60000)
  assert.equal(kpis.longestStreak, 3)
  assert.equal(kpis.currentStreak, 2)
  assert.equal('today' in kpis, false)
  assert.equal('spark' in kpis, false)

  const empty = deriveKpis({})
  assert.equal(empty.tokens, 0)
  assert.equal(empty.currentStreak, 0)
})

const providerHelpers = () =>
  loadClientHelpers({ functions: ['toNumber', 'deriveProviders', 'cacheHitRate', 'addUsage', 'emptyUsage'] })

test('deriveProviders：按用量降序，前 6 个各一行，其余并成「其他」', () => {
  const { deriveProviders } = providerHelpers()

  const small = deriveProviders({ alpha: 600, bravo: 400 })
  assert.equal(small.total, 1000)
  assert.deepEqual(small.rows.map((row) => row.id), ['alpha', 'bravo'])
  assert.equal(small.rows[0].share, 60)
  assert.equal(small.rows[1].share, 40)

  // 8 个供应商 → 前 6 行 + __other（后 2 个合并）
  const many = {}
  for (let index = 0; index < 8; index += 1) many[`p${index}`] = (8 - index) * 100
  const grouped = deriveProviders(many)
  assert.equal(grouped.rows.length, 7)
  assert.deepEqual(grouped.rows.slice(0, 6).map((row) => row.id), ['p0', 'p1', 'p2', 'p3', 'p4', 'p5'])
  assert.equal(grouped.rows.at(-1).id, '__other')
  assert.equal(grouped.rows.at(-1).tokens, 200 + 100)
  assert.equal(Math.round(grouped.rows.at(-1).share * 100) / 100, 8.33, '300 / 3600')
  assert.equal(grouped.rows.reduce((sum, row) => sum + row.share, 0).toFixed(6), '100.000000')

  // 0 / 负数 / 非数字都被过滤；同量按 id 升序保证稳定
  const messy = deriveProviders({ b: 100, a: 100, zero: 0, neg: -5, junk: 'x' })
  assert.deepEqual(messy.rows.map((row) => row.id), ['a', 'b'])
  assert.deepEqual(deriveProviders({}), { total: 0, rows: [] })
  assert.deepEqual(deriveProviders(undefined), { total: 0, rows: [] })
})

test('deriveProviders：每家按自己的四项算命中率，「其他」用合并后的四项，缺用量时为 null', () => {
  const { deriveProviders } = providerHelpers()
  const usage = (input, cacheRead, cacheWrite = 0) => ({ inputTokens: input, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite, outputTokens: 1 })
  const byProvider = { a: 900, b: 800, c: 700, d: 600, e: 500, f: 400, g: 300, h: 200 }
  const providerUsage = { a: usage(10, 90), b: usage(50, 50), c: usage(100, 0), d: usage(0, 0), e: usage(20, 60, 20), g: usage(30, 70), h: usage(70, 30) }
  const { rows } = deriveProviders(byProvider, providerUsage)
  const hit = Object.fromEntries(rows.map((row) => [row.id, row.hitRate]))
  assert.equal(hit.a, 90)
  assert.equal(hit.b, 50)
  assert.equal(hit.c, 0)
  assert.equal(hit.d, null, '有 token 但没有输入（只有输出）')
  assert.equal(hit.e, 60, '写入进分母不进分子：60 / (20 + 60 + 20)')
  assert.equal(hit.f, null, '这一家缺四项用量')
  assert.equal(hit.__other, 50, 'g + h：(70 + 30) / (30 + 70 + 70 + 30)')
  assert.equal(deriveProviders({ a: 1 }, undefined).rows[0].hitRate, null)
})

test('summarizeDaily：缓存读写分开汇总、各家四项用量按窗口累加；旧版宿主的 cacheTokens 当作读', () => {
  const { summarizeDaily, cacheHitRate } = loadClientHelpers({
    functions: ['summarizeDaily', 'emptySummary', 'emptyUsage', 'addUsage', 'cacheHitRate', 'indexDaily', 'parseDateKey', 'toNumber'],
    constants: ['MIX_KEYS'],
  })
  const daily = [
    {
      date: '2026-11-05',
      tokens: 1100,
      inputTokens: 100,
      outputTokens: 0,
      cacheReadTokens: 900,
      cacheWriteTokens: 100,
      byProvider: { a: 1100 },
      providerUsage: { a: { inputTokens: 100, cacheReadTokens: 900, cacheWriteTokens: 100, outputTokens: 0 } },
    },
    {
      date: '2026-11-06',
      tokens: 500,
      inputTokens: 200,
      outputTokens: 0,
      cacheReadTokens: 300,
      cacheWriteTokens: 0,
      byProvider: { a: 100, b: 400 },
      providerUsage: {
        a: { inputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
        b: { inputTokens: 100, cacheReadTokens: 300, cacheWriteTokens: 0, outputTokens: 0 },
      },
    },
  ]
  const all = summarizeDaily(daily, '', '2026-11-06')
  assert.equal(all.cacheReadTokens, 1200)
  assert.equal(all.cacheWriteTokens, 100)
  assert.deepEqual(all.providerUsage.a, { inputTokens: 200, cacheReadTokens: 900, cacheWriteTokens: 100, outputTokens: 0 })
  assert.equal(cacheHitRate(all.providerUsage.a), 75)
  const today = summarizeDaily(daily, '2026-11-06', '2026-11-06')
  assert.deepEqual(today.byProvider, { a: 100, b: 400 })
  assert.equal(cacheHitRate(today.providerUsage.b), 75)
  assert.equal(cacheHitRate(today.providerUsage.a), 0)

  const legacy = summarizeDaily([{ date: '2026-11-06', tokens: 10, inputTokens: 2, cacheTokens: 8 }], '', '')
  assert.equal(legacy.cacheReadTokens, 8)
  assert.equal(legacy.cacheWriteTokens, 0)
})

test('providerLabel：已知供应商走文案字典，未知原样显示', () => {
  const { providerLabel } = loadClientHelpers({
    extraCode: [
      'const t = (key) => ({ "provider.alpha": "Alpha", "provider.other": "其他" }[key] || key)',
    ],
    functions: ['providerLabel'],
  })
  assert.equal(providerLabel('alpha'), 'Alpha')
  assert.equal(providerLabel('__other'), '其他')
  assert.equal(providerLabel('bravo'), 'bravo')
  // 本机起的名字优先；空白名字等于没起；「其他」不受影响
  const aliases = { bravo: '实验中转', alpha: '  ', __other: 'x' }
  assert.equal(providerLabel('bravo', aliases), '实验中转')
  assert.equal(providerLabel('alpha', aliases), 'Alpha')
  assert.equal(providerLabel('__other', aliases), '其他')
})

test('durationParts：毫秒 → 时/分，0 与负数返回 null', () => {
  const { durationParts } = loadClientHelpers({
    extraCode: ['const t = (key) => key'],
    functions: ['toNumber', 'durationParts'],
  })
  assert.equal(durationParts(0), null)
  assert.equal(durationParts(-1000), null)
  assert.equal(durationParts(Number.NaN), null)
  assert.deepEqual(durationParts(30 * 1000), [{ value: '1', unit: 'unit.minuteShort' }], '不足一分钟按 1 分钟显示')
  assert.deepEqual(durationParts(60 * 1000), [{ value: '1', unit: 'unit.minuteShort' }])
  assert.deepEqual(durationParts(90 * 1000), [{ value: '2', unit: 'unit.minuteShort' }])
  assert.deepEqual(durationParts(60 * 60 * 1000), [{ value: '1', unit: 'unit.hourShort' }])
  assert.deepEqual(durationParts(61 * 60 * 1000), [
    { value: '1', unit: 'unit.hourShort' },
    { value: '1', unit: 'unit.minuteShort' },
  ])
})

/* ------------------------------------------------------------ 顶部时间范围 */

const modelSeriesHelpers = () =>
  loadClientHelpers({
    extraCode: [
      'const MODEL_COUNTS = { day: 7, week: 4, month: 6 }',
      'const MODEL_TOP = 6',
      "const SERIES_COLORS = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6']",
      "const OTHER_COLOR = 'c0'",
      "const MODEL_ALIASES = { 'deepseek-flash': 'deepseek-v4-1-flash' }",
      "const MODEL_VENDORS = { deepseek: 'DeepSeek' }",
      "const t = (key, vars) => (key === 'tip.weekRange' ? `${vars.start}~${vars.end}` : key)",
      'function formatDate(date) { return localDateKey(date) }',
      'function monthLabel(date) { return localDateKey(date).slice(0, 7) }',
    ],
    functions: [
      'buildModelSeries', 'modelBucketFrames', 'modelBucketKeyOf', 'bucketTitle', 'indexDaily', 'modelBaseId',
      'parseDateKey', 'localDateKey', 'startOfDay', 'startOfWeek', 'addDays', 'toNumber', 'niceScale', 'niceStep',
      'modelFamily', 'familyLabel', 'prettyModelName',
    ],
  })

test('buildModelSeries：每档有自己的固定窗口，只看日期不看顶部范围；窗口外的日子不进来', () => {
  const { buildModelSeries } = modelSeriesHelpers()
  const today = new Date(2026, 10, 4, 12) // 周三
  const daily = [
    { date: '2026-11-04', tokens: 7, byModel: { 'deepseek-v4-1-flash': 7 } }, // 今天
    { date: '2026-11-02', tokens: 5, byModel: { 'deepseek-v4-pro': 5 } }, // 本周一
    { date: '2026-10-29', tokens: 100, byModel: { 'deepseek-v4-1-flash': 100 } }, // 7 天窗口的第一天（10/29 ~ 11/4）
    { date: '2026-10-28', tokens: 999, byModel: { 'deepseek-v4-1-flash': 999 } }, // 按日窗口之前一天
    { date: '2026-10-11', tokens: 40, byModel: { 'deepseek-v4-pro': 40 } }, // 4 周窗口（10/12 起）之前
    { date: '2026-10-12', tokens: 30, byModel: { 'deepseek-v4-pro': 30 } },
    { date: '2026-05-31', tokens: 8, byModel: { 'deepseek-v4-pro': 8 } }, // 6 个月窗口（2026-06 起）之前
    { date: '2026-06-01', tokens: 9, byModel: { 'deepseek-v4-pro': 9 } },
  ]
  const byDay = buildModelSeries(daily, 'day', today)
  assert.equal(byDay.buckets.length, 7)
  assert.equal(byDay.buckets[0].key, '2026-10-29')
  assert.equal(byDay.total, 7 + 5 + 100, '窗口外的 10/28 不进来')
  const byWeek = buildModelSeries(daily, 'week', today)
  assert.equal(byWeek.buckets.length, 4)
  assert.equal(byWeek.buckets[0].key, '2026-10-12')
  assert.equal(byWeek.buckets.at(-1).key, '2026-11-02', '最后一个桶是今天所在的这一周')
  assert.equal(byWeek.total, 7 + 5 + 100 + 999 + 30, '10/11 在第一周之前，不进来；10/28 在窗口内')
  const byMonth = buildModelSeries(daily, 'month', today)
  assert.equal(byMonth.buckets.length, 6)
  assert.equal(byMonth.buckets[0].key, '2026-06')
  assert.equal(byMonth.buckets.at(-1).key, '2026-11')
  assert.equal(byMonth.total, 7 + 5 + 100 + 999 + 40 + 30 + 9, '5/31 在 6 个月窗口之前，不进来')
  // 家族合计 = 桶合计之和 = 头部总计（同一批整数）
  for (const series of [byDay, byWeek, byMonth]) {
    assert.equal(series.series.reduce((sum, item) => sum + item.total, 0), series.total)
    assert.equal(series.buckets.reduce((sum, bucket) => sum + bucket.total, 0), series.total)
  }
  // 数据变空也画满桶，卡片形状不变
  assert.equal(buildModelSeries([], 'week', today).buckets.length, 4)
  assert.equal(buildModelSeries([], 'day', today).total, 0)
})

test('bucketTitle：本周只过了一天（今天是周一）时写单个日期；整月写年月；整周写起止', () => {
  const { buildModelSeries, bucketTitle } = modelSeriesHelpers()
  const monday = new Date(2026, 10, 9, 12)
  const series = buildModelSeries([{ date: '2026-11-09', tokens: 5, byModel: { x: 5 } }], 'week', monday)
  assert.equal(series.buckets.at(-1).key, '2026-11-09')
  assert.equal(bucketTitle(series.buckets.at(-1), 'week'), '2026-11-09', '不写「11/9 ~ 11/9」')
  assert.equal(bucketTitle(series.buckets[0], 'week'), '2026-10-19~2026-10-25', '整周写起止')
  const months = buildModelSeries([], 'month', monday)
  assert.equal(bucketTitle(months.buckets[0], 'month'), '2026-06-01')
})

test('deltaWindows：本期已过完的天（不含今天）对上一期的前同样天数；没有起点的范围没有上一期', () => {
  const { deltaWindows } = loadClientHelpers({ functions: ['deltaWindows', 'parseDateKey', 'addDays', 'localDateKey'] })
  assert.deepEqual(deltaWindows({ days: 7, startKey: '2026-10-29', endKey: '2026-11-04' }), {
    current: { startKey: '2026-10-29', endKey: '2026-11-03' },
    previous: { startKey: '2026-10-22', endKey: '2026-10-27' },
  })
  assert.equal(deltaWindows({ days: 0, startKey: '', endKey: '2026-11-04' }), null)
  assert.equal(deltaWindows(null), null)
})

test('buildCsv：缓存读 / 写各一列；供应商 id 含逗号 / 引号时按 RFC 4180 加引号', () => {
  const { buildCsv, csvCell } = loadClientHelpers({ functions: ['buildCsv', 'csvCell', 'indexDaily', 'parseDateKey', 'toNumber'] })
  assert.equal(csvCell('plain'), 'plain')
  assert.equal(csvCell('a,b'), '"a,b"')
  assert.equal(csvCell('say "hi"'), '"say ""hi"""')
  const csv = buildCsv(
    [
      { date: '2026-11-03', tokens: 9, calls: 1, inputTokens: 1, outputTokens: 1, cacheTokens: 7, byProvider: { plain: 9 } },
      { date: '2026-11-04', tokens: 6, calls: 1, inputTokens: 1, outputTokens: 1, cacheReadTokens: 3, cacheWriteTokens: 1, byProvider: { 'relay,eu': 4, plain: 2 } },
    ],
    { byProvider: { 'relay,eu': 4, plain: 11 } },
    '2026-11-01',
    '2026-11-04',
  )
  const lines = csv.replace(/^﻿/, '').trim().split('\r\n')
  assert.equal(lines[0], 'date,tokens,calls,input,output,cache_read,cache_write,plain,"relay,eu"')
  assert.equal(lines[1], '2026-11-03,9,1,1,1,7,0,9,0', '旧版宿主的 cacheTokens 记作读')
  assert.equal(lines[2], '2026-11-04,6,1,1,1,3,1,2,4')
})

test('formatDelta：一位小数；四位数起不留小数、加千分位（上一期几乎没用量时可以到几万个百分点）', () => {
  const { formatDelta } = loadClientHelpers({ functions: ['formatDelta', 'toNumber'] })
  assert.equal(formatDelta(12.345), '+12.3%')
  assert.equal(formatDelta(-70.21), '-70.2%')
  assert.equal(formatDelta(0), '0.0%')
  assert.equal(formatDelta(999.94), '+999.9%')
  assert.equal(formatDelta(57892.8), '+57,893%')
  assert.equal(formatDelta(-1234.5), '-1,234%')
})

test('指标卡：数字与环比不被压缩；卡片放不下时环比换到下一行，不撑出卡片；第一张卡的环比排在按最宽写法占位的数字格后面', () => {
  const source = readClientSource()
  assert.match(source, /\.dps-kpi-slot > \*\{grid-area:1 \/ 1\}/)
  assert.match(source, /\.dps-kpi-ghost\{[^}]*visibility:hidden/)
  assert.match(source, /\.dps-kpi-main\{[^}]*flex:0 0 auto/)
  assert.match(source, /\.dps-kpi-main\{[^}]*flex-wrap:wrap/)
  assert.match(source, /\.dps-kpi-main\{[^}]*max-width:100%/)
  assert.match(source, /\.dps-kpi-main > \*\{flex:0 0 auto\}/)
  assert.match(source, /\.dps-delta\{[^}]*white-space:nowrap/)
  // 第一张卡：环比在标签行右边、和趋势同宽（居中在趋势正上方）；趋势只在剩下的地方伸缩、不压数字；卡片太窄时趋势不画
  assert.match(source, /\.dps-kpi-dslot\{flex:0 1 var\(--dps-trend-w\)[^}]*justify-content:center[^}]*margin-left:auto/)
  assert.match(source, /\.dps-kpi-aside\{flex:0 1 var\(--dps-trend-w\);min-width:0[^}]*margin-left:auto/)
  assert.match(source, /\.dps-kpi\[data-hero="true"\] \.dps-kpi-label\{flex-wrap:nowrap\}/)
  assert.match(source, /@container dps-hero \(max-width:170px\)\{\.dps-kpi-aside\{display:none\}\}/)
})

test('tokenTrend：本日最近 7 天日柱、本周最近 4 周周柱（周合计，本周算到今天）、本月每天折线、累计 90 天 7 日均线', () => {
  const { tokenTrend, rangeWindow } = loadClientHelpers({
    functions: ['tokenTrend', 'movingAverage', 'dailySeries', 'indexDaily', 'rangeWindow', 'daysBetween', 'parseDateKey', 'localDateKey', 'addDays', 'startOfDay', 'startOfWeek', 'toNumber'],
  })
  // 2026-11-11 是周三；每天的用量 = 那天是几号（10 月 1 日 = 1，……）
  const daily = []
  for (let day = 1; day <= 31; day += 1) daily.push({ date: `2026-10-${String(day).padStart(2, '0')}`, tokens: day })
  for (let day = 1; day <= 11; day += 1) daily.push({ date: `2026-11-${String(day).padStart(2, '0')}`, tokens: day })
  const todayKey = '2026-11-11'
  const trendOf = (range, custom) => tokenTrend(daily, range, rangeWindow(range, todayKey, custom), todayKey)

  const day = trendOf('day')
  assert.equal(day.kind, 'days')
  assert.deepEqual(day.points.map((point) => point.key), ['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11'])
  assert.deepEqual(day.points.map((point) => point.tokens), [5, 6, 7, 8, 9, 10, 11])
  assert.deepEqual(day.points.map((point) => point.current), [false, false, false, false, false, false, true])

  const week = trendOf('week')
  assert.equal(week.kind, 'weeks')
  assert.deepEqual(week.points.map((point) => [point.key, point.endKey]), [
    ['2026-10-19', '2026-10-25'],
    ['2026-10-26', '2026-11-01'],
    ['2026-11-02', '2026-11-08'],
    ['2026-11-09', '2026-11-11'],
  ])
  // 10/19–25 = 19+…+25；10/26–11/1 跨月 = 26+…+31 + 1；本周一到今天 = 9+10+11
  assert.deepEqual(week.points.map((point) => point.tokens), [154, 172, 35, 30])
  assert.deepEqual(week.points.map((point) => point.current), [false, false, false, true])

  const month = trendOf('month')
  assert.equal(month.kind, 'line')
  assert.deepEqual(month.points.map((point) => point.tokens), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])

  const all = trendOf('all')
  assert.equal(all.kind, 'average')
  assert.equal(all.points.length, 90)
  assert.equal(all.points.at(-1).key, todayKey)
  assert.equal(all.average.length, 90)
  assert.equal(all.average.at(-1), (5 + 6 + 7 + 8 + 9 + 10 + 11) / 7)

  // 自定义：31 天以内每天的折线（终点可以在过去），更长的画整个窗口的 7 日均线
  const short = trendOf('custom', { startKey: '2026-10-03', endKey: '2026-10-09' })
  assert.equal(short.kind, 'line')
  assert.deepEqual(short.points.map((point) => point.tokens), [3, 4, 5, 6, 7, 8, 9])
  const long = trendOf('custom', { startKey: '2026-09-01', endKey: '2026-11-11' })
  assert.equal(long.kind, 'average')
  assert.equal(long.points.length, 72)

  // 周一：本周只有今天一天
  const monday = tokenTrend(daily, 'week', rangeWindow('week', '2026-11-09'), '2026-11-09')
  assert.deepEqual(monday.points.at(-1), { key: '2026-11-09', endKey: '2026-11-09', tokens: 9, current: true })
  assert.equal(tokenTrend(daily, 'day', null, todayKey), null)
})

test('环比颜色：增长红色、下降绿色（取宿主主题的状态色）', () => {
  const source = readClientSource()
  assert.match(source, /\.dps-delta\[data-dir="up"\]\{color:var\(--dsw-alias-state-error-primary\)\}/)
  assert.match(source, /\.dps-delta\[data-dir="down"\]\{color:var\(--dsw-alias-state-success-primary\)\}/)
})

test('client.js 里不能声明名为 window 的局部变量（会遮住全局对象：升级后 window.location.reload() 曾因此报错）', () => {
  const source = readClientSource()
  assert.equal(/\b(const|let|var)\s+window\b/.test(source), false)
})

/* ------------------------------------------------------------ 本月 / 自定义范围 */

const rangeHelpers = () =>
  loadClientHelpers({
    functions: ['rangeWindow', 'deltaWindows', 'daysBetween', 'parseDateKey', 'localDateKey', 'addDays', 'startOfDay', 'startOfWeek'],
  })

test('rangeWindow：本日是今天一天，本周从周一起算，本月是 1 号到今天；自定义起止颠倒时对调、终点不晚于今天', () => {
  const { rangeWindow } = rangeHelpers()
  assert.deepEqual(rangeWindow('day', '2026-11-08'), { range: 'day', kind: 'day', days: 1, startKey: '2026-11-08', endKey: '2026-11-08' })
  // 2026-11-08 是周日：本周一是 11-02，已过 7 天；周一当天只有 1 天；周三 3 天
  assert.deepEqual(rangeWindow('week', '2026-11-08'), { range: 'week', kind: 'week', days: 7, startKey: '2026-11-02', endKey: '2026-11-08' })
  assert.deepEqual(rangeWindow('week', '2026-11-02'), { range: 'week', kind: 'week', days: 1, startKey: '2026-11-02', endKey: '2026-11-02' })
  assert.deepEqual(rangeWindow('week', '2026-11-04'), { range: 'week', kind: 'week', days: 3, startKey: '2026-11-02', endKey: '2026-11-04' })
  // 周一在上个月 / 上一年
  assert.deepEqual(rangeWindow('week', '2026-12-02'), { range: 'week', kind: 'week', days: 3, startKey: '2026-11-30', endKey: '2026-12-02' })
  assert.equal(rangeWindow('week', '2027-01-01').startKey, '2026-12-28')
  assert.deepEqual(rangeWindow('month', '2026-11-08'), { range: 'month', kind: 'month', days: 8, startKey: '2026-11-01', endKey: '2026-11-08' })
  assert.deepEqual(rangeWindow('month', '2026-11-01'), { range: 'month', kind: 'month', days: 1, startKey: '2026-11-01', endKey: '2026-11-01' })
  assert.deepEqual(rangeWindow('custom', '2026-11-08', { startKey: '2026-10-01', endKey: '2026-10-31' }), {
    range: 'custom',
    kind: 'custom',
    days: 31,
    startKey: '2026-10-01',
    endKey: '2026-10-31',
  })
  assert.deepEqual(rangeWindow('custom', '2026-11-08', { startKey: '2026-10-31', endKey: '2026-10-01' }).startKey, '2026-10-01', '起止颠倒自动对调')
  const clamped = rangeWindow('custom', '2026-11-08', { startKey: '2026-11-05', endKey: '2026-12-31' })
  assert.equal(clamped.endKey, '2026-11-08', '终点不晚于今天')
  assert.equal(clamped.days, 4)
  // 跨夏令时的天数也按日历算（不是毫秒除以 86400000 再取整出错）
  assert.equal(rangeWindow('custom', '2026-11-08', { startKey: '2026-03-01', endKey: '2026-03-31' }).days, 31)
  // 累计没有起点；没选过自定义日期、或者不认识的范围（早先的近 7 天等）也当累计
  assert.deepEqual(rangeWindow('all', '2026-11-08'), { range: 'all', days: 0, startKey: '', endKey: '2026-11-08' })
  assert.equal(rangeWindow('custom', '2026-11-08', null).startKey, '')
  assert.equal(rangeWindow('7d', '2026-11-08').startKey, '')
})

test('deltaWindows：本周对上周从周一起的同样天数；本日、周一没有过完的天，不比', () => {
  const { rangeWindow, deltaWindows } = rangeHelpers()
  // 周日 11-08：本周已过完周一到周六（11-02 ~ 11-07），对上周同样的六天（10-26 ~ 10-31）
  assert.deepEqual(deltaWindows(rangeWindow('week', '2026-11-08'), '2026-11-08'), {
    current: { startKey: '2026-11-02', endKey: '2026-11-07' },
    previous: { startKey: '2026-10-26', endKey: '2026-10-31' },
  })
  // 周三 11-04：已过完周一、周二，对上周一、周二
  assert.deepEqual(deltaWindows(rangeWindow('week', '2026-11-04'), '2026-11-04'), {
    current: { startKey: '2026-11-02', endKey: '2026-11-03' },
    previous: { startKey: '2026-10-26', endKey: '2026-10-27' },
  })
  // 周一：本周还没有过完的天
  assert.equal(deltaWindows(rangeWindow('week', '2026-11-02'), '2026-11-02'), null)
  // 周一在上个月：12-03 是周四，本周从 11-30 起，已过完周一到周三，对上周的 11-23 ~ 11-25
  assert.deepEqual(deltaWindows(rangeWindow('week', '2026-12-03'), '2026-12-03'), {
    current: { startKey: '2026-11-30', endKey: '2026-12-02' },
    previous: { startKey: '2026-11-23', endKey: '2026-11-25' },
  })
  // 本日：今天还没过完，不比；累计没有上一期
  assert.equal(deltaWindows(rangeWindow('day', '2026-11-08'), '2026-11-08'), null)
  assert.equal(deltaWindows(rangeWindow('all', '2026-11-08'), '2026-11-08'), null)
})

test('deltaWindows：本月对上个月从 1 号起的同样天数；自定义整段在过去时整段对前一段', () => {
  const { rangeWindow, deltaWindows } = rangeHelpers()
  // 11 月 8 日看本月：已过完 1–7 日，对 10 月 1–7 日
  assert.deepEqual(deltaWindows(rangeWindow('month', '2026-11-08'), '2026-11-08'), {
    current: { startKey: '2026-11-01', endKey: '2026-11-07' },
    previous: { startKey: '2026-10-01', endKey: '2026-10-07' },
  })
  // 1 号还没有过完的天：不比
  assert.equal(deltaWindows(rangeWindow('month', '2026-11-01'), '2026-11-01'), null)
  // 3 月 31 日看本月：上一期是 2 月 1 日到 2 月最后一天（不跨进 3 月）
  assert.deepEqual(deltaWindows(rangeWindow('month', '2026-03-31'), '2026-03-31').previous, { startKey: '2026-02-01', endKey: '2026-02-28' })
  // 自定义 10 月整月（已过完）：对它前面的 31 天
  assert.deepEqual(deltaWindows(rangeWindow('custom', '2026-11-08', { startKey: '2026-10-01', endKey: '2026-10-31' }), '2026-11-08'), {
    current: { startKey: '2026-10-01', endKey: '2026-10-31' },
    previous: { startKey: '2026-08-31', endKey: '2026-09-30' },
  })
  // 自定义到今天：和固定范围一样不含今天
  assert.deepEqual(deltaWindows(rangeWindow('custom', '2026-11-08', { startKey: '2026-11-05', endKey: '2026-11-08' }), '2026-11-08'), {
    current: { startKey: '2026-11-05', endKey: '2026-11-07' },
    previous: { startKey: '2026-11-01', endKey: '2026-11-03' },
  })
  // 只选了今天一天：没有过完的天
  assert.equal(deltaWindows(rangeWindow('custom', '2026-11-08', { startKey: '2026-11-08', endKey: '2026-11-08' }), '2026-11-08'), null)
})

test('rangeText：今年的范围不写年份，跨年写全；只有一天时写一个日期', () => {
  const { rangeText } = loadClientHelpers({
    extraCode: ["function formatDate(date, options) { return options.year ? `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}` : `${date.getMonth() + 1}/${date.getDate()}` }"],
    functions: ['rangeText', 'parseDateKey'],
  })
  assert.equal(rangeText({ startKey: '2026-10-01', endKey: '2026-10-31' }, '2026-11-08'), '10/1–10/31')
  assert.equal(rangeText({ startKey: '2025-12-20', endKey: '2026-01-05' }, '2026-11-08'), '2025/12/20–2026/1/5')
  assert.equal(rangeText({ startKey: '2026-11-03', endKey: '2026-11-03' }, '2026-11-08'), '11/3')
  assert.equal(rangeText({ startKey: '', endKey: '2026-11-08' }, '2026-11-08'), '')
})

/* ------------------------------------------------------------ 项目 */

const projectHelpers = () =>
  loadClientHelpers({
    extraCode: ['const PROJECT_ROWS = 8'],
    functions: ['deriveProjects', 'pathTail', 'toNumber'],
  })

test('pathTail：取路径最后几段，Windows / POSIX 分隔符都认', () => {
  const { pathTail } = projectHelpers()
  assert.equal(pathTail('C:\\Users\\me\\code\\atlas', 1), 'atlas')
  assert.equal(pathTail('C:\\Users\\me\\code\\atlas', 2), 'code/atlas')
  assert.equal(pathTail('/srv/beacon/', 1), 'beacon')
  assert.equal(pathTail('', 1), '')
})

test('deriveProjects：按用量降序；同名文件夹带上上一级目录区分；子代理占比；未知项目', () => {
  const { deriveProjects } = projectHelpers()
  const data = deriveProjects(
    { 'c:/a/web': 600, 'c:/b/web': 300, '': 100 },
    { 'c:/a/web': 150, 'c:/b/web': 999 },
    { 'c:/a/web': 'C:\\a\\web', 'c:/b/web': 'C:\\b\\web' },
  )
  assert.equal(data.total, 1000)
  assert.deepEqual(data.rows.map((row) => row.id), ['c:/a/web', 'c:/b/web', ''])
  assert.deepEqual(data.rows.map((row) => row.name), ['a/web', 'b/web', ''], '两个都叫 web：往上加一级目录')
  assert.equal(data.rows[0].subagentShare, 25)
  assert.equal(data.rows[1].subagent, 300, '子代理部分不会超过项目本身')
  assert.equal(data.rows[2].subagentShare, 0)
  assert.equal(data.rows[0].path, 'C:\\a\\web')
  assert.equal(data.rows.reduce((sum, row) => sum + row.share, 0), 100)
})

test('deriveProjects：超过 8 个项目时其余并成「其他项目（N）」，子代理也合并', () => {
  const { deriveProjects } = projectHelpers()
  const byProject = {}
  const sub = {}
  for (let index = 0; index < 11; index += 1) {
    byProject[`p${index}`] = (11 - index) * 10
    sub[`p${index}`] = 1
  }
  const data = deriveProjects(byProject, sub, {})
  assert.equal(data.rows.length, 9)
  const other = data.rows.at(-1)
  assert.equal(other.id, '__other')
  assert.equal(other.other, true)
  assert.equal(other.count, 3)
  assert.equal(other.tokens, 30 + 20 + 10)
  assert.equal(other.subagent, 3)
  assert.deepEqual(deriveProjects({}, {}, {}), { total: 0, subagentTotal: 0, rows: [] })
  assert.deepEqual(deriveProjects(undefined, undefined, undefined).rows, [])
})

test('summarizeDaily：按项目与子代理部分累加', () => {
  const { summarizeDaily } = loadClientHelpers({
    functions: ['summarizeDaily', 'emptySummary', 'emptyUsage', 'addUsage', 'indexDaily', 'parseDateKey', 'toNumber'],
    constants: ['MIX_KEYS'],
  })
  const summary = summarizeDaily(
    [
      { date: '2026-11-05', tokens: 10, byProject: { a: 6, b: 4 }, byProjectSubagent: { a: 2 } },
      { date: '2026-11-06', tokens: 5, byProject: { a: 5 }, byProjectSubagent: { a: 1 } },
    ],
    '',
    '',
  )
  assert.deepEqual(summary.byProject, { a: 11, b: 4 })
  assert.deepEqual(summary.byProjectSubagent, { a: 3 })
})

test('summarizeDaily：八类 mix 按窗口逐项累加；没有 mix 的日子（旧版宿主）不贡献、脏值当 0', () => {
  const { summarizeDaily } = loadClientHelpers({
    functions: ['summarizeDaily', 'emptySummary', 'emptyUsage', 'addUsage', 'indexDaily', 'parseDateKey', 'toNumber'],
    constants: ['MIX_KEYS'],
  })
  const daily = [
    { date: '2026-11-04', tokens: 36, mix: [1, 2, 3, 4, 5, 6, 7, 8] },
    { date: '2026-11-05', tokens: 80, mix: [10, 10, 10, 10, 10, 10, 10, 10] },
    { date: '2026-11-06', tokens: 9 },
    { date: '2026-11-07', tokens: 5, mix: [5, -2, 'x', NaN] },
  ]
  assert.deepEqual(summarizeDaily(daily, '', '').mix, [16, 12, 13, 14, 15, 16, 17, 18])
  assert.deepEqual(summarizeDaily(daily, '2026-11-05', '2026-11-06').mix, [10, 10, 10, 10, 10, 10, 10, 10])
  assert.deepEqual(summarizeDaily([], '', '').mix, [0, 0, 0, 0, 0, 0, 0, 0])
})

/* ------------------------------------------------------------ 费用 */

const costHelpers = (locale = withLocale) =>
  loadClientHelpers({
    ...locale,
    constants: ['OFFICIAL_PRICES', 'CN_HOLIDAYS', 'OFFICIAL_PROVIDERS', 'BILLING_MODES', 'holidayKeys'],
    functions: [
      'computeCosts', 'officialRate', 'isPeakHour', 'priceFamily', 'modelBaseId', 'planCycleStart', 'holidaySet', 'billingOf', 'daysInMonth', 'validDateKey',
      'moneyParts', 'formatMoney', 'bigNumberParts', 'unitGap', 'indexDaily', 'parseDateKey', 'localDateKey', 'addDays', 'toNumber',
    ],
  })
// 北京时间 → UTC 小时序号
const bjHour = (year, month, day, hour) => Date.UTC(year, month - 1, day, hour - 8) / 3600000
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} ≠ ${expected}`)
const rateOf = (rate) => (rate ? { hit: rate.hit, miss: rate.miss, output: rate.output, peak: rate.peak } : rate)

test('priceFamily / modelBaseId：DeepSeek 的 Flash / Pro / 经济版各归一档；Ollama 云端去掉标签，本地保留参数量；其他厂商没有内置价', () => {
  const { priceFamily, modelBaseId } = costHelpers()
  for (const id of ['deepseek-flash', 'deepseek-v4-1-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision', 'deepseek-v4-flash:cloud', 'deepseek-v4-flash:q4-k-m']) assert.equal(priceFamily(id), 'flash', id)
  assert.equal(priceFamily('deepseek-v4-1-flash-economy'), 'flash-economy', '方舟经济版单独一档')
  assert.equal(priceFamily('deepseek-v4-pro'), 'pro')
  assert.equal(priceFamily('deepseek-v4-pro:cloud'), 'pro')
  for (const id of ['deepseek-chat', 'deepseek-r1:14b', 'deepseek-r1-14b', 'claude-sonnet-5-5', undefined]) assert.equal(priceFamily(id), '', String(id))
  // Ollama 的「名字:标签」
  assert.equal(modelBaseId('deepseek-v4-flash:cloud'), 'deepseek-v4-flash', '云端就是官方那个模型')
  assert.equal(modelBaseId('deepseek-v3-1:671b-cloud'), 'deepseek-v3-1')
  assert.equal(modelBaseId('deepseek-r1:14b'), 'deepseek-r1-14b', '本地的蒸馏小模型：参数量留下')
  assert.equal(modelBaseId('deepseek-r1:1-5b'), 'deepseek-r1-1.5b')
  assert.equal(modelBaseId('qwen3:8b-q4-k-m'), 'qwen3-8b', '参数量留下、量化去掉')
  assert.equal(modelBaseId('qwen3:latest'), 'qwen3')
  assert.equal(modelBaseId('llama3:fp16'), 'llama3')
  assert.equal(modelBaseId('deepseek-flash'), 'deepseek-flash', '没有标签的原样')
  assert.equal(modelBaseId(':odd'), ':odd')
  assert.equal(modelBaseId(undefined), '')
})

test('isPeakHour：北京时间工作日 9–12、14–18 点；周末、法定节假日全天空闲', () => {
  const { isPeakHour } = costHelpers()
  assert.equal(isPeakHour(bjHour(2026, 11, 6, 9)), true, '周五 9 点')
  assert.equal(isPeakHour(bjHour(2026, 11, 6, 11)), true, '周五 11 点')
  assert.equal(isPeakHour(bjHour(2026, 11, 6, 12)), false, '12 点起午休')
  assert.equal(isPeakHour(bjHour(2026, 11, 6, 14)), true)
  assert.equal(isPeakHour(bjHour(2026, 11, 6, 17)), true)
  assert.equal(isPeakHour(bjHour(2026, 11, 6, 18)), false)
  assert.equal(isPeakHour(bjHour(2026, 11, 6, 8)), false)
  assert.equal(isPeakHour(bjHour(2026, 11, 7, 10)), false, '周六')
  assert.equal(isPeakHour(bjHour(2026, 10, 5, 10)), false, '国庆假期里的周一')
  assert.equal(isPeakHour(bjHour(2026, 9, 25, 10)), false, '中秋（周五）')
  assert.equal(isPeakHour(bjHour(2026, 10, 9, 10)), true, '国庆后的周五')
  assert.equal(isPeakHour(bjHour(2026, 10, 10, 10)), false, '调休上班的周六：价格页写的是周一至周五，按空闲算')
})

test('officialRate：按调用时间选价格行；8 月 17 日前没有已知价格', () => {
  const { officialRate } = costHelpers()
  assert.deepEqual(rateOf(officialRate('deepseek-v4-flash', bjHour(2026, 8, 20, 10))), { hit: 0.1, miss: 3, output: 9, peak: true })
  assert.deepEqual(rateOf(officialRate('deepseek-v4-flash', bjHour(2026, 8, 20, 20))), { hit: 0.05, miss: 1.5, output: 4.5, peak: false })
  // 9 月 10 日北京时间 12:00 起 Flash 降价：11 点还是旧价，12 点是新价（12 点本身是空闲时段）
  assert.deepEqual(rateOf(officialRate('deepseek-flash', bjHour(2026, 9, 10, 11))), { hit: 0.1, miss: 3, output: 9, peak: true })
  assert.deepEqual(rateOf(officialRate('deepseek-flash', bjHour(2026, 9, 10, 12))), { hit: 0.02, miss: 1, output: 4, peak: false })
  assert.deepEqual(rateOf(officialRate('deepseek-flash', bjHour(2026, 9, 10, 14))), { hit: 0.04, miss: 2, output: 8, peak: true })
  assert.deepEqual(rateOf(officialRate('deepseek-v4-pro', bjHour(2026, 11, 6, 10))), { hit: 0.3, miss: 9, output: 27, peak: true })
  assert.equal(officialRate('deepseek-v4-pro', bjHour(2026, 8, 16, 23)), null, '8 月 17 日 0 点之前')
  assert.deepEqual(rateOf(officialRate('deepseek-v4-pro', bjHour(2026, 8, 17, 0))), { hit: 0.15, miss: 4.5, output: 13.5, peak: false })
  const deepseek = officialRate('deepseek-flash', bjHour(2026, 11, 6, 10))
  assert.equal(deepseek.currency, 'CNY')
  assert.equal(deepseek.timed, true)
  assert.equal(deepseek.write, deepseek.miss, 'DeepSeek 没有缓存写入：按未命中价')
  // DeepSeek 以外：价格表（美元），没有表时不知道
  assert.equal(officialRate('claude-sonnet-5-5', bjHour(2026, 11, 6, 10)), null)
  const table = { 'claude-sonnet-5-5': [2, 10, 0.1, 2.5], 'gpt-5-5': [5, 30, 0.5, null], 'qwen-max': [1.6, 6.4, null, null], broken: ['x', 1] }
  assert.deepEqual(officialRate('claude-sonnet-5-5', bjHour(2026, 11, 6, 10), table), { currency: 'USD', miss: 2, hit: 0.1, write: 2.5, output: 10, peak: false, timed: false })
  assert.deepEqual(officialRate('gpt-5-5', 0, table), { currency: 'USD', miss: 5, hit: 0.5, write: 5, output: 30, peak: false, timed: false }, '没有缓存写入价：按未缓存输入价')
  assert.deepEqual(officialRate('qwen-max', 0, table), { currency: 'USD', miss: 1.6, hit: 1.6, write: 1.6, output: 6.4, peak: false, timed: false }, '没有缓存读价：按未缓存输入价')
  assert.equal(officialRate('broken', 0, table), null)
  // DeepSeek 的 Flash / Pro 只认内置价表，不退回价格表里别家转售的旧价
  assert.equal(officialRate('deepseek-v4-pro', bjHour(2026, 8, 1, 10), { 'deepseek-v4-pro': [1, 1, 1, 1] }), null)
  // flat：不分峰谷，任何时段都按高峰价（中转站、coding plan 用这个；中转站的「官方价」就是高峰价）
  assert.deepEqual(rateOf(officialRate('deepseek-flash', bjHour(2026, 11, 6, 21), {}, true)), { hit: 0.04, miss: 2, output: 8, peak: false }, '空闲时段也按高峰价')
  assert.deepEqual(rateOf(officialRate('deepseek-flash', bjHour(2026, 11, 7, 10), {}, true)), { hit: 0.04, miss: 2, output: 8, peak: false }, '周末也按高峰价')
  assert.equal(officialRate('deepseek-flash', bjHour(2026, 11, 6, 10), {}, true).timed, false, '统一价不算进高峰占比')
  assert.deepEqual(rateOf(officialRate('deepseek-v4-pro', bjHour(2026, 11, 6, 21), {}, true)), { hit: 0.3, miss: 9, output: 27, peak: false }, '等于方舟按量的 V4-Pro 一口价')
  // 方舟经济版：比 Flash 便宜两成，高峰翻倍
  assert.deepEqual(rateOf(officialRate('deepseek-v4-1-flash-economy', bjHour(2026, 11, 6, 10))), { hit: 0.032, miss: 1.6, output: 6.4, peak: true })
  assert.deepEqual(rateOf(officialRate('deepseek-v4-1-flash-economy', bjHour(2026, 11, 6, 21), {}, true)), { hit: 0.032, miss: 1.6, output: 6.4, peak: false })
  // 美元价格表本来就不分峰谷：flat 不影响
  assert.deepEqual(officialRate('claude-sonnet-5-5', 0, table, true), officialRate('claude-sonnet-5-5', 0, table))
})

test('computeCosts：官方价折算与四种计费方式；包月 = 用量换算成钱；未设置的不算进花费；不认识的写法当没设置', () => {
  const { computeCosts } = costHelpers()
  const peak = bjHour(2026, 11, 6, 10)
  const off = bjHour(2026, 11, 6, 21)
  const M = 1e6
  const daily = [
    {
      date: '2026-11-06',
      slots: [
        [peak, 'deepseek-official', 'deepseek-flash', 'p1', M, M, 0, M],
        [off, 'relay', 'deepseek-v4-1-flash', 'p2', M, 0, 0, 0],
        [off, 'relay', 'claude-x', 'p2', M, 0, 0, 0],
        [off, 'mystery', 'deepseek-v4-1-flash', 'p1', M, 0, 0, 0],
        [off, 'plan', 'deepseek-v4-1-flash', 'p1', M, 0, 0, M],
        [off, 'work', 'deepseek-v4-1-flash', 'p2', M, 0, 0, 0],
        [off, 'old', 'deepseek-v4-1-flash', 'p2', M, 0, 0, 0],
      ],
    },
  ]
  const settings = {
    relay: { mode: 'multiplier', factor: 0.1 },
    plan: { mode: 'plan', monthly: 300, since: '2026-11-01' },
    work: { mode: 'free' },
    // 早期版本的「自定义单价」已经去掉：手写进 billing.json 的也当没设置
    old: { mode: 'custom', miss: 2, hit: 0.5, write: 2, output: 10 },
  }
  const day = computeCosts(daily, '2026-11-06', '2026-11-06', settings, '2026-11-06')
  near(day.byProvider['deepseek-official'].spend, 2 + 0.04 + 8, '官方直连（自动识别）：高峰价')
  near(day.byProvider.relay.spend, 0.2, '打折：统一价（高峰价）2 元 × 0.1，晚上也一样；没有官方价的 claude 那条不算')
  near(day.byProvider.plan.spend, 2 + 8, '包月：用量按统一价（高峰价）换算（输入 2 元 + 输出 8 元），不是月费')
  near(day.byProvider.work.spend, 0, '不计入')
  assert.equal(day.byProvider.mystery.spend, null, '未设置：不知道花了多少')
  assert.equal(day.byProvider.old.mode, 'unset', '不认识的写法')
  assert.equal(day.byProvider.old.spend, null)
  assert.deepEqual(day.unset, ['mystery', 'old'])
  near(day.spend, 10.04 + 0.2 + 10, '花费合计不含未设置的')
  near(day.value, 10.04 + 2 + 2 + 10 + 2 + 2, '官方价折算：所有有官方价的用量')
  near(day.peakValue, 10.04, '高峰部分')
  // 「没有官方价、没算进花费」只算花费要按官方价算的那部分：打折那家的 claude-x
  assert.equal(day.unpricedTokens, M, '只有打折那家的 claude-x')
  assert.deepEqual(day.byProvider.relay.unpriced, ['claude-x'])
  near(day.byProject.p1, 10.04 + 10, '包月的钱直接算在用它的项目上')
  near(day.byProject.p2, 0.2, 'p2')
  // 累计：包月只看用量，没有用量的日子不收钱
  const all = computeCosts(daily, '', '2026-11-08', settings, '2026-11-08')
  near(all.byProvider.plan.spend, 10, '只有 11-06 有用量')
  // 空数据不出 NaN
  const empty = computeCosts([], '', '2026-11-06', {}, '2026-11-06')
  assert.equal(empty.spend, 0)
  assert.equal(empty.value, 0)
})

test('computeCosts：只有计费方式是「官方价」的才分峰谷；中转站、包月、不计入、未设置任何时段都按统一价（高峰价）', () => {
  const { computeCosts } = costHelpers()
  const M = 1e6
  const ids = ['deepseek-official', 'relay', 'plan', 'work', 'mystery', 'manual']
  for (const [hour, label, official] of [[bjHour(2026, 11, 6, 21), '空闲时段', 1], [bjHour(2026, 11, 6, 10), '高峰时段', 2]]) {
    const daily = [{ date: '2026-11-06', slots: ids.map((id) => [hour, id, 'deepseek-v4-1-flash', 'p', M, 0, 0, 0]) }]
    const settings = { relay: { mode: 'multiplier', factor: 1 }, plan: { mode: 'plan', monthly: 199 }, work: { mode: 'free' }, manual: { mode: 'official' } }
    const result = computeCosts(daily, '', '2026-11-06', settings, '2026-11-06')
    near(result.byProvider['deepseek-official'].value, official, `${label}：官方直连按真实时段价`)
    near(result.byProvider.manual.value, official, `${label}：手动设成官方价的也分时段`)
    for (const id of ['relay', 'plan', 'work', 'mystery']) near(result.byProvider[id].value, 2, `${label}：${id} 按高峰价`)
    near(result.byProvider.relay.spend, 2)
    near(result.byProvider.plan.spend, 2)
    near(result.peakBase, 2 * official, `${label}：只有两家官方价进高峰占比的分母`)
    near(result.peakValue, official === 2 ? 4 : 0)
  }
})

test('moneyParts / formatMoney：100 元以下两位小数、以上一位，千分位；一万起写万；极小值写 <¥0.01', () => {
  const { moneyParts, formatMoney } = costHelpers()
  assert.equal(formatMoney(46.123), '¥46.12')
  assert.equal(formatMoney(446.123), '¥446.1')
  assert.equal(formatMoney(1234.56), '¥1,234.6')
  assert.equal(formatMoney(199), '¥199', '整数不写 .0')
  assert.equal(formatMoney(12345), '¥1.2 万')
  assert.equal(formatMoney(0.001), '<¥0.01')
  assert.equal(formatMoney(0), '¥0')
  assert.deepEqual(moneyParts(5.5), [{ prefix: '¥', value: '5.50', unit: '' }])
  // 先取整再选格式：不会出现 ¥100.00、¥10,000
  assert.equal(formatMoney(99.996), '¥100')
  assert.equal(formatMoney(99.994), '¥99.99')
  assert.equal(formatMoney(9999.96), '¥1.0 万')
  assert.equal(formatMoney(9999.94), '¥9,999.9')
  assert.equal(formatMoney(1.2e8), '¥1.2 亿')
  const english = costHelpers(withEnglish).formatMoney
  assert.equal(english(12345), '¥12.3K')
  assert.equal(english(2.5e6), '¥2.5M')
})

test('computeCosts：不计入的用量不算「没有官方价」；官方价、打折、包月的才算（它们的钱要按官方价换算）', () => {
  const { computeCosts } = costHelpers()
  const M = 1e6
  const daily = [{ date: '2026-11-06', slots: [[0, 'a', 'mystery', 'p', M, 0, 0, M], [0, 'b', 'mystery', 'p', M, 0, 0, M], [0, 'c', 'mystery', 'p', M, 0, 0, M], [0, 'd', 'mystery', 'p', M, 0, 0, M], [0, 'f', 'mystery', 'p', M, 0, 0, M]] }]
  const settings = {
    a: { mode: 'multiplier', factor: 0.5 },
    b: { mode: 'plan', monthly: 300 },
    c: { mode: 'free' },
    d: { mode: 'official' },
  }
  const result = computeCosts(daily, '', '2026-11-06', settings, '2026-11-06', { table: {} })
  assert.equal(result.unpricedTokens, 6 * M, '打折（a）、包月（b）、官方价（d）')
  assert.deepEqual(['a', 'b', 'c', 'd', 'f'].map((id) => result.byProvider[id].unpriced.length), [1, 1, 0, 1, 1], '未设置（f）的格子显示官方价，悬停也要写出来')
  near(result.byProvider.b.spend, 0, '没有官方价的用量换算不了，包月这家是 0')
})

test('planCycleStart：开始日期是几号，每个月就从几号算起（那个月没有这一天取月末）；没填按自然月；还没开始时返回开始日期', () => {
  const { planCycleStart } = costHelpers()
  assert.equal(planCycleStart('', '2026-11-10'), '2026-11-01', '没填：自然月')
  assert.equal(planCycleStart(undefined, '2026-11-10'), '2026-11-01')
  assert.equal(planCycleStart('2026-02-31', '2026-11-10'), '2026-11-01', '不存在的日子当没填')
  assert.equal(planCycleStart('2026-10-20', '2026-11-10'), '2026-10-20', '10-20 起：本订阅月从 10-20 开始')
  assert.equal(planCycleStart('2026-10-20', '2026-11-20'), '2026-11-20', '续费当天就是新的一个月')
  assert.equal(planCycleStart('2026-10-20', '2026-11-25'), '2026-11-20')
  assert.equal(planCycleStart('2026-10-20', '2026-10-20'), '2026-10-20', '第一天')
  assert.equal(planCycleStart('2026-10-31', '2026-11-30'), '2026-11-30', '11 月没有 31 号：取月末')
  assert.equal(planCycleStart('2026-10-31', '2026-11-29'), '2026-10-31')
  assert.equal(planCycleStart('2026-01-31', '2026-03-01'), '2026-02-28', '2 月取 28 号')
  assert.equal(planCycleStart('2025-12-15', '2026-01-10'), '2025-12-15', '跨年')
  assert.equal(planCycleStart('2026-12-01', '2026-11-10'), '2026-12-01', '还没开始')
  assert.equal(planCycleStart('2026-10-20', 'nope'), '')
})

test('computeCosts：包月的钱就是各项目自己的用量换算，没有官方价的用量记 0', () => {
  const { computeCosts } = costHelpers()
  const table = { priced: [1, 1, 1, 1] }
  const settings = { plan: { mode: 'plan', monthly: 300, since: '2026-11-01' } }
  const hour = bjHour(2026, 11, 6, 10) // 高峰时段：包月照样按统一价
  const mixed = [{ date: '2026-11-06', slots: [[hour, 'plan', 'priced', 'A', 1e6, 0, 0, 0], [hour, 'plan', 'mystery', 'B', 1e6, 0, 0, 0], [hour, 'plan', 'deepseek-v4-1-flash-economy', 'C', 1e6, 0, 0, 0]] }]
  const one = computeCosts(mixed, '2026-11-06', '2026-11-06', settings, '2026-11-06', { table, usdCny: 7 })
  near(one.byProject.A, 7, 'A：1 美元 × 7')
  assert.equal(one.byProject.B, 0, 'B 没有官方价：换算不了，记 0（和官方价、打折一样）')
  near(one.byProject.C, 1.6, 'C：方舟经济版统一价（高峰价）1.6 元')
  near(one.byProvider.plan.spend, 8.6)
})

test('computeCosts：用量全部来自未设置 / 不计入的项目不出现在 byProject（页面写「—」）', () => {
  const { computeCosts } = costHelpers()
  const daily = [{ date: '2026-11-06', slots: [[0, 'deepseek-official', 'deepseek-v4-1-flash', 'P1', 1e6, 0, 0, 0], [0, 'work', 'deepseek-v4-1-flash', 'P2', 1e6, 0, 0, 0], [0, 'mystery', 'deepseek-v4-1-flash', 'P3', 1e6, 0, 0, 0]] }]
  const result = computeCosts(daily, '', '2026-11-06', { work: { mode: 'free' } }, '2026-11-06')
  assert.deepEqual(Object.keys(result.byProject), ['P1'])
})

test('officialRate：价格表里输入输出都是 0 的行——四项全 0 是免费，缓存是 null 的是还没定价', () => {
  const { officialRate } = costHelpers()
  assert.equal(officialRate('placeholder', 0, { placeholder: [0, 0, null, null] }), null)
  assert.deepEqual(officialRate('free', 0, { free: [0, 0, 0, 0] }), { currency: 'USD', miss: 0, hit: 0, write: 0, output: 0, peak: false, timed: false })
  assert.equal(officialRate('constructor', 0, {}), null, '原型上的名字不算')
})

test('computeCosts：外国模型按价格表美元价换算人民币；缓存写入单独计价；高峰占比只看有峰谷价的模型', () => {
  const { computeCosts } = costHelpers()
  const M = 1e6
  const peak = bjHour(2026, 11, 6, 10)
  const table = { 'claude-sonnet-5-5': [2, 10, 0.1, 2.5], 'gpt-5-5': [5, 30, 0.5, null] }
  const daily = [
    {
      date: '2026-11-06',
      slots: [
        // Claude（经中转）：未缓存 1M、读 10M、写 1M、输出 1M → 2 + 1 + 2.5 + 10 = 15.5 美元
        [peak, 'relay', 'claude-sonnet-5-5', 'p1', M, 10 * M, M, M],
        // GPT：没有写入价，写入按输入价 → 5 + 0.5 + 5 + 30 = 40.5 美元
        [peak, 'relay', 'gpt-5-5', 'p2', M, M, M, M],
        // DeepSeek 高峰：2 + 0.04 + 8 = 10.04 元
        [peak, 'deepseek-official', 'deepseek-flash', 'p1', M, M, 0, M],
        // 不认识的模型
        [peak, 'relay', 'mystery-model', 'p1', M, 0, 0, 0],
      ],
    },
  ]
  const rate = 7
  const settings = { relay: { mode: 'multiplier', factor: 0.1 } }
  const day = computeCosts(daily, '2026-11-06', '2026-11-06', settings, '2026-11-06', { table, usdCny: rate })
  near(day.byProvider.relay.value, (15.5 + 40.5) * rate, '官方价折算：美元 × 汇率')
  near(day.byProvider.relay.spend, (15.5 + 40.5) * rate * 0.1, '打折作用在外国模型的官方价上')
  assert.deepEqual(day.byProvider.relay.unpriced, ['mystery-model'])
  assert.deepEqual(day.byProvider.relay.models, ['claude-sonnet-5-5', 'gpt-5-5', 'mystery-model'])
  near(day.usdValue, (15.5 + 40.5) * rate, '美元计价部分')
  near(day.peakBase, 10.04, '只有 DeepSeek 有峰谷价')
  near(day.peakValue, 10.04, 'DeepSeek 这条在高峰时段')
  // 汇率变了，人民币金额跟着线性变
  const doubled = computeCosts(daily, '2026-11-06', '2026-11-06', settings, '2026-11-06', { table, usdCny: rate * 2 })
  near(doubled.byProvider.relay.value, day.byProvider.relay.value * 2, '汇率翻倍')
  near(doubled.byProvider['deepseek-official'].value, day.byProvider['deepseek-official'].value, '人民币价不受汇率影响')
})

test('billingDraft：倍数、月费、开始日期不完整或不合法时不能保存；没有「单价」这一档', () => {
  const { billingDraft } = loadClientHelpers({
    functions: ['billingDraft', 'billingNumber', 'validDateKey', 'parseDateKey', 'localDateKey'],
    constants: ['BILLING_LIMIT'],
  })
  assert.equal(billingDraft('custom', { prices: { '*': { miss: '1', hit: '0.1', write: '', output: '2' } } }), null)
  assert.deepEqual(billingDraft('official', {}), { mode: 'official' })
  assert.deepEqual(billingDraft('free', {}), { mode: 'free' })
  assert.deepEqual(billingDraft('multiplier', { factor: '0.12' }), { mode: 'multiplier', factor: 0.12 })
  assert.equal(billingDraft('multiplier', { factor: '200' }), null)
  assert.deepEqual(billingDraft('plan', { monthly: '199', since: '2026-10-20' }), { mode: 'plan', monthly: 199, since: '2026-10-20' })
  assert.deepEqual(billingDraft('plan', { monthly: '199', since: '' }), { mode: 'plan', monthly: 199 })
  // 和宿主同样的限制：超过 100000、不存在的日子、不是普通小数写法都不能点确定
  assert.equal(billingDraft('plan', { monthly: '100001' }), null)
  assert.deepEqual(billingDraft('plan', { monthly: '100000' }), { mode: 'plan', monthly: 100000 })
  assert.equal(billingDraft('plan', { monthly: '199', since: '2026-02-31' }), null)
  assert.equal(billingDraft('plan', { monthly: '199', since: '0202-06-01' }), null)
  for (const text of ['1e3', '0x10', 'Infinity', '-1', '1,000', '1.2.3', '']) assert.equal(billingDraft('plan', { monthly: text }), null, text)
  assert.deepEqual(billingDraft('multiplier', { factor: '.5' }), { mode: 'multiplier', factor: 0.5 })
  assert.deepEqual(billingDraft('multiplier', { factor: ' 0.12 ' }), { mode: 'multiplier', factor: 0.12 })
})

test('decodeSnapshot：slots 里的编号按 slotKeys 还原成名字；旧版宿主（没有 slotKeys）原样返回', () => {
  const { decodeSnapshot } = loadClientHelpers({ functions: ['decodeSnapshot'] })
  const encoded = {
    ok: true,
    slotKeys: { providers: ['alpha', 'gw|east'], models: ['deepseek-v4-1-flash'], projects: ['c:/a', ''] },
    daily: [{ date: '2026-11-06', tokens: 3, slots: [[1, 0, 0, 0, 1, 0, 0, 0], [2, 1, 0, 1, 1, 1, 0, 0]] }, { date: '2026-11-07', tokens: 0 }],
  }
  const decoded = decodeSnapshot(encoded)
  assert.deepEqual(decoded.daily[0].slots, [[1, 'alpha', 'deepseek-v4-1-flash', 'c:/a', 1, 0, 0, 0], [2, 'gw|east', 'deepseek-v4-1-flash', '', 1, 1, 0, 0]])
  assert.deepEqual(decoded.daily[1], { date: '2026-11-07', tokens: 0 })
  assert.equal(encoded.daily[0].slots[0][1], 0, '不改原对象')
  const legacy = { daily: [{ slots: [[1, 'p', 'm', '', 1, 0, 0, 0]] }] }
  assert.equal(decodeSnapshot(legacy), legacy)
  assert.equal(decodeSnapshot(null), null)
  // 编号越界：当空名字，不抛错
  assert.deepEqual(decodeSnapshot({ slotKeys: {}, daily: [{ slots: [[1, 9, 9, 9, 1, 0, 0, 0]] }] }).daily[0].slots[0], [1, '', '', '', 1, 0, 0, 0])
})

test('settleEdits / sameValue：快照跟上的改动丢掉，没跟上的留着；键的顺序不算', () => {
  const { settleEdits, sameValue } = loadClientHelpers({ functions: ['settleEdits', 'sameValue', 'dropKey', 'ownValue'] })
  assert.equal(sameValue({ mode: 'plan', monthly: 1 }, { monthly: 1, mode: 'plan' }), true)
  assert.equal(sameValue({ mode: 'plan', monthly: 1 }, { mode: 'plan', monthly: 2 }), false)
  assert.equal(sameValue(null, undefined), true)
  const edits = { a: { mode: 'free' }, b: null, c: { mode: 'official' } }
  const saved = { a: { mode: 'free' }, c: { mode: 'multiplier', factor: 0.1 } }
  const next = settleEdits(edits, (id) => (Object.prototype.hasOwnProperty.call(saved, id) ? saved[id] : null))
  assert.deepEqual(next, { c: { mode: 'official' } }, 'a 已经存上、b 已经删掉；c 还在保存中')
  assert.equal(settleEdits(next, () => 'nothing'), next, '没有可丢的就返回原对象（不触发重绘）')
})

test('tickPlan：最多 12 个刻度；按月超过一年时落在日历月上；跨年时年份变了的刻度带年份', () => {
  const { tickPlan } = loadClientHelpers({ functions: ['tickPlan'] })
  const months = (year, month, count) => Array.from({ length: count }, (_, index) => ({ start: new Date(year, month + index, 1) }))
  const long = tickPlan(months(2020, 0, 83), 'month')
  const shown = long.map((plan, index) => (plan.shown ? index : -1)).filter((index) => index >= 0)
  assert.ok(shown.length <= 12, `${shown.length} 个刻度`)
  assert.ok(shown.every((index) => index % 12 === 0), '83 个月：每 12 个月一个，都是 1 月')
  assert.ok(shown.every((index) => long[index].withYear), '每个都换了年份')
  const year = tickPlan(months(2026, 0, 12), 'month')
  assert.ok(year.every((plan) => plan.shown && !plan.withYear), '一年以内：每个月都标，不带年份')
  const crossing = tickPlan(months(2025, 9, 6), 'month')
  assert.deepEqual(crossing.map((plan) => plan.withYear), [true, false, false, true, false, false], '25 年 10 月起：第一个和 26 年 1 月带年份')
  // 26 年 12 月起的 6 个月：12 月和紧挨着的 1 月都带年份（6 个桶每列够宽，不会叠；浏览器里逐月量过）
  const december = tickPlan(months(2026, 11, 6), 'month')
  assert.deepEqual(december.map((plan) => plan.withYear), [true, true, false, false, false, false])
  const weeks = Array.from({ length: 94 }, (_, index) => ({ start: new Date(2026, 5, 1 + 7 * index) }))
  const weekly = tickPlan(weeks, 'week')
  assert.equal(weekly[weekly.length - 1].shown, true, '按周：最后一个总在')
  assert.ok(weekly.filter((plan) => plan.shown).length <= 12)
  assert.ok(weekly.some((plan) => plan.shown && plan.withYear))
})

test('pieSlices：从 12 点钟顺时针排，占比之和 = 1，角度首尾相接；总量为 0（或没有数据）时没有扇区；脏值当 0', () => {
  const { pieSlices } = loadClientHelpers({ functions: ['pieSlices', 'toNumber'] })
  const slices = pieSlices([50, 30, 20])
  assert.deepEqual(slices.map((slice) => Math.round(slice.fraction * 1000) / 1000), [0.5, 0.3, 0.2])
  assert.equal(slices[0].start, 0)
  assert.ok(Math.abs(slices[0].end - Math.PI) < 1e-12, '一半 = 半圈')
  for (let index = 1; index < slices.length; index += 1) assert.equal(slices[index].start, slices[index - 1].end)
  assert.ok(Math.abs(slices.at(-1).end - Math.PI * 2) < 1e-12, '最后一个扇区收在整圈')
  assert.ok(Math.abs(slices[1].mid - (slices[1].start + slices[1].end) / 2) < 1e-12)
  assert.deepEqual(pieSlices([]), [])
  assert.deepEqual(pieSlices(null), [])
  assert.deepEqual(pieSlices([0, 0]), [])
  const dirty = pieSlices([10, -5, 'x', NaN, 30])
  assert.deepEqual(dirty.map((slice) => slice.fraction), [0.25, 0, 0, 0, 0.75], '负数、文字、NaN 当 0')
  assert.equal(pieSlices([7]).length, 1)
  assert.equal(pieSlices([7])[0].fraction, 1)
})

test('pieArc：扇区路径——四分之一、半圈、超过半圈用大弧、一整圈画成圆；没有 NaN', () => {
  const { pieArc } = loadClientHelpers({ functions: ['pieArc'] })
  assert.equal(pieArc(100, 100, 50, 0, Math.PI / 2), 'M 100 100 L 100 50 A 50 50 0 0 1 150 100 Z')
  assert.equal(pieArc(100, 100, 50, 0, Math.PI), 'M 100 100 L 100 50 A 50 50 0 0 1 100 150 Z')
  assert.equal(pieArc(100, 100, 50, 0, (Math.PI * 3) / 2), 'M 100 100 L 100 50 A 50 50 0 1 1 50 100 Z')
  assert.equal(pieArc(100, 100, 50, 0, Math.PI * 2), 'M 100 50 A 50 50 0 1 1 100 150 A 50 50 0 1 1 100 50 Z', '只有一个家族：整圆')
  for (const [start, end] of [[0, 0.001], [1, 2], [3, 6.2], [0, 6.283]]) assert.ok(!/NaN|Infinity/.test(pieArc(140, 120, 84, start, end)), `${start}-${end}`)
})

test('ringSegments：从 12 点钟顺时针排、段间留缝、首尾闭合；极小段按最短弧长画，不放大成大段；比例保留原值', () => {
  const { ringSegments } = loadClientHelpers({ functions: ['ringSegments', 'pieSlices', 'toNumber'] })
  const full = Math.PI * 2
  const gap = 0.04
  const min = 0.06
  const near = (a, b) => Math.abs(a - b) < 1e-9
  // 典型的 DeepSeek 构成：命中 96.6%，其余几项都很小
  const values = [9660, 310, 20, 10]
  const arcs = ringSegments(values, gap, min)
  assert.deepEqual(
    arcs.map((arc) => arc.fraction),
    values.map((value) => value / 10000),
    'fraction 是原始比例，不受最短弧长影响',
  )
  assert.ok(near(arcs[0].start, gap / 2), '第一段从 12 点钟右边半个缝开始')
  for (let index = 1; index < arcs.length; index += 1) assert.ok(near(arcs[index].start, arcs[index - 1].end + gap), `第 ${index} 段前面留一个缝`)
  assert.ok(near(arcs.at(-1).end + gap / 2, full), '最后一段收在 12 点钟左边半个缝')
  const span = (arc) => arc.end - arc.start
  assert.ok(near(span(arcs[2]), min) && near(span(arcs[3]), min), '0.2% / 0.1% 按最短弧长画')
  assert.ok(span(arcs[3]) / full < 0.01, '最短弧长不到一圈的 1%，不会把 0.1% 画成 20%')
  assert.ok(near(span(arcs[0]) / span(arcs[1]), 9660 / 310), '够长的段之间保持原比例')

  // 中间为 0 的项不画，也不占缝
  const holed = ringSegments([5, 0, 5], gap, min)
  assert.equal(holed[1].start, holed[1].end)
  assert.ok(near(holed[2].start, holed[0].end + gap))
  assert.ok(near(span(holed[0]), (full - 2 * gap) / 2))

  // 只有一段非零：整圈、不留缝；合计为 0 / 没有数据：没有分段
  assert.deepEqual(ringSegments([0, 7, 0], gap, min), [
    { fraction: 0, start: 0, end: 0 },
    { fraction: 1, start: 0, end: full },
    { fraction: 0, start: 0, end: 0 },
  ])
  assert.deepEqual(ringSegments([0, 0], gap, min), [])
  assert.deepEqual(ringSegments(null, gap, min), [])

  // 段很多、最短弧长放不下时按平均分，不出负数
  const crowded = ringSegments(Array.from({ length: 40 }, (_, index) => (index === 0 ? 1e9 : 1)), 0.1, 0.5)
  assert.ok(crowded.every((arc) => arc.end >= arc.start && Number.isFinite(arc.end)))
  assert.ok(crowded.at(-1).end <= full)
})

test('ringArc：环上的弧线路径——四分之一、超过半圈用大弧、一整圈画成两个半圆；没有 NaN', () => {
  const { ringArc } = loadClientHelpers({ functions: ['ringArc'] })
  assert.equal(ringArc(50, 50, 43, 0, Math.PI / 2), 'M 50 7 A 43 43 0 0 1 93 50')
  assert.equal(ringArc(50, 50, 43, 0, (Math.PI * 3) / 2), 'M 50 7 A 43 43 0 1 1 7 50')
  assert.equal(ringArc(50, 50, 43, 0, Math.PI * 2), 'M 50 7 A 43 43 0 1 1 50 93 A 43 43 0 1 1 50 7')
  for (const [start, end] of [[0, 0.001], [1, 2], [3, 6.2], [0.02, 6.26]]) assert.ok(!/NaN|Infinity/.test(ringArc(50, 50, 43, start, end)), `${start}-${end}`)
})

test('buildModelSeries：不同粒度窗口里模型的占比各算各的（窗口大了，早期的配比也算进来）', () => {
  const { buildModelSeries } = modelSeriesHelpers()
  const today = new Date(2026, 10, 4, 12)
  // 最近 7 天几乎全是 flash；更早的三周里 pro 很多
  const daily = [
    { date: '2026-11-03', tokens: 100, byModel: { 'deepseek-v4-1-flash': 95, 'deepseek-v4-pro': 5 } },
    { date: '2026-10-20', tokens: 100, byModel: { 'deepseek-v4-1-flash': 40, 'deepseek-v4-pro': 60 } },
  ]
  const share = (series, key) => {
    const item = series.series.find((entry) => entry.key === key)
    return item ? (item.total / series.total) * 100 : 0
  }
  const byDay = buildModelSeries(daily, 'day', today)
  const byWeek = buildModelSeries(daily, 'week', today)
  const proKey = byWeek.series.find((item) => item.name.includes('Pro')).key
  assert.equal(byDay.total, 100, '7 天窗口只含 11/3')
  assert.equal(byWeek.total, 200, '4 周窗口含两天')
  assert.ok(Math.abs(share(byDay, proKey) - 5) < 1e-9, `7 天：pro ${share(byDay, proKey)}%`)
  assert.ok(Math.abs(share(byWeek, proKey) - 32.5) < 1e-9, `4 周：pro ${share(byWeek, proKey)}%`)
})
