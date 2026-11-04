#!/usr/bin/env node
/**
 * 本地预览：node tools/preview.mjs [--port 4178] [--no-open]
 *
 * 起一个只监听 127.0.0.1 的静态服务器，只放行 client.js 与 preview/ 目录，然后用默认浏览器打开
 * http://127.0.0.1:<port>/preview/ 。预览页用的就是仓库里这份 client.js，改完刷新浏览器即可。
 *
 * 不想起服务器的话，直接双击 preview/index.html 也能看（全部是普通 <script>，file:// 下可用）。
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const portIndex = args.indexOf('--port')
const preferredPort = portIndex >= 0 ? Number(args[portIndex + 1]) || 4178 : 4178
const shouldOpen = !args.includes('--no-open')

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
}

function resolveRequest(urlPath) {
  let relative = decodeURIComponent(urlPath.split('?')[0]).replace(/^\/+/, '')
  if (relative === '' || relative === 'preview') return { redirect: '/preview/' }
  if (relative.endsWith('/')) relative += 'index.html'
  const allowed = relative === 'client.js' || relative.startsWith('preview/')
  const absolute = path.resolve(root, relative)
  if (!allowed || !absolute.startsWith(root + path.sep)) return null
  return { file: absolute }
}

const server = http.createServer((req, res) => {
  const target = resolveRequest(req.url || '/')
  if (target && target.redirect) {
    res.writeHead(302, { location: target.redirect })
    res.end()
    return
  }
  if (!target || !fs.existsSync(target.file) || !fs.statSync(target.file).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('not found')
    return
  }
  res.writeHead(200, {
    'content-type': TYPES[path.extname(target.file)] || 'application/octet-stream',
    'cache-control': 'no-store',
  })
  fs.createReadStream(target.file).pipe(res)
})

function openBrowser(url) {
  const platform = process.platform
  const command = platform === 'win32' ? 'cmd' : platform === 'darwin' ? 'open' : 'xdg-open'
  const commandArgs = platform === 'win32' ? ['/c', 'start', '', url] : [url]
  try {
    spawn(command, commandArgs, { stdio: 'ignore', detached: true }).unref()
  } catch {
    /* 打不开浏览器就只打印地址 */
  }
}

function listen(port) {
  server.once('error', (error) => {
    if (error && error.code === 'EADDRINUSE' && port !== 0) {
      listen(0)
      return
    }
    throw error
  })
  server.listen(port, '127.0.0.1', () => {
    const address = server.address()
    const url = `http://127.0.0.1:${address.port}/preview/`
    console.log(`dsh-profile-stats 预览：${url}`)
    console.log('（Ctrl+C 退出；改完 client.js 刷新浏览器即可）')
    if (shouldOpen) openBrowser(url)
  })
}

listen(preferredPort)
