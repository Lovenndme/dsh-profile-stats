import assert from 'node:assert/strict'
import test from 'node:test'

import { dayIndex, localDayKey, nextDayKey, shiftDayKey, toNumber } from '../index.js'

/** 本地时区的某天中午——用本地构造，所以断言在任何 TZ 下都成立。 */
const localNoon = (year, month, day) => new Date(year, month - 1, day, 12, 0, 0, 0).getTime()

test('toNumber 只认有限数字', () => {
  assert.equal(toNumber(12), 12)
  assert.equal(toNumber(0), 0)
  assert.equal(toNumber(-3.5), -3.5)
  assert.equal(toNumber(Number.NaN), 0)
  assert.equal(toNumber(Number.POSITIVE_INFINITY), 0)
  assert.equal(toNumber('42'), 0, '字符串不该被当成数字（上游字段可能被写成字符串）')
  assert.equal(toNumber(null), 0)
  assert.equal(toNumber(undefined), 0)
})

test('localDayKey 按本地时区取日历日', () => {
  assert.equal(localDayKey(localNoon(2026, 11, 6)), '2026-11-06')
  assert.equal(localDayKey(localNoon(2026, 1, 1)), '2026-01-01')
  // 本地零点与本地 23:59 必须是同一天：跨时区时 UTC 日期会差一天，这里锁死本地口径。
  assert.equal(localDayKey(new Date(2026, 5, 15, 0, 0, 0, 0).getTime()), '2026-06-15')
  assert.equal(localDayKey(new Date(2026, 5, 15, 23, 59, 59, 999).getTime()), '2026-06-15')
  assert.equal(localDayKey(Number.NaN), '')
})

test('dayIndex 是 UTC 零点毫秒', () => {
  assert.equal(dayIndex('1970-01-01'), 0)
  assert.equal(dayIndex('2026-11-06'), Date.UTC(2026, 10, 6))
})

test('dayIndex 拒绝非日历键（不静默归一化）', () => {
  assert.ok(Number.isNaN(dayIndex('')))
  assert.ok(Number.isNaN(dayIndex('2026-11')))
  assert.ok(Number.isNaN(dayIndex('2026-1-1')), '必须零填充：内部键永远是 YYYY-MM-DD')
  assert.ok(Number.isNaN(dayIndex('2026-13-01')), '13 月不该被 Date.UTC 归一化到次年 1 月')
  assert.ok(Number.isNaN(dayIndex('2026-02-30')), '2 月 30 日不该被归一化到 3 月')
  assert.ok(Number.isNaN(dayIndex('abcd-ef-gh')))
})

test('shiftDayKey 跨月 / 跨年 / 闰日', () => {
  assert.equal(nextDayKey('2026-11-06'), '2026-11-07')
  assert.equal(nextDayKey('2026-11-30'), '2026-12-01')
  assert.equal(nextDayKey('2026-12-31'), '2027-01-01')
  assert.equal(shiftDayKey('2027-01-01', -1), '2026-12-31')
  assert.equal(shiftDayKey('2026-03-01', -1), '2026-02-28')
  assert.equal(shiftDayKey('2024-03-01', -1), '2024-02-29', '闰年 2 月有 29 天')
  assert.equal(shiftDayKey('2026-11-06', 0), '2026-11-06')
  assert.equal(shiftDayKey('2026-11-06', 30), '2026-12-06')
  assert.equal(shiftDayKey('2026-11-06', -365), '2025-11-06')
})

test('shiftDayKey 对坏键返回空串而不是编一个日期', () => {
  assert.equal(shiftDayKey('', 1), '')
  assert.equal(shiftDayKey('2026-13-01', 1), '')
  assert.equal(shiftDayKey('not-a-day', -1), '')
})

test('shiftDayKey 不受运行时区影响（历史 bug：UTC− 时区下连续天数恒为 1）', () => {
  // 无论进程 TZ 是什么，+1 / −1 都必须恰好走一个日历日。
  for (const key of ['2026-01-01', '2026-03-08', '2026-06-30', '2026-11-01', '2026-12-31']) {
    assert.equal(shiftDayKey(shiftDayKey(key, 1), -1), key, key)
    assert.equal(shiftDayKey(key, 7), shiftDayKey(shiftDayKey(key, 6), 1))
  }
})
