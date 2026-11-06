import assert from 'node:assert/strict'
import test from 'node:test'

import { loadClientHelpers, readClientSource } from './helpers/client-source.mjs'

/* 这些用例测的是 client.js 里的纯函数（数值格式、日期窗口、图表几何、Cache Lens 口径）。
 * 组件渲染由 profile-stats-verify/client-smoke.mjs 那套 smoke 覆盖，这里只管算得对不对。 */

const withLocale = { extraCode: ["const currentLocaleId = () => 'zh-CN'"] }

const lensHelpers = () => loadClientHelpers({ functions: ['deriveLens', 'cacheHitRate', 'toNumber'] })

test('deriveLens：四项互不重叠，直接取用；几行加起来等于总量', () => {
  const { deriveLens } = lensHelpers()
  const lens = deriveLens({ tokens: 2000, inputTokens: 900, outputTokens: 500, cacheReadTokens: 600, cacheWriteTokens: 0 })
  assert.equal(lens.cache, 600)
  assert.equal(lens.write, 0)
  assert.equal(lens.uncached, 900)
  assert.equal(lens.output, 500)
  assert.equal(lens.inputTotal, 1500)
  assert.equal(lens.partsTotal, 2000)
  assert.equal(lens.partsTotal, lens.total)
  assert.equal(lens.uncachedTotal, 1400)
  assert.equal(lens.hitRate, 40)
  assert.equal(Number(lens.uncachedShare.toFixed(4)), Number(((900 / 1400) * 100).toFixed(4)))
})

test('deriveLens：输入 ≥ 缓存时不再减掉缓存（旧算法在真实命中率 ≤ 50% 时算高，50% 直接跳成 100%）', () => {
  const { deriveLens } = lensHelpers()
  const half = deriveLens({ tokens: 2000, inputTokens: 1000, cacheReadTokens: 1000, outputTokens: 0 })
  assert.equal(half.uncached, 1000)
  assert.equal(half.hitRate, 50, '旧算法：未缓存 = 1000 − 1000 = 0 → 100%')
  const third = deriveLens({ tokens: 1500, inputTokens: 1000, cacheReadTokens: 500, outputTokens: 0 })
  assert.equal(Number(third.hitRate.toFixed(4)), Number(((500 / 1500) * 100).toFixed(4)), '旧算法给 50%')
  // 命中率随缓存连续变化，没有跳变
  const below = deriveLens({ tokens: 1999, inputTokens: 1000, cacheReadTokens: 999, outputTokens: 0 })
  assert.ok(Math.abs(below.hitRate - half.hitRate) < 0.1)
})

test('deriveLens：缓存写入不算命中，只进命中率的分母', () => {
  const { deriveLens } = lensHelpers()
  const lens = deriveLens({ tokens: 650, inputTokens: 400, outputTokens: 100, cacheReadTokens: 100, cacheWriteTokens: 50 })
  assert.equal(lens.cache, 100)
  assert.equal(lens.write, 50)
  assert.equal(lens.inputTotal, 550)
  assert.equal(lens.partsTotal, 650)
  assert.equal(lens.hitRate, (100 / 550) * 100)
  assert.equal(lens.uncachedTotal, 400 + 50 + 100, '放大视图：除了命中以外的全部')
})

test('deriveLens：不再从总量反推未缓存输入', () => {
  const { deriveLens } = lensHelpers()
  // 旧实现在 inputTokens 缺失时用「总量 − 缓存 − 输出」= 500
  const lens = deriveLens({ tokens: 1000, outputTokens: 200, cacheReadTokens: 300 })
  assert.equal(lens.uncached, 0)
  assert.equal(lens.total, 1000)
  assert.equal(lens.partsTotal, 500)
})

test('deriveLens / cacheHitRate：全零 / 空快照不产生 NaN；没有输入时命中率为 null', () => {
  const { deriveLens, cacheHitRate } = lensHelpers()
  for (const totals of [undefined, {}, { tokens: 0 }, { tokens: null, inputTokens: 'x' }, { inputTokens: -5, cacheReadTokens: -1 }]) {
    const lens = deriveLens(totals)
    for (const [key, value] of Object.entries(lens)) {
      assert.ok(Number.isFinite(value), `${key} 必须是有限数字，实际 ${value}`)
    }
    assert.equal(lens.hitRate, 0)
    assert.equal(lens.partsTotal, 0)
    assert.equal(lens.uncachedShare, 0)
  }
  assert.equal(cacheHitRate({}), null)
  assert.equal(cacheHitRate(undefined), null)
  assert.equal(cacheHitRate({ outputTokens: 100 }), null, '只有输出、没有输入')
  assert.equal(cacheHitRate({ inputTokens: 100 }), 0)
  assert.equal(cacheHitRate({ cacheReadTokens: 100 }), 100)
})

test('deriveLens：百分比列除以全部输入，命中 + 写入 + 未缓存输入恰好 100%', () => {
  const { deriveLens } = lensHelpers()
  const lens = deriveLens({ tokens: 1230, inputTokens: 400, outputTokens: 200, cacheReadTokens: 600, cacheWriteTokens: 30 })
  const percent = (value) => (value / lens.inputTotal) * 100
  assert.equal(Math.round((percent(lens.cache) + percent(lens.write) + percent(lens.uncached)) * 1e6) / 1e6, 100)
  assert.equal(percent(lens.cache), lens.hitRate)
})

test('tokenParts / formatTokens：中文单位按一位小数，亿 / 万不出现 10000.0 万', () => {
  const { tokenParts, formatTokens } = loadClientHelpers({
    ...withLocale,
    functions: ['toNumber', 'tokenParts', 'formatTokens'],
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

test('formatAxis：纵轴刻度去掉多余的 .0', () => {
  const { formatAxis } = loadClientHelpers({ ...withLocale, functions: ['toNumber', 'tokenParts', 'formatTokens', 'formatAxis'] })
  assert.equal(formatAxis(0), '0')
  assert.equal(formatAxis(1e8), '1 亿')
  assert.equal(formatAxis(2e4), '2 万')
  assert.equal(formatAxis(149490), '14.9 万')
  assert.equal(formatAxis(999), '999')
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

test('modelBucketFrames：日 / 周 / 月三档各 12 个桶，连续且本周（月）终点截到今天', () => {
  const { modelBucketFrames, modelBucketKeyOf, localDateKey, startOfWeek, startOfDay, addDays } = loadClientHelpers({
    extraCode: ['const MODEL_WINDOW = 12'],
    functions: ['modelBucketFrames', 'modelBucketKeyOf', 'localDateKey', 'startOfWeek', 'startOfDay', 'addDays', 'toNumber'],
  })

  // 选一个跨过夏令时切换的日期，周桶仍然逐周连续。
  const today = new Date(2026, 2, 20, 12)
  const todayStart = startOfDay(today)

  const days = modelBucketFrames('day', today)
  assert.equal(days.length, 12)
  assert.equal(days.at(-1).key, localDateKey(todayStart))
  for (let index = 1; index < days.length; index += 1) {
    assert.equal(days[index].key, localDateKey(addDays(todayStart, index - 11)))
  }

  const weeks = modelBucketFrames('week', today)
  assert.equal(weeks.length, 12)
  assert.equal(weeks.at(-1).start.getTime(), startOfWeek(todayStart).getTime())
  assert.equal(weeks.at(-1).end.getTime(), todayStart.getTime(), '本周截到今天')
  for (const frame of weeks) assert.equal(frame.start.getDay(), 1, `${frame.key} 必须是周一`)
  for (let index = 1; index < weeks.length; index += 1) {
    assert.equal(weeks[index].key, localDateKey(addDays(weeks[index - 1].start, 7)))
  }

  const months = modelBucketFrames('month', today)
  assert.equal(months.length, 12)
  assert.equal(months.at(-1).key, '2026-03')
  assert.equal(months.at(-1).end.getTime(), todayStart.getTime())
  assert.equal(months[0].key, '2025-04')
  for (const frame of months) assert.match(frame.key, /^\d{4}-\d{2}$/)

  // 任意日期归桶：周口径用周一，月口径用 YYYY-MM，日口径当天。
  const wednesday = new Date(2026, 2, 18, 12)
  assert.equal(modelBucketKeyOf(wednesday, 'week'), localDateKey(startOfWeek(wednesday)))
  assert.equal(modelBucketKeyOf(wednesday, 'month'), '2026-03')
  assert.equal(modelBucketKeyOf(wednesday, 'day'), '2026-03-18')
})

test('deriveKpis：五个指标 + 最近 14 天迷你柱（最后一根是今天）', () => {
  const { deriveKpis, localDateKey, addDays } = loadClientHelpers({
    extraCode: ['const SPARK_DAYS = 14'],
    functions: ['toNumber', 'deriveKpis', 'indexDaily', 'parseDateKey', 'localDateKey', 'addDays'],
  })
  const today = new Date(2026, 10, 6, 12)
  const todayKey = localDateKey(today)
  const yesterdayKey = localDateKey(addDays(today, -1))
  const snapshot = {
    totals: { tokens: 1234, longestTurnMs: 60000, longestStreak: 3, currentStreak: 2 },
    daily: [
      { date: todayKey, tokens: 42 },
      { date: yesterdayKey, tokens: 7 },
      { date: 'not-a-date', tokens: 999 },
    ],
  }
  const kpis = deriveKpis(snapshot, today)
  assert.equal(kpis.tokens, 1234)
  assert.equal(kpis.today, 42)
  assert.equal(kpis.longestTurnMs, 60000)
  assert.equal(kpis.longestStreak, 3)
  assert.equal(kpis.currentStreak, 2)
  assert.equal(kpis.spark.length, 14)
  assert.deepEqual(kpis.spark.at(-1), { key: todayKey, tokens: 42, today: true })
  assert.deepEqual(kpis.spark.at(-2), { key: yesterdayKey, tokens: 7, today: false })
  assert.equal(kpis.spark.filter((item) => item.today).length, 1)

  const empty = deriveKpis({}, today)
  assert.equal(empty.tokens, 0)
  assert.equal(empty.today, 0)
  assert.equal(empty.spark.length, 14)
  for (const item of empty.spark) assert.equal(item.tokens, 0)
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

test('granularitiesFor：每个范围的粒度选项固定，不随星期几 / 月初月末变化', () => {
  const { granularitiesFor } = loadClientHelpers({ functions: ['toNumber', 'granularitiesFor'] })
  assert.deepEqual(granularitiesFor('7d', 7), ['day'])
  assert.deepEqual(granularitiesFor('30d', 30), ['day', 'week'])
  assert.deepEqual(granularitiesFor('90d', 90), ['week', 'month'])
  // 累计：按数据跨度分档，第一项是默认
  assert.deepEqual(granularitiesFor('all', 10), ['day', 'week'])
  assert.deepEqual(granularitiesFor('all', 31), ['day', 'week'])
  assert.deepEqual(granularitiesFor('all', 82), ['week', 'month'])
  assert.deepEqual(granularitiesFor('all', 730), ['week', 'month'])
  assert.deepEqual(granularitiesFor('all', 731), ['month'])
  assert.deepEqual(granularitiesFor('all', 0), ['week', 'month'], '没有数据时按周 / 月画空图')
})

const modelSeriesHelpers = () =>
  loadClientHelpers({
    extraCode: [
      'const MODEL_WINDOW = 12',
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
      'buildModelSeries', 'modelBucketFrames', 'modelBucketKeyOf', 'calendarBucketCount', 'bucketTitle', 'indexDaily',
      'parseDateKey', 'localDateKey', 'startOfDay', 'startOfWeek', 'addDays', 'toNumber', 'niceScale', 'niceStep',
      'modelFamily', 'familyLabel', 'prettyModelName',
    ],
  })

test('buildModelSeries + 范围窗口：第一个桶截到窗口起点，总计恰好等于窗口内的日明细之和', () => {
  const { buildModelSeries, calendarBucketCount, bucketTitle, parseDateKey } = modelSeriesHelpers()
  const today = new Date(2026, 10, 4, 12) // 周三
  const window = { startKey: '2026-10-06', endKey: '2026-11-04' } // 近 30 天，起点是周二
  const daily = [
    { date: '2026-10-05', tokens: 999, byModel: { 'deepseek-v4-1-flash': 999 } }, // 窗口前一天：同一周，但不该算进来
    { date: '2026-10-06', tokens: 100, byModel: { 'deepseek-v4-1-flash': 100 } },
    { date: '2026-10-11', tokens: 50, byModel: { 'deepseek-v4-pro': 50 } },
    { date: '2026-11-04', tokens: 7, byModel: { 'deepseek-v4-1-flash': 7 } },
  ]
  const count = calendarBucketCount('week', parseDateKey(window.startKey), parseDateKey(window.endKey))
  assert.equal(count, 5, '10/5、10/12、10/19、10/26、11/2 五个自然周')
  const series = buildModelSeries(daily, 'week', today, count, window)
  assert.equal(series.buckets.length, 5)
  assert.equal(series.total, 157, '窗口外的 999 不进来')
  const first = series.buckets[0]
  assert.equal(first.key, '2026-10-05', '桶键仍是这一周的周一，和日明细的归桶方式一致')
  assert.equal(first.clipped, true)
  assert.equal(bucketTitle(first, 'week'), '2026-10-06~2026-10-11', '浮层只写真正包含的日期')
  assert.equal(first.total, 150)

  // 按月：第一个月截成 10/6 起
  const months = buildModelSeries(daily, 'month', today, calendarBucketCount('month', parseDateKey(window.startKey), today), window)
  assert.equal(months.buckets.length, 2)
  assert.equal(bucketTitle(months.buckets[0], 'month'), '2026-10-06~2026-10-31')
  assert.equal(months.total, 157)
})

test('bucketTitle：截断后只剩一天时写单个日期', () => {
  const { buildModelSeries, bucketTitle } = modelSeriesHelpers()
  const today = new Date(2026, 10, 6, 12) // 周五：近 90 天从 8/9（周日）开始
  const window = { startKey: '2026-08-09', endKey: '2026-11-06' }
  const series = buildModelSeries([{ date: '2026-08-09', tokens: 5, byModel: { x: 5 } }], 'week', today, 14, window)
  assert.equal(series.buckets[0].key, '2026-08-03')
  assert.equal(bucketTitle(series.buckets[0], 'week'), '2026-08-09', '不写「8/9 ~ 8/9」')
})

test('deltaWindows：本期已过完的天（不含今天）对上一期的前同样天数；累计没有上一期', () => {
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

test('client.js 里不能声明名为 window 的局部变量（会遮住全局对象：升级后 window.location.reload() 曾因此报错）', () => {
  const source = readClientSource()
  assert.equal(/\b(const|let|var)\s+window\b/.test(source), false)
})
