import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { apply, createController, readCache } from '../index.js'
import {
  assistantEvent,
  createFakeHost,
  turnEndEvent,
  turnStartEvent,
  waitFor,
  withTemporaryHome,
} from './helpers/fake-host.mjs'

const SNAPSHOT = '/api/dsh-profile-stats/snapshot'
const REFRESH = '/api/dsh-profile-stats/refresh'
const UPDATE = '/api/dsh-profile-stats/update'
const ALIAS = '/api/dsh-profile-stats/alias'
const BILLING = '/api/dsh-profile-stats/billing'

const at = (month, day, hour = 12) => new Date(2026, month - 1, day, hour, 0, 0, 0).getTime()

function makeSessions() {
  return [
    {
      header: { id: 's1', createdAt: at(11, 5) },
      live: false,
      events: [
        assistantEvent({ seq: 0, time: at(11, 5), input: 100, output: 50, total: 150, provider: 'alpha', model: 'deepseek-v4-1-flash' }),
        turnStartEvent({ seq: 1, time: at(11, 5), turn: 't1' }),
        turnEndEvent({ seq: 2, time: at(11, 5) + 45000, turn: 't1' }),
      ],
    },
    {
      header: { id: 's2', createdAt: at(11, 6) },
      live: false,
      events: [
        assistantEvent({ seq: 0, time: at(11, 6), input: 150, output: 50, total: 200, provider: 'bravo', model: 'deepseek-v4-pro' }),
      ],
    },
  ]
}

async function boot(t, options = {}) {
  withTemporaryHome(t)
  const host = createFakeHost({ sessions: makeSessions(), ...options })
  const controller = createController(host.ctx)
  t.after(() => host.dispose())
  return { host, controller }
}

test('identity：profile.json 覆盖系统账户，坏文件 / 空字段回落到 os', async (t) => {
  withTemporaryHome(t)
  const dir = path.join(process.env.DSH_HOME, 'dsh-profile-stats')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'profile.json')
  const host = createFakeHost({ sessions: makeSessions() })
  t.after(() => host.dispose())
  const controller = createController(host.ctx)

  fs.writeFileSync(file, JSON.stringify({ name: '张三', handle: 'zhangsan', avatar: 'z' }))
  const full = controller.identity()
  assert.equal(full.name, '张三')
  assert.equal(full.handle, '@zhangsan', 'handle 缺 @ 时自动补上')
  assert.equal(full.avatar, 'Z', '头像取首字母大写')
  assert.equal(full.source, 'file')
  assert.equal(full.file, file)

  // 只覆盖一部分：其余字段各自回落
  fs.writeFileSync(file, JSON.stringify({ handle: '@someone' }))
  const partial = controller.identity()
  assert.equal(partial.handle, '@someone')
  assert.equal(partial.source, 'file')
  assert.ok(partial.name.length > 0, '没写 name 时用系统账户名')
  assert.equal(partial.avatar.length, 1)

  // 写坏的 JSON：当作没有覆盖，绝不抛错
  fs.writeFileSync(file, '{not json')
  const broken = controller.identity()
  assert.equal(broken.source, 'os')
  assert.ok(broken.handle.startsWith('@'))

  // 全是空字符串：同样当作没有覆盖
  fs.writeFileSync(file, JSON.stringify({ name: '   ', handle: '', avatar: '' }))
  assert.equal(controller.identity().source, 'os')
})

test('createController：一次扫描把会话折成快照，并落盘完整缓存', async (t) => {
  const { host, controller } = await boot(t)
  await controller.scan('test')

  assert.equal(controller.state.scanning, false)
  assert.ok(controller.state.generatedAt > 0)
  assert.equal(controller.state.cache.complete, true)
  assert.deepEqual(Object.keys(controller.state.cache.sessions).sort(), ['s1', 's2'])
  assert.deepEqual(host.reads, ['s1', 's2'])

  const body = controller.snapshotBody()
  assert.equal(body.ok, true)
  assert.equal(body.scanning, false)
  assert.equal(body.firstScan, false)
  assert.equal(body.failedSessions, 0)
  assert.equal(body.totals.tokens, 350)
  assert.equal(body.totals.calls, 2)
  assert.equal(body.totals.sessions, 2)
  assert.equal(body.totals.longestTurnMs, 45000)
  assert.equal(body.daily.length, 2)
  assert.match(body.update.installed, /^\d+\.\d+\.\d+/)

  const cache = readCache()
  assert.equal(cache.complete, true)
  assert.deepEqual(Object.keys(cache.sessions).sort(), ['s1', 's2'])

  const identity = controller.identity()
  assert.equal(typeof identity.name, 'string')
  assert.ok(identity.name.length > 0)
  assert.ok(identity.handle.startsWith('@'))
  assert.equal(identity.avatar.length, 1)
})

test('createController：第二次扫描只重读活着的会话，已落盘的会话不再读', async (t) => {
  const { host, controller } = await boot(t)
  await controller.scan('first')

  host.sessions[0].live = true
  host.sessions[0].events.push(
    assistantEvent({ seq: 3, time: at(11, 7), input: 60, output: 40, total: 100, provider: 'alpha', model: 'deepseek-v4-1-flash' }),
  )
  await controller.scan('second')

  assert.deepEqual(host.reads, ['s1', 's2', 's1'], '只有 live 的 s1 需要重读')
  assert.equal(controller.snapshotBody().totals.tokens, 450)
})

test('createController：会话被删掉后从缓存里剔除，总量同步下降', async (t) => {
  const { host, controller } = await boot(t)
  await controller.scan('first')
  assert.equal(controller.snapshotBody().totals.tokens, 350)

  host.setSessions(makeSessions().slice(1))
  await controller.scan('second')

  assert.deepEqual(Object.keys(controller.state.cache.sessions), ['s2'])
  const body = controller.snapshotBody()
  assert.equal(body.totals.tokens, 200)
  assert.equal(body.daily.length, 1)
  assert.equal(body.totals.sessions, 1)
})

test('createController：会话列表突然空了先不清缓存，持续一分钟还是空的才当真', async (t) => {
  const { host, controller } = await boot(t)
  await controller.scan('first')
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() })
  host.setSessions([])
  await controller.scan('blip')
  assert.deepEqual(Object.keys(controller.state.cache.sessions).sort(), ['s1', 's2'], '空一下多半是宿主还没准备好')
  assert.equal(controller.snapshotBody().totals.tokens, 350)
  // 恢复了：计时清零
  host.setSessions(makeSessions())
  await controller.scan('back')
  host.setSessions([])
  await controller.scan('empty-starts')
  t.mock.timers.tick(59000)
  await controller.scan('still-grace')
  assert.equal(Object.keys(controller.state.cache.sessions).length, 2)
  t.mock.timers.tick(2000)
  await controller.scan('really-empty')
  assert.equal(Object.keys(controller.state.cache.sessions).length, 0)
  t.mock.timers.tick(3000)
  assert.equal(controller.snapshotBody().totals.tokens, 0)
})

test('createController：扫描时还活着的会话结束后再读一次，补上最后一次扫描之后写下的那段', async (t) => {
  const sessions = makeSessions()
  sessions[0].live = true
  const { host, controller } = await boot(t, { sessions })
  await controller.scan('first')
  assert.equal(controller.snapshotBody().totals.tokens, 350)
  assert.equal(controller.state.cache.sessions.s1.live, true)

  // 两次扫描之间：又写了一步，然后会话结束
  host.sessions[0].events.push(assistantEvent({ seq: 3, time: at(11, 5, 13), input: 6000, output: 200, provider: 'alpha', model: 'deepseek-v4-1-flash' }))
  host.sessions[0].live = false
  host.reads.length = 0
  await controller.scan('ended')
  assert.deepEqual(host.reads, ['s1'], '结束后补读一次')
  assert.equal(controller.snapshotBody().totals.tokens, 6550)
  assert.equal(controller.state.cache.sessions.s1.live, false)

  // 之后不再重读，重启后也是完整的
  host.reads.length = 0
  await controller.scan('after')
  assert.deepEqual(host.reads, [])
  assert.equal(readCache().sessions.s1.tokens, 6350)
})

test('createController：删掉的坏会话不再一直算「读失败」', async (t) => {
  const sessions = makeSessions()
  sessions.push({ header: { id: 'broken', createdAt: at(11, 6) }, live: false, broken: true })
  const { host, controller } = await boot(t, { sessions })
  await controller.scan('first')
  assert.equal(controller.snapshotBody().failedSessions, 1)
  host.setSessions(makeSessions())
  await controller.scan('second')
  assert.equal(controller.snapshotBody().failedSessions, 0)
})

test('createController：会话 id 叫 __proto__、事件里有 __proto__ 供应商也不会改到对象原型', async (t) => {
  const sessions = makeSessions()
  sessions.push({ header: { id: '__proto__' }, live: false, events: [assistantEvent({ seq: 0, time: at(11, 6), input: 1, output: 1 })] })
  sessions.push({
    header: { id: 'p', cwd: '__proto__' },
    live: false,
    events: [assistantEvent({ seq: 0, time: at(11, 6), input: 100, output: 10, provider: '__proto__', model: '__proto__' })],
  })
  const { controller } = await boot(t, { sessions })
  await controller.scan('first')
  assert.equal({}.inputTokens, undefined)
  assert.equal(Object.getPrototypeOf(controller.state.cache.sessions), Object.prototype)
  const body = controller.snapshotBody()
  assert.equal(body.totals.tokens, 460, '__proto__ 会话跳过；__proto__ 供应商照常计数')
  assert.equal(body.totals.byProvider['(__proto__)'], 110)
})

test('createController：单个会话读失败不影响其它会话，且下次扫描会重试', async (t) => {
  const sessions = makeSessions()
  sessions.push({ header: { id: 'broken', createdAt: at(11, 6) }, live: false, broken: true })
  const { host, controller } = await boot(t, { sessions })

  await controller.scan('first')
  const body = controller.snapshotBody()
  assert.equal(body.failedSessions, 1)
  assert.equal(body.totals.tokens, 350, '坏掉的会话不参与聚合，其它会话照常')
  assert.deepEqual(Object.keys(controller.state.cache.sessions).sort(), ['s1', 's2'])

  host.reads.length = 0
  await controller.scan('second')
  assert.deepEqual(host.reads, ['broken'], '没有缓存记录的失败会话必须重试（而不是被当成已完成）')
})

test('createController：首次扫描中途暴露 firstScan + 进度，结束后归零', async (t) => {
  const { host, controller } = await boot(t)
  host.holdReads()
  const running = controller.scan('first')

  await waitFor(() => controller.state.scanning, { label: '进入扫描' })
  const during = controller.snapshotBody()
  assert.equal(during.scanning, true)
  assert.equal(during.firstScan, true, '缓存为空的首次扫描要让页面显示进度')
  assert.deepEqual(during.progress, { done: 0, total: 2 })

  host.releaseReads()
  await running

  const after = controller.snapshotBody()
  assert.equal(after.scanning, false)
  assert.equal(after.firstScan, false)
  assert.deepEqual(after.progress, { done: 0, total: 0 })
})

test('createController：并发调用 scan 只会真正扫一次', async (t) => {
  const { host, controller } = await boot(t)
  await Promise.all([controller.scan('a'), controller.scan('b'), controller.scan('c')])
  assert.deepEqual(host.reads, ['s1', 's2'])
})

test('createController：kick 的保鲜门禁（刚扫完不重复扫）', async (t) => {
  const { host, controller } = await boot(t)
  controller.kick('view')
  await waitFor(() => controller.state.generatedAt > 0, { label: '首次扫描完成' })
  assert.deepEqual(host.reads, ['s1', 's2'])

  for (const reason of ['forced', 'view', 'background']) {
    controller.kick(reason)
  }
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.deepEqual(host.reads, ['s1', 's2'], '刚扫过的快照不该被三个入口各重扫一次')
})

test('createController：缓存已存在时冷启动直接用缓存，不等扫描', async (t) => {
  const { controller } = await boot(t)
  await controller.scan('first')
  const scannedAt = controller.state.generatedAt

  // 再起一个控制器（模拟插件重启）：应当立刻能从缓存算出聚合。
  const second = createController(createFakeHost().ctx)
  const body = second.snapshotBody()
  assert.equal(body.generatedAt, scannedAt, '生成的时刻跟着缓存走，页面能判断数据新旧')
  assert.equal(body.totals.tokens, 350, '缓存里的折叠结果启动即可用，不依赖本次扫描')
  assert.equal(body.totals.sessions, 2)
})

test('createController：首次扫描被打断（complete=false）时重启立刻补扫并显示进度', async (t) => {
  const { host, controller } = await boot(t)
  await controller.scan('first')

  // 模拟「首扫写到一半就被关掉」：缓存里有部分会话，但显式标了 complete=false。
  const cacheFile = path.join(process.env.DSH_HOME, 'dsh-profile-stats', 'cache.json')
  const partial = JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
  partial.complete = false
  fs.writeFileSync(cacheFile, JSON.stringify(partial))

  const restartedHost = createFakeHost({ sessions: makeSessions() })
  t.after(() => restartedHost.dispose())
  const restarted = createController(restartedHost.ctx)
  assert.equal(restarted.state.cache.complete, false)
  restartedHost.holdReads()
  restarted.kick('view')
  await waitFor(() => restarted.state.scanning, { label: '不完整缓存立刻补扫' })
  assert.equal(restarted.snapshotBody().firstScan, true, '补扫期间页面要显示进度（数字还不完整）')
  restartedHost.releaseReads()
  await waitFor(() => !restarted.state.scanning && restarted.state.cache.complete === true, { label: '补扫完成' })
})

test('createController：listSessions 抛错时扫描不卡死，恢复后能继续用', async (t) => {
  const { host, controller } = await boot(t)
  const original = host.ctx.sessionQuery.listSessions
  const warnings = []
  const originalWarn = console.warn
  console.warn = (...args) => warnings.push(args.join(' '))
  t.after(() => {
    console.warn = originalWarn
  })

  host.ctx.sessionQuery.listSessions = async () => {
    throw new Error('listSessions boom')
  }
  await controller.scan('broken')
  assert.equal(controller.state.scanning, false)
  assert.equal(controller.state.inflight, null)
  assert.equal(controller.state.generatedAt, 0)
  assert.equal(controller.snapshotBody().ok, true, '扫描失败也要能回一份空快照，页面不能白屏')
  assert.equal(controller.snapshotBody().totals.tokens, 0)
  assert.ok(warnings.some((line) => line.includes('扫描失败')), '失败要留下日志')

  host.ctx.sessionQuery.listSessions = original
  await controller.scan('recover')
  assert.equal(controller.snapshotBody().totals.tokens, 350)
})

test('createController：缓存写不进去也照常出数（缓存只是加速层）', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dps-blocker-'))
  const blocker = path.join(dir, 'not-a-dir')
  fs.writeFileSync(blocker, 'x')
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = blocker
  const originalWarn = console.warn
  console.warn = () => {}
  t.after(() => {
    console.warn = originalWarn
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const host = createFakeHost({ sessions: makeSessions() })
  t.after(() => host.dispose())
  const controller = createController(host.ctx)
  await controller.scan('no-disk')

  assert.equal(controller.snapshotBody().totals.tokens, 350)
  assert.equal(controller.state.cache.complete, true, '内存里的缓存状态仍然完整，下次还能接着用')
})

test('createController：继承前缀的会话在扫描后按「原件是否还在」正确归类', async (t) => {
  const prefixEvents = [
    assistantEvent({ seq: 0, time: at(11, 1), input: 200, output: 100, total: 300, provider: 'alpha', model: 'deepseek-v4-1-flash' }),
  ]
  const sessions = [
    { header: { id: 'origin', createdAt: at(11, 1) }, live: false, events: prefixEvents },
    {
      header: { id: 'copy', createdAt: at(11, 2), parentSession: 'origin' },
      live: false,
      inheritedEventCount: 1,
      events: [
        ...prefixEvents,
        assistantEvent({ seq: 1, time: at(11, 2), input: 400, output: 100, total: 500, provider: 'bravo', model: 'deepseek-v4-pro' }),
      ],
    },
  ]
  const { controller } = await boot(t, { sessions })
  await controller.scan('first')
  const totals = controller.snapshotBody().totals
  assert.equal(totals.inheritedTokens, 300, '原件还在语料里 → 前缀只记账')
  assert.equal(totals.tokens, 800, '300（原件本体）+ 500（副本本体）')

  // 原件被删掉之后再扫：前缀必须补回总量，否则少算 300。
  const orphanHost = createFakeHost({ sessions: [sessions[1]] })
  const orphan = createController(orphanHost.ctx)
  await orphan.scan('orphan')
  const orphanTotals = orphan.snapshotBody().totals
  assert.equal(orphanTotals.tokens, 800)
  assert.equal(orphanTotals.orphanedTokens, 300)
  assert.equal(orphanTotals.orphanedSessions, 1)
})

test('apply：注册五条同源路由，方法不对返回 405', async (t) => {
  withTemporaryHome(t)
  const host = createFakeHost({ sessions: makeSessions() })
  apply(host.ctx)
  t.after(() => host.dispose())

  assert.deepEqual([...host.routes.keys()].sort(), [ALIAS, BILLING, REFRESH, SNAPSHOT, UPDATE].sort())
  assert.equal((await host.request(BILLING, 'GET')).json.error, 'method-not-allowed')
  assert.equal((await host.request(SNAPSHOT, 'POST')).json.error, 'method-not-allowed')
  assert.equal((await host.request(REFRESH, 'GET')).json.error, 'method-not-allowed')
  assert.equal((await host.request(UPDATE, 'GET')).json.error, 'method-not-allowed')
  assert.equal((await host.request(ALIAS, 'GET')).json.error, 'method-not-allowed')
  // HEAD 与 GET 同权（浏览器 / 探活脚本会发 HEAD）
  assert.equal((await host.request(SNAPSHOT, 'HEAD')).status, 200)
})

test('apply：GET 快照在扫描完成后给出完整数据，缓存落在 $DSH_HOME', async (t) => {
  withTemporaryHome(t)
  const host = createFakeHost({ sessions: makeSessions() })
  apply(host.ctx)
  t.after(() => host.dispose())

  const first = await host.request(SNAPSHOT, 'GET')
  assert.equal(first.status, 200)
  assert.match(first.headers['content-type'], /application\/json/)
  assert.equal(first.headers['cache-control'], 'no-cache')
  assert.match(first.headers.etag, /^"[\w-]+"$/)
  assert.equal(first.json.ok, true)

  // 首次 GET 会顺带在后台起一次扫描；等它落盘后再取一次快照。
  await waitFor(() => readCache().complete === true, { label: '缓存落盘' })
  const second = await host.request(SNAPSHOT, 'GET')
  assert.equal(second.json.totals.tokens, 350)
  assert.equal(second.json.scanning, false)
})

test('apply：POST /refresh 接受请求；/update 在没有 pluginManager 时安全拒绝', async (t) => {
  withTemporaryHome(t)
  const host = createFakeHost({ sessions: makeSessions() })
  apply(host.ctx)
  t.after(() => host.dispose())

  const refresh = await host.request(REFRESH, 'POST')
  assert.equal(refresh.status, 200)
  assert.equal(refresh.json.accepted, true)

  const update = await host.request(UPDATE, 'POST')
  assert.equal(update.status, 200)
  assert.deepEqual(update.json, { ok: false, error: 'manager-unavailable' })
})

test('apply：卸载时清掉定时器和路由（不留下后台扫描）', async (t) => {
  withTemporaryHome(t)
  const host = createFakeHost({ sessions: makeSessions() })
  apply(host.ctx)
  host.dispose()
  assert.equal(host.routes.size, 0)
  assert.equal(host.disposers.length, 0)
  await assert.rejects(() => host.request(SNAPSHOT, 'GET'), /route not registered/)
})

/* ------------------------------------------------------------ 一键升级（假 registry） */

function fakeManager(overrides = {}) {
  const calls = { remove: 0, install: [] }
  const manager = {
    async listBundles() {
      return [{ name: 'dsh-profile-stats', version: '0.0.1', source: 'dsh-profile-stats', installed: true }]
    },
    async removeBundle(name) {
      calls.remove += 1
      return { application: 'applied', name }
    },
    async installBundle(spec, options) {
      calls.install.push({ spec, options })
      return { application: 'applied', version: '9.9.9' }
    },
    ...overrides,
  }
  return { manager, calls }
}

function stubRegistry(version, { ok = true } = {}) {
  const previous = globalThis.fetch
  globalThis.fetch = async () => {
    if (!ok) throw new Error('network down')
    return { ok: true, async json() { return { version } } }
  }
  return () => {
    globalThis.fetch = previous
  }
}

test('update：registry 有新版时 /update 完成 remove → install，并写结果文件', async (t) => {
  const { manager, calls } = fakeManager()
  const host = createFakeHost({ sessions: makeSessions(), services: { pluginManager: manager } })
  withTemporaryHome(t)
  t.after(() => host.dispose())
  const controller = createController(host.ctx)

  const restore = stubRegistry('9.9.9')
  t.after(restore)
  await controller.refreshUpdateInfo(true)

  const info = controller.updateInfo()
  assert.equal(info.latest, '9.9.9')
  assert.equal(info.installed, '0.0.1')
  assert.equal(info.canUpdate, true)
  assert.equal(info.available, true)

  assert.deepEqual(controller.startUpdate(), { ok: true, target: '9.9.9' })
  // 防重入
  assert.equal(controller.startUpdate().error, 'in-progress')

  await waitFor(() => fs.existsSync(path.join(process.env.DSH_HOME, 'dsh-profile-stats', 'update.json')), {
    label: '升级结果落盘',
  })
  const result = JSON.parse(fs.readFileSync(path.join(process.env.DSH_HOME, 'dsh-profile-stats', 'update.json'), 'utf8'))
  assert.equal(result.ok, true)
  assert.equal(result.target, '9.9.9')
  assert.equal(result.from, '0.0.1')
  assert.equal(result.step, 'install')
  assert.equal(calls.remove, 1)
  assert.equal(calls.install.length, 1)
  assert.equal(calls.install[0].spec, 'dsh-profile-stats@9.9.9')
  assert.equal(calls.install[0].options.saveExact, true)
  assert.equal(calls.install[0].options.enabled, true)
})

test('update：安装失败后写失败结果并放开重入锁（不能卡在 running 上）', async (t) => {
  const { manager } = fakeManager({
    async installBundle() {
      throw new Error('registry 502')
    },
  })
  const host = createFakeHost({ sessions: makeSessions(), services: { pluginManager: manager } })
  withTemporaryHome(t)
  t.after(() => host.dispose())
  const controller = createController(host.ctx)

  const restore = stubRegistry('9.9.9')
  t.after(restore)
  await controller.refreshUpdateInfo(true)

  assert.equal(controller.startUpdate().ok, true)
  const resultFile = path.join(process.env.DSH_HOME, 'dsh-profile-stats', 'update.json')
  await waitFor(() => fs.existsSync(resultFile), { label: '失败结果落盘' })
  await waitFor(() => controller.updateInfo().running === false, { label: 'running 复位' })

  const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'))
  assert.equal(result.ok, false)
  assert.match(result.error, /registry 502/)
  assert.equal(controller.updateInfo().available, true, '失败后仍应显示「有新版」，让用户能再试一次')
})

test('update：非 registry 安装 / 没有新版 / registry 不可达都不升级', async (t) => {
  const linkManager = fakeManager({
    async listBundles() {
      return [{ name: 'dsh-profile-stats', version: '0.0.1', source: 'link:C:\\dev\\dsh-profile-stats', installed: true }]
    },
  })
  const host = createFakeHost({ sessions: makeSessions(), services: { pluginManager: linkManager.manager } })
  withTemporaryHome(t)
  t.after(() => host.dispose())
  const controller = createController(host.ctx)

  const restore = stubRegistry('9.9.9')
  t.after(restore)
  await controller.refreshUpdateInfo(true)
  assert.equal(controller.updateInfo().canUpdate, false)
  assert.equal(controller.updateInfo().available, false)
  assert.deepEqual(controller.startUpdate(), { ok: false, error: 'not-registry-install' })

  // registry 不可达：不炸，保持「没有新版」。
  const broken = fakeManager()
  const host2 = createFakeHost({ sessions: [], services: { pluginManager: broken.manager } })
  t.after(() => host2.dispose())
  const controller2 = createController(host2.ctx)
  const restore2 = stubRegistry('0.0.0', { ok: false })
  t.after(restore2)
  await controller2.refreshUpdateInfo(true)
  assert.equal(controller2.updateInfo().latest, '')
  assert.equal(controller2.updateInfo().available, false)
  assert.deepEqual(controller2.startUpdate(), { ok: false, error: 'no-target' })
})

test('update：6 小时内不重复问 registry（打开面板不该每次都联网）', async (t) => {
  const { manager } = fakeManager()
  const host = createFakeHost({ sessions: makeSessions(), services: { pluginManager: manager } })
  withTemporaryHome(t)
  t.after(() => host.dispose())
  const controller = createController(host.ctx)

  let calls = 0
  const previousFetch = globalThis.fetch
  globalThis.fetch = async () => {
    calls += 1
    return { ok: true, async json() { return { version: '9.9.9' } } }
  }
  t.after(() => {
    globalThis.fetch = previousFetch
  })

  await controller.refreshUpdateInfo(false)
  assert.equal(calls, 1)
  await controller.refreshUpdateInfo(false)
  assert.equal(calls, 1, 'TTL 内不再问 registry')
  await controller.refreshUpdateInfo(true)
  assert.equal(calls, 2, 'force 才再问一次')
  assert.equal(controller.updateInfo().latest, '9.9.9')
})

test('改名接口：名字存在本机 aliases.json，快照带出来；名字留空就删掉，坏请求不写文件', async (t) => {
  const home = withTemporaryHome(t)
  const host = createFakeHost({ sessions: makeSessions() })
  apply(host.ctx)
  t.after(() => host.dispose())
  const file = path.join(home, 'dsh-profile-stats', 'aliases.json')

  const saved = await host.request(ALIAS, 'POST', { provider: 'relay-x', name: '  实验中转  ' })
  assert.equal(saved.status, 200)
  assert.deepEqual(saved.json, { ok: true, aliases: { providers: { 'relay-x': '实验中转' } } })
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { providers: { 'relay-x': '实验中转' } })
  assert.deepEqual((await host.request(SNAPSHOT, 'GET')).json.aliases, { providers: { 'relay-x': '实验中转' } })

  // 超过 40 个字截断
  const long = await host.request(ALIAS, 'POST', { provider: 'beta', name: 'x'.repeat(60) })
  assert.equal(long.json.aliases.providers.beta.length, 40)

  // 名字留空 = 删掉，回到原始 id
  const cleared = await host.request(ALIAS, 'POST', { provider: 'relay-x', name: '' })
  assert.deepEqual(cleared.json.aliases.providers, { beta: 'x'.repeat(40) })

  // 坏请求：不是 JSON / 没有 provider / 名字不是字符串 / 请求体太大
  assert.equal((await host.request(ALIAS, 'POST', '{not json')).status, 400)
  assert.equal((await host.request(ALIAS, 'POST', { name: 'x' })).json.error, 'invalid-provider')
  assert.equal((await host.request(ALIAS, 'POST', { provider: 'a', name: 42 })).json.error, 'invalid-name')
  assert.equal((await host.request(ALIAS, 'POST', { provider: 'a', name: 'y'.repeat(20000) })).status, 413)
  // 字段拼错（没带 name）不能当成「删掉」；__proto__ 不能当 id
  assert.equal((await host.request(ALIAS, 'POST', { provider: 'beta', nmae: 'x' })).json.error, 'invalid-name')
  assert.equal((await host.request(ALIAS, 'POST', { provider: '__proto__', name: 'x' })).json.error, 'invalid-provider')
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { providers: { beta: 'x'.repeat(40) } })
  // 按字符截断，不把 emoji 切成半个
  const emoji = await host.request(ALIAS, 'POST', { provider: 'gamma', name: `${'a'.repeat(39)}\u{1F600}\u{1F600}` })
  assert.equal(emoji.json.aliases.providers.gamma, `${'a'.repeat(39)}\u{1F600}`)
})

test('POST 只接受同源请求；带请求体的只接受 JSON', async (t) => {
  const home = withTemporaryHome(t)
  const host = createFakeHost({ sessions: makeSessions() })
  apply(host.ctx)
  t.after(() => host.dispose())
  const file = path.join(home, 'dsh-profile-stats', 'billing.json')
  const body = { provider: 'relay-x', billing: { mode: 'free' } }
  const crossSite = { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example', host: '127.0.0.1:4100' }
  for (const route of [BILLING, ALIAS, REFRESH, UPDATE]) {
    const response = await host.request(route, 'POST', body, crossSite)
    assert.equal(response.status, 403, route)
    assert.equal(response.json.error, 'cross-origin')
  }
  // 没有 Sec-Fetch-Site 的老浏览器：看 Origin 和 Host
  assert.equal((await host.request(BILLING, 'POST', body, { origin: 'https://evil.example', host: '127.0.0.1:4100' })).status, 403)
  assert.equal((await host.request(BILLING, 'POST', body, { origin: 'null', host: '127.0.0.1:4100' })).status, 403)
  // 跨站表单发得出的 text/plain 不收
  assert.equal((await host.request(BILLING, 'POST', JSON.stringify(body), { 'content-type': 'text/plain' })).status, 415)
  assert.equal(fs.existsSync(file), false, '上面这些都不能写文件')
  // 同源（页面自己）照常
  assert.equal((await host.request(BILLING, 'POST', body, { 'sec-fetch-site': 'same-origin' })).status, 200)
  assert.equal((await host.request(BILLING, 'POST', body, { origin: 'http://127.0.0.1:4100', host: '127.0.0.1:4100' })).status, 200)
  assert.equal((await host.request(REFRESH, 'POST', undefined, { 'sec-fetch-site': 'same-origin' })).status, 200)
})

test('快照：带 ETag，内容没变时回 304；slots 里的名字换成编号，对照表在 slotKeys', async (t) => {
  withTemporaryHome(t)
  const sessions = makeSessions()
  sessions[0].header.cwd = 'C:\\code\\atlas'
  const host = createFakeHost({ sessions })
  const controller = createController(host.ctx)
  t.after(() => host.dispose())
  await controller.scan('first')
  const body = controller.snapshotBody()
  assert.deepEqual(body.slotKeys, { providers: ['alpha', 'bravo'], models: ['deepseek-v4-1-flash', 'deepseek-v4-pro'], projects: ['c:/code/atlas', ''] })
  const decoded = body.daily.flatMap((entry) => entry.slots.map(([hour, p, m, project, ...parts]) => [hour, body.slotKeys.providers[p], body.slotKeys.models[m], body.slotKeys.projects[project], ...parts]))
  assert.deepEqual(decoded.map((row) => row.slice(1, 4)), [['alpha', 'deepseek-v4-1-flash', 'c:/code/atlas'], ['bravo', 'deepseek-v4-pro', '']])
  assert.ok(controller.snapshotBody().daily === body.daily, '聚合没变就不重新编码')

  apply(host.ctx)
  await waitFor(async () => (await host.request(SNAPSHOT, 'GET')).json.totals.tokens === 350, { label: '扫描完成' })
  const first = await host.request(SNAPSHOT, 'GET')
  const again = await host.request(SNAPSHOT, 'GET', undefined, { 'if-none-match': first.headers.etag })
  assert.equal(again.status, 304)
  assert.equal(again.body, '')
  assert.equal(again.headers.etag, first.headers.etag)
  const stale = await host.request(SNAPSHOT, 'GET', undefined, { 'if-none-match': '"old"' })
  assert.equal(stale.status, 200)
  assert.equal(stale.json.ok, true)
})

test('aliases.json 被手改坏也不影响快照：非对象、非字符串、空名字都被丢掉', async (t) => {
  const home = withTemporaryHome(t)
  fs.mkdirSync(path.join(home, 'dsh-profile-stats'), { recursive: true })
  fs.writeFileSync(path.join(home, 'dsh-profile-stats', 'aliases.json'), JSON.stringify({ providers: { a: 'A', b: 7, c: '   ', '': 'x' } }))
  const host = createFakeHost({ sessions: makeSessions() })
  apply(host.ctx)
  t.after(() => host.dispose())
  assert.deepEqual((await host.request(SNAPSHOT, 'GET')).json.aliases, { providers: { a: 'A' } })
  fs.writeFileSync(path.join(home, 'dsh-profile-stats', 'aliases.json'), '{broken')
  assert.deepEqual((await host.request(SNAPSHOT, 'GET')).json.aliases, { providers: {} })
})

test('计费接口：每家的计费方式存在本机 billing.json，快照带出来；null 删掉；不认识的写法被拒', async (t) => {
  const home = withTemporaryHome(t)
  const host = createFakeHost({ sessions: makeSessions() })
  apply(host.ctx)
  t.after(() => host.dispose())
  const file = path.join(home, 'dsh-profile-stats', 'billing.json')

  const multiplier = await host.request(BILLING, 'POST', { provider: 'relay-x', billing: { mode: 'multiplier', factor: 0.12, extra: 'ignored' } })
  assert.equal(multiplier.status, 200)
  assert.deepEqual(multiplier.json.billing.providers, { 'relay-x': { mode: 'multiplier', factor: 0.12 } })
  await host.request(BILLING, 'POST', { provider: 'plan-x', billing: { mode: 'plan', monthly: 199, since: '2026-10-20' } })
  await host.request(BILLING, 'POST', { provider: 'work', billing: { mode: 'free' } })
  assert.deepEqual((await host.request(SNAPSHOT, 'GET')).json.billing.providers, {
    'relay-x': { mode: 'multiplier', factor: 0.12 },
    'plan-x': { mode: 'plan', monthly: 199, since: '2026-10-20' },
    work: { mode: 'free' },
  })

  // null = 回到默认
  const cleared = await host.request(BILLING, 'POST', { provider: 'work', billing: null })
  assert.equal(cleared.json.billing.providers.work, undefined)

  // 坏请求不写文件
  const before = fs.readFileSync(file, 'utf8')
  assert.equal((await host.request(BILLING, 'POST', { provider: 'a', billing: { mode: 'magic' } })).json.error, 'invalid-billing')
  // 早期版本的「自定义单价」已经去掉
  assert.equal((await host.request(BILLING, 'POST', { provider: 'a', billing: { mode: 'custom', miss: 2, hit: 0.2, output: 8 } })).json.error, 'invalid-billing')
  assert.equal((await host.request(BILLING, 'POST', { provider: 'a', billing: { mode: 'multiplier', factor: -1 } })).json.error, 'invalid-billing')
  assert.equal((await host.request(BILLING, 'POST', { provider: 'a', billing: { mode: 'plan', monthly: 'x' } })).json.error, 'invalid-billing')
  assert.equal((await host.request(BILLING, 'POST', { billing: { mode: 'free' } })).json.error, 'invalid-provider')
  assert.equal((await host.request(BILLING, 'POST', '{oops')).status, 400)
  // 字段拼错（没带 billing）不能当成「删掉」
  assert.equal((await host.request(BILLING, 'POST', { provider: 'relay-x', biling: { mode: 'free' } })).json.error, 'invalid-billing')
  // 包月起始日：不存在的日子、离谱的年份都拒绝
  for (const since of ['2026-02-31', '2026-13-01', '0202-06-01', '0000-00-00', 'yesterday']) {
    assert.equal((await host.request(BILLING, 'POST', { provider: 'p', billing: { mode: 'plan', monthly: 99, since } })).json.error, 'invalid-since', since)
  }
  // 超过上限的月费、倍数
  assert.equal((await host.request(BILLING, 'POST', { provider: 'p', billing: { mode: 'plan', monthly: 100001 } })).json.error, 'invalid-billing')
  assert.equal((await host.request(BILLING, 'POST', { provider: 'p', billing: { mode: 'multiplier', factor: 101 } })).json.error, 'invalid-billing')
  assert.equal((await host.request(BILLING, 'POST', { provider: '__proto__', billing: { mode: 'free' } })).json.error, 'invalid-provider')
  assert.equal(fs.readFileSync(file, 'utf8'), before)
  assert.equal(JSON.parse(before).providers['relay-x'].mode, 'multiplier')
})

test('billing.json 被手改坏也不影响快照：只留合法条目', async (t) => {
  const home = withTemporaryHome(t)
  fs.mkdirSync(path.join(home, 'dsh-profile-stats'), { recursive: true })
  fs.writeFileSync(
    path.join(home, 'dsh-profile-stats', 'billing.json'),
    JSON.stringify({ providers: { a: { mode: 'free' }, b: { mode: 'multiplier' }, c: 'x', d: { mode: 'plan', monthly: 10, since: 'yesterday' }, e: { mode: 'custom', miss: 2, hit: 0.2, output: 8 } } }),
  )
  const host = createFakeHost({ sessions: makeSessions() })
  apply(host.ctx)
  t.after(() => host.dispose())
  assert.deepEqual((await host.request(SNAPSHOT, 'GET')).json.billing.providers, { a: { mode: 'free' }, d: { mode: 'plan', monthly: 10 } })
})

test('汇率：billing.json 里手写的 usdCny 随快照带出，不合理的值丢掉；改计费方式时保留它；接口不能改汇率', async (t) => {
  const home = withTemporaryHome(t)
  const file = path.join(home, 'dsh-profile-stats', 'billing.json')
  const host = createFakeHost({ sessions: makeSessions() })
  apply(host.ctx)
  t.after(() => host.dispose())
  const snapshot = (await host.request(SNAPSHOT, 'GET')).json
  assert.equal(snapshot.billing.usdCny, undefined)
  assert.equal(snapshot.prices.defaultUsdCny, 6.7168, '默认值：中国外汇交易中心 2026-11-06 中间价')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  for (const [rate, expected] of [[7.2, 7.2], [0, undefined], ['x', undefined], [1000, undefined]]) {
    fs.writeFileSync(file, JSON.stringify({ usdCny: rate, providers: {} }))
    assert.equal((await host.request(SNAPSHOT, 'GET')).json.billing.usdCny, expected, String(rate))
  }
  fs.writeFileSync(file, JSON.stringify({ usdCny: 7.2, providers: {} }))
  assert.equal((await host.request(BILLING, 'POST', { provider: 'relay-x', billing: { mode: 'free' } })).json.billing.usdCny, 7.2)
  assert.equal((await host.request(BILLING, 'POST', { usdCny: 8 })).json.error, 'invalid-provider')
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).usdCny, 7.2)
})

test('价格表：快照只带用到的模型；名字带 -thinking / -high 之类后缀时退回基础模型；找不到的不带', async (t) => {
  withTemporaryHome(t)
  const { priceRowOf, pricesFor } = await import('../index.js')
  const table = { fetchedAt: '2026-11-09', models: { 'claude-sonnet-5-5': [2, 10, 0.1, 2.5], 'gpt-6-astra': [10, 50, 1, null], broken: ['x', 1] } }
  assert.deepEqual(priceRowOf('claude-sonnet-5-5', table), [2, 10, 0.1, 2.5])
  assert.deepEqual(priceRowOf('claude-sonnet-5-5-thinking', table), [2, 10, 0.1, 2.5])
  assert.deepEqual(priceRowOf('gpt-6-astra-high', table), [10, 50, 1, null])
  assert.equal(priceRowOf('gpt-6-astra-turbo', table), null, '不认识的后缀不乱猜')
  assert.equal(priceRowOf('broken', table), null)
  assert.equal(priceRowOf('nobody', table), null)
  // 上游还没定价的占位行（输入输出都是 0、缓存是 null）当未定价；四项全 0 才是官方标明的免费
  const zeros = { models: { placeholder: [0, 0, null, null], free: [0, 0, 0, 0], 'claude-opus-4-6': [5, 25, 0.5, 6.25] } }
  assert.equal(priceRowOf('placeholder', zeros), null)
  assert.deepEqual(priceRowOf('free', zeros), [0, 0, 0, 0])
  // -fast / -free 是另一档价格，不退回基础模型
  assert.equal(priceRowOf('claude-opus-4-6-fast', zeros), null)
  assert.equal(priceRowOf('claude-opus-4-6-free', zeros), null)
  assert.equal(priceRowOf('constructor', zeros), null, '原型上的名字不算价格表里的模型')
  const daily = [{ slots: [[1, 'p', 'claude-sonnet-5-5-thinking', '', 1, 0, 0, 0], [1, 'p', 'nobody', '', 1, 0, 0, 0]] }]
  assert.deepEqual(pricesFor(daily, table).models, { 'claude-sonnet-5-5-thinking': [2, 10, 0.1, 2.5] })

  // 随包的 prices.json：常见的几家都在
  const real = JSON.parse(fs.readFileSync(new URL('../prices.json', import.meta.url), 'utf8'))
  for (const id of ['claude-sonnet-5-5', 'claude-opus-5-5', 'gpt-6-astra', 'gemini-3-1-pro', 'kimi-k3', 'glm-5-2', 'qwen-max']) {
    assert.ok(Array.isArray(real.models[id]), `${id} 应该在 prices.json 里`)
  }
  assert.match(real.license, /MIT/)
  for (const [id, row] of Object.entries(real.models)) {
    assert.ok(row[0] > 0 || row[1] > 0 || (row[2] === 0 && row[3] === 0), `${id}：不能有输入输出都是 0 的占位行`)
  }
})
