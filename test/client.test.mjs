import assert from 'node:assert/strict'
import test from 'node:test'

import { loadClientHelpers } from './helpers/client-source.mjs'

/* 这些用例测的是 client.js 里的纯函数（数值格式、日期窗口、图表几何、Cache Lens 口径）。
 * 组件渲染由 profile-stats-verify/client-smoke.mjs 那套 smoke 覆盖，这里只管算得对不对。 */

const withLocale = { extraCode: ["const currentLocaleId = () => 'zh-CN'"] }

test('deriveLens：缓存 / 未缓存输入 / 输出三段的派生口径', () => {
  const { deriveLens } = loadClientHelpers({ functions: ['deriveLens', 'toNumber'] })

  // 自洽数据：inputTokens 已包含缓存命中。
  const coherent = deriveLens({
    tokens: 2000,
    inputTokens: 1500,
    outputTokens: 500,
    cacheReadTokens: 600,
    cacheWriteTokens: 0,
  })
  assert.equal(coherent.cache, 600)
  assert.equal(coherent.uncached, 900)
  assert.equal(coherent.output, 500)
  assert.equal(coherent.inputTotal, 1500)
  assert.equal(coherent.partsTotal, 2000)
  assert.equal(coherent.uncachedTotal, 1400)
  assert.equal(coherent.hitRate, 40)
  assert.equal(Number(coherent.uncachedShare.toFixed(4)), Number(((900 / 1400) * 100).toFixed(4)))

  // cacheWrite 也要算进「缓存」。
  const withWrite = deriveLens({ tokens: 500, inputTokens: 400, outputTokens: 100, cacheReadTokens: 100, cacheWriteTokens: 50 })
  assert.equal(withWrite.cache, 150)
  assert.equal(withWrite.uncached, 250)
})

test('deriveLens：inputTokens 缺失时退回「总量 − 缓存 − 输出」', () => {
  const { deriveLens } = loadClientHelpers({ functions: ['deriveLens', 'toNumber'] })
  const lens = deriveLens({ tokens: 1000, outputTokens: 200, cacheReadTokens: 300 })
  assert.equal(lens.uncached, 500)
  assert.equal(lens.inputTotal, 800)
  assert.equal(lens.hitRate, Number(((300 / 800) * 100).toFixed(10)))
})

test('deriveLens：上游不自洽（input < cache）时未缓存输入不为负，也不再凭空造出 100%', () => {
  const { deriveLens } = loadClientHelpers({ functions: ['deriveLens', 'toNumber'] })
  const lens = deriveLens({ tokens: 700, inputTokens: 100, outputTokens: 0, cacheReadTokens: 600 })
  assert.equal(lens.uncached, 100, '未缓存输入被夹到 0 会让命中率变成假的 100%')
  assert.equal(lens.inputTotal, 700)
  assert.ok(lens.hitRate < 100, `命中率 ${lens.hitRate} 不该是 100%`)
  assert.ok(lens.hitRate >= 0)

  // 缓存 + 输出超过总量：三段仍按真实值，柱状条按自身合计归一。
  const overflow = deriveLens({ tokens: 500, inputTokens: 400, outputTokens: 300, cacheReadTokens: 400 })
  assert.equal(overflow.cache, 400)
  assert.equal(overflow.uncached, 0)
  assert.equal(overflow.output, 300)
  assert.equal(overflow.partsTotal, 700)
  assert.ok(overflow.partsTotal > overflow.total, '上游不自洽时三段合计可以大于总量，柱状条按自身合计铺满')
})

test('deriveLens：全零 / 空快照不产生 NaN', () => {
  const { deriveLens } = loadClientHelpers({ functions: ['deriveLens', 'toNumber'] })
  for (const totals of [undefined, {}, { tokens: 0 }, { tokens: null, inputTokens: 'x' }]) {
    const lens = deriveLens(totals)
    for (const [key, value] of Object.entries(lens)) {
      assert.ok(Number.isFinite(value), `${key} 必须是有限数字，实际 ${value}`)
    }
    assert.equal(lens.hitRate, 0)
    assert.equal(lens.partsTotal, 0)
    assert.equal(lens.uncachedShare, 0)
  }
})

test('deriveLens：输出被夹到总量以内，柱状条不会超过 100%', () => {
  const { deriveLens } = loadClientHelpers({ functions: ['deriveLens', 'toNumber'] })
  const lens = deriveLens({ tokens: 100, outputTokens: 500, inputTokens: 0, cacheReadTokens: 0 })
  assert.equal(lens.output, 100)
  assert.equal(lens.partsTotal, 100)
  assert.ok(lens.cache + lens.uncached === lens.inputTotal)
  assert.equal(lens.partsTotal, lens.inputTotal + lens.output)
})

test('deriveLens：百分比列统一除以输入，缓存 + 未缓存输入恰好 100%', () => {
  const { deriveLens } = loadClientHelpers({ functions: ['deriveLens', 'toNumber'] })
  const lens = deriveLens({ tokens: 1000, inputTokens: 800, outputTokens: 200, cacheReadTokens: 400 })
  const cachePercent = (lens.cache / lens.inputTotal) * 100
  const inputPercent = (lens.uncached / lens.inputTotal) * 100
  assert.equal(Math.round(cachePercent + inputPercent), 100)
  assert.equal(Math.round(cachePercent), Math.round(lens.hitRate))
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
    functions: ['modelBucketFrames', 'modelBucketKeyOf', 'localDateKey', 'startOfWeek', 'startOfDay', 'addDays'],
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

test('deriveProviders：按用量降序，前 6 个各一行，其余并成「其他」', () => {
  const { deriveProviders } = loadClientHelpers({ functions: ['toNumber', 'deriveProviders'] })

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
