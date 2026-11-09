/**
 * 从 client.js 里取出纯函数源码来测。
 *
 * 浏览器半区是 `window.__ModuleLoader__.load({ factory })` 包起来的单文件模块，内部函数
 * 不对外导出；这里按源码切片 + `new Function` 求值，既不用改运行时代码，也不用在测试里
 * 复制一份实现（复制出来的实现迟早和真身不一致）。
 *
 * 代价：函数一旦改名或内联，这里会抛错——那是提醒我们同步测试，而不是静默通过。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CLIENT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'client.js')

export function readClientSource() {
  return fs.readFileSync(CLIENT_PATH, 'utf8')
}

/** 从 `{`（或 `[`）开始找到配对的 `}`（或 `]`），跳过字符串、模板字符串、注释里的括号。 */
function matchBrace(source, openIndex) {
  const open = source[openIndex]
  if (open !== '{' && open !== '[') throw new Error(`matchBrace: 起点不是花括号 / 方括号（index=${openIndex}）`)
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let index = openIndex
  while (index < source.length) {
    const char = source[index]
    if (char === '/' && source[index + 1] === '/') {
      const newline = source.indexOf('\n', index)
      if (newline < 0) break
      index = newline + 1
      continue
    }
    if (char === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2)
      if (end < 0) break
      index = end + 2
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      const quote = char
      index += 1
      while (index < source.length && source[index] !== quote) {
        if (source[index] === '\\') {
          index += 2
          continue
        }
        if (quote === '`' && source[index] === '$' && source[index + 1] === '{') {
          index += 2
          let nested = 1
          while (index < source.length && nested > 0) {
            if (source[index] === '{') nested += 1
            else if (source[index] === '}') nested -= 1
            index += 1
          }
          continue
        }
        index += 1
      }
      index += 1
      continue
    }
    if (char === open) {
      depth += 1
      index += 1
      continue
    }
    if (char === close) {
      depth -= 1
      index += 1
      if (depth === 0) return index - 1
      continue
    }
    index += 1
  }
  throw new Error(`matchBrace: 花括号没配平（从 index=${openIndex} 开始）`)
}

export function extractFunction(source, name) {
  const marker = `function ${name}(`
  const start = source.indexOf(marker)
  if (start < 0) {
    throw new Error(`client.js 里找不到 ${marker}…）：函数改名/内联后请同步 test/helpers/client-source.mjs`)
  }
  const open = source.indexOf('{', start + marker.length)
  const end = matchBrace(source, open)
  return source.slice(start, end + 1)
}

export function hasFunction(source, name) {
  return source.includes(`function ${name}(`)
}

/**
 * 取出顶层常量 / 变量声明：`const NAME = [ … ]`、`const NAME = { … }` 按括号配对整段取；
 * 其他写法（`let NAME = null`、`const NAME = 8`）取到行尾。用来测价格表这类数据时直接用 client.js 里的那一份，不在测试里抄一遍。
 */
export function extractConstant(source, name) {
  const match = new RegExp(`\\n\\s*(const|let) ${name} = `).exec(source)
  if (!match) throw new Error(`client.js 里找不到常量 ${name}：改名后请同步测试`)
  const start = match.index + 1
  const valueStart = match.index + match[0].length
  const first = source[valueStart]
  if (first === '[' || first === '{') return source.slice(start, matchBrace(source, valueStart) + 1)
  const lineEnd = source.indexOf('\n', valueStart)
  return source.slice(start, lineEnd < 0 ? source.length : lineEnd)
}

/**
 * 把若干纯函数求值出来。
 *   functions 函数名列表（互相引用没关系，function 声明会提升）
 *   constants 直接从 client.js 取的常量名列表（价格表、节假日这类数据）
 *   extraCode 需要补的常量/桩，例如 `const ACTIVITY_WEEKS = 53`
 * 返回 { 函数名: Function }
 */
export function loadClientHelpers({ functions, constants = [], extraCode = [] }) {
  const source = readClientSource()
  const parts = [
    ...extraCode,
    ...constants.map((name) => extractConstant(source, name)),
    ...functions.map((name) => extractFunction(source, name)),
    `return { ${functions.join(', ')} }`,
  ]
  return new Function(parts.join('\n'))()
}
