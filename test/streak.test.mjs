import assert from 'node:assert/strict'
import test from 'node:test'

import { computeStreaks } from '../index.js'

const localNoon = (year, month, day) => new Date(year, month - 1, day, 12, 0, 0, 0).getTime()
const NOW = localNoon(2026, 11, 6)

test('computeStreaks：没有活跃日', () => {
  assert.deepEqual(computeStreaks([], NOW), { longestStreak: 0, currentStreak: 0 })
})

test('computeStreaks：只有今天', () => {
  assert.deepEqual(computeStreaks(['2026-11-06'], NOW), { longestStreak: 1, currentStreak: 1 })
})

test('computeStreaks：今天 + 昨天算当前连续', () => {
  assert.deepEqual(computeStreaks(['2026-11-05', '2026-11-06'], NOW), { longestStreak: 2, currentStreak: 2 })
  assert.deepEqual(computeStreaks(['2026-11-06', '2026-11-05'], NOW), { longestStreak: 2, currentStreak: 2 }, '输入顺序不影响结果')
})

test('computeStreaks：今天没动但昨天动了，当前连续仍然成立（GitHub 口径）', () => {
  assert.deepEqual(computeStreaks(['2026-11-03', '2026-11-04', '2026-11-05'], NOW), { longestStreak: 3, currentStreak: 3 })
})

test('computeStreaks：昨天也没动，当前连续归零，但最长记录保留', () => {
  assert.deepEqual(computeStreaks(['2026-11-01', '2026-11-02', '2026-11-03'], NOW), { longestStreak: 3, currentStreak: 0 })
})

test('computeStreaks：最长段落出现在中间', () => {
  const days = ['2026-10-01', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-11-06']
  assert.deepEqual(computeStreaks(days, NOW), { longestStreak: 4, currentStreak: 1 })
})

test('computeStreaks：重复日期只算一天（去重后才不会把连续段落打断）', () => {
  assert.deepEqual(computeStreaks(['2026-11-04', '2026-11-05', '2026-11-05', '2026-11-06'], NOW), {
    longestStreak: 3,
    currentStreak: 3,
  })
  assert.deepEqual(computeStreaks(['2026-11-05', '2026-11-05', '2026-11-06', '2026-11-06'], NOW), {
    longestStreak: 2,
    currentStreak: 2,
  })
})

test('computeStreaks：跨月 / 跨年连续', () => {
  const monthEdge = ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']
  assert.deepEqual(computeStreaks(monthEdge, localNoon(2026, 11, 2)), { longestStreak: 4, currentStreak: 4 })
  const yearEdge = ['2026-12-30', '2026-12-31', '2027-01-01']
  assert.deepEqual(computeStreaks(yearEdge, localNoon(2027, 1, 1)), { longestStreak: 3, currentStreak: 3 })
})

test('computeStreaks：闰日算普通一天', () => {
  const days = ['2024-02-28', '2024-02-29', '2024-03-01']
  assert.deepEqual(computeStreaks(days, localNoon(2024, 3, 1)), { longestStreak: 3, currentStreak: 3 })
})

test('computeStreaks：跨夏令时切换日（本地日历口径，不按 24h 切分）', () => {
  // 美东 2026-03-08 只有 23 小时、11-01 有 25 小时；按日历减一天才不会断。
  const spring = ['2026-03-07', '2026-03-08', '2026-03-09']
  assert.deepEqual(computeStreaks(spring, localNoon(2026, 3, 9)), { longestStreak: 3, currentStreak: 3 })
  const autumn = ['2026-10-31', '2026-11-01', '2026-11-02']
  assert.deepEqual(computeStreaks(autumn, localNoon(2026, 11, 2)), { longestStreak: 3, currentStreak: 3 })
})

test('computeStreaks：一个月的完整连续', () => {
  const days = Array.from({ length: 30 }, (_, index) => {
    const date = new Date(2026, 9, index + 1, 12)
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  })
  assert.deepEqual(computeStreaks(days, localNoon(2026, 10, 30)).longestStreak, 30)
})
