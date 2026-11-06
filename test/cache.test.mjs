import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { CACHE_VERSION, foldSnapshot, readCache, writeCache } from '../index.js'
import { assistantEvent, withTemporaryHome } from './helpers/fake-host.mjs'

const cachePath = () => path.join(process.env.DSH_HOME, 'dsh-profile-stats', 'cache.json')

const foldOf = (id) =>
  foldSnapshot({
    session: { id },
    events: [assistantEvent({ seq: 0, time: new Date(2026, 10, 6, 12).getTime(), input: 10, output: 5 })],
  })

test('readCache：缓存目录不存在时返回空缓存', (t) => {
  withTemporaryHome(t)
  const cache = readCache()
  assert.deepEqual(cache, { version: CACHE_VERSION, generatedAt: 0, sessions: {}, complete: false })
})

test('writeCache → readCache 往返', (t) => {
  withTemporaryHome(t)
  const fold = foldOf('s1')
  writeCache({ version: CACHE_VERSION, generatedAt: 1234, sessions: { s1: fold }, complete: true })
  const cache = readCache()
  assert.equal(cache.generatedAt, 1234)
  assert.equal(cache.complete, true)
  assert.deepEqual(cache.sessions, { s1: fold })
  assert.ok(fs.existsSync(cachePath()), '缓存应落在 $DSH_HOME/dsh-profile-stats/cache.json')
})

test('readCache：版本号不一致整份丢弃（口径变了就重折）', (t) => {
  withTemporaryHome(t)
  fs.mkdirSync(path.dirname(cachePath()), { recursive: true })
  fs.writeFileSync(cachePath(), JSON.stringify({ version: CACHE_VERSION - 1, generatedAt: 9, sessions: { s1: foldOf('s1') }, complete: true }))
  const cache = readCache()
  assert.deepEqual(cache.sessions, {})
  assert.equal(cache.generatedAt, 0)
})

test('readCache：文件写坏 / 不是 JSON 时按空缓存处理', (t) => {
  withTemporaryHome(t)
  fs.mkdirSync(path.dirname(cachePath()), { recursive: true })
  for (const payload of ['', 'not json', 'null', '[]', '{"version":' + CACHE_VERSION + ',"sessions":"oops"}']) {
    fs.writeFileSync(cachePath(), payload)
    const cache = readCache()
    assert.deepEqual(cache.sessions, {}, `payload=${JSON.stringify(payload)}`)
    assert.equal(cache.version, CACHE_VERSION)
  }
})

test('readCache：sessions 为 null / 数组时不能把 null 交给 Object.keys', (t) => {
  withTemporaryHome(t)
  fs.mkdirSync(path.dirname(cachePath()), { recursive: true })
  for (const sessions of [null, [], 'x', 42]) {
    fs.writeFileSync(cachePath(), JSON.stringify({ version: CACHE_VERSION, generatedAt: 1, sessions, complete: true }))
    const cache = readCache()
    assert.deepEqual(cache.sessions, {}, `sessions=${JSON.stringify(sessions)}`)
  }
})

test('readCache：丢弃非对象的会话记录（手改坏一条不该拖垮整页）', (t) => {
  withTemporaryHome(t)
  fs.mkdirSync(path.dirname(cachePath()), { recursive: true })
  fs.writeFileSync(
    cachePath(),
    JSON.stringify({
      version: CACHE_VERSION,
      generatedAt: 7,
      sessions: { good: foldOf('good'), bad: null, alsoBad: 'nope', list: [1, 2] },
      complete: true,
    }),
  )
  const cache = readCache()
  assert.deepEqual(Object.keys(cache.sessions), ['good'])
  assert.equal(cache.generatedAt, 7)
})

test('readCache：complete 字段缺失视为完整，显式 false 保留（首扫被打断）', (t) => {
  withTemporaryHome(t)
  fs.mkdirSync(path.dirname(cachePath()), { recursive: true })
  fs.writeFileSync(cachePath(), JSON.stringify({ version: CACHE_VERSION, generatedAt: 1, sessions: {} }))
  assert.equal(readCache().complete, true)
  fs.writeFileSync(cachePath(), JSON.stringify({ version: CACHE_VERSION, generatedAt: 1, sessions: {}, complete: false }))
  assert.equal(readCache().complete, false)
})

test('writeCache：写入是原子替换，且不产生临时文件残留', (t) => {
  withTemporaryHome(t)
  writeCache({ version: CACHE_VERSION, generatedAt: 1, sessions: { s1: foldOf('s1') }, complete: true })
  writeCache({ version: CACHE_VERSION, generatedAt: 2, sessions: { s1: foldOf('s1') }, complete: true })
  const dir = path.dirname(cachePath())
  assert.deepEqual(fs.readdirSync(dir), ['cache.json'])
  assert.equal(readCache().generatedAt, 2)
})
