/**
 * 测试用的假宿主：只实现插件真正用到的那几条 Cordis API。
 *
 *   ctx.webServer.register({ kind, path, handler })   捕获路由，测试里直接发假请求
 *   ctx.sessionQuery.listSessions() / readSession(id) 用内存里的会话日志代替磁盘
 *   ctx.effect(fn)                                    记录清理函数，测试结束必须调用（否则 60s 定时器吊住进程）
 *   ctx.get(name)                                     可选服务（pluginManager 等），默认没有
 *
 * 会话数据用「会话对象」描述，和真实 `readSession` 的返回结构保持一致：
 *   { header: { id, createdAt, parentSession }, live, inheritedEventCount, events }
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function assistantEvent({ seq, time, input = 0, output = 0, cacheRead = 0, cacheWrite = 0, total, model, provider, usage = true }) {
  const event = { seq, time, type: 'assistant/message', data: { message: { role: 'assistant', source: {} } } }
  if (usage) {
    event.data.usage = {
      inputTokens: input,
      outputTokens: output,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
    }
    if (total !== undefined) event.data.usage.totalTokens = total
  }
  if (model !== undefined) event.data.message.source.model = model
  if (provider !== undefined) event.data.message.source.provider = provider
  return event
}

export function turnStartEvent({ seq, time, turn }) {
  return { seq, time, type: 'turn/start', data: { turn } }
}

export function turnEndEvent({ seq, time, turn }) {
  return { seq, time, type: 'turn/end', data: { turn } }
}

export function createFakeHost({ sessions = [], services = {} } = {}) {
  const routes = new Map()
  const disposers = []
  const reads = []
  const warns = []
  let holds = []
  let holding = false

  const findSession = (id) => sessions.find((session) => String(session.header.id) === String(id))

  const ctx = {
    effect(fn) {
      const dispose = fn()
      if (typeof dispose === 'function') disposers.push(dispose)
      return dispose
    },
    webServer: {
      register({ path, handler }) {
        routes.set(path, handler)
        return () => routes.delete(path)
      },
    },
    sessionQuery: {
      async listSessions() {
        return sessions.map((session) => ({ header: session.header, live: Boolean(session.live) }))
      },
      async readSession(id) {
        reads.push(String(id))
        if (holding) {
          await new Promise((resolve) => holds.push(resolve))
        }
        const session = findSession(id)
        if (!session) throw new Error(`session not found: ${id}`)
        if (session.broken) throw new Error(session.broken === true ? 'simulated read failure' : String(session.broken))
        return {
          session: session.header,
          inheritedEventCount: session.inheritedEventCount || 0,
          events: session.events || [],
        }
      },
    },
    get(name) {
      return services[name]
    },
  }

  /**
   * body：字符串（原样作为请求体）或对象（转成 JSON）；请求对象和 Node 的一样可以 for await 读取。
   * extraHeaders：额外的请求头（小写键），会覆盖默认的 content-type。
   */
  const request = async (path, method = 'GET', body, extraHeaders = {}) => {
    const handler = routes.get(path)
    if (!handler) throw new Error(`route not registered: ${path}`)
    const headers = {}
    let statusCode = 200
    let responseBody = ''
    await new Promise((resolve, reject) => {
      const res = {
        set statusCode(value) {
          statusCode = value
        },
        get statusCode() {
          return statusCode
        },
        setHeader(name, value) {
          headers[String(name).toLowerCase()] = value
        },
        end(chunk = '') {
          responseBody = chunk
          resolve()
        },
      }
      try {
        const raw = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body)
        const req = {
          method,
          url: path,
          headers: { ...(raw ? { 'content-type': 'application/json' } : {}), ...extraHeaders },
          async *[Symbol.asyncIterator]() {
            if (raw) yield Buffer.from(raw, 'utf8')
          },
        }
        const pending = handler(req, res)
        if (pending && typeof pending.catch === 'function') pending.catch(reject)
      } catch (error) {
        reject(error)
      }
    })
    let parsed = null
    try {
      parsed = responseBody ? JSON.parse(responseBody) : null
    } catch {
      parsed = null
    }
    return { status: statusCode, headers, body: responseBody, json: parsed }
  }

  const releaseReads = () => {
    holding = false
    const pending = holds
    holds = []
    for (const resolve of pending) resolve()
  }

  return {
    ctx,
    sessions,
    reads,
    warns,
    routes,
    disposers,
    request,
    /** 让 readSession 卡住，用来观察「扫描进行中」的快照。 */
    holdReads() {
      holding = true
    },
    releaseReads,
    dispose() {
      releaseReads()
      while (disposers.length) {
        const dispose = disposers.pop()
        try {
          dispose()
        } catch {
          /* 清理失败不该让用例挂住 */
        }
      }
    },
    setSessions(next) {
      sessions.length = 0
      sessions.push(...next)
    },
  }
}

/** 轮询直到条件成立，超时抛错（比固定 sleep 稳）。 */
export async function waitFor(predicate, { timeout = 5000, interval = 5, label = 'condition' } = {}) {
  const startedAt = Date.now()
  for (;;) {
    const value = await predicate()
    if (value) return value
    if (Date.now() - startedAt > timeout) throw new Error(`waitFor 超时：${label}`)
    await new Promise((resolve) => setTimeout(resolve, interval))
  }
}

export function withTemporaryHome(t) {
  // 必须在 import 插件之前设置：dshHome() 每次调用都读 env，所以设置后即可。
  const previous = process.env.DSH_HOME
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dps-home-'))
  process.env.DSH_HOME = dir
  t.after(() => {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    fs.rmSync(dir, { recursive: true, force: true })
  })
  return dir
}
