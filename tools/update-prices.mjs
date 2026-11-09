/**
 * 生成 prices.json：各厂商直供对话模型的官方价（美元 / 百万 token），数据来自 LiteLLM 的公开价格表
 * （https://github.com/BerriAI/litellm，MIT 许可，Copyright (c) 2023 Berri AI）。插件运行时不联网，
 * 这份表随包发布；发版前跑一次更新：
 *
 *   node tools/update-prices.mjs                 从 GitHub 下载最新的表
 *   node tools/update-prices.mjs <本地 JSON>     用已经下载好的文件
 *
 * 规则：
 *   - 只取各厂商自己的条目（anthropic / openai / gemini …），不取 Bedrock、Azure 这类托管平台的转售价；
 *   - 键用宿主的 normalizeModelId 归一化，和统计里的模型名一致（claude-sonnet-5-5、gpt-5-5、gemini-3-1-pro …）；
 *   - 同一个键有多条时：厂商顺序靠前的优先，其次是本来就不带日期 / preview 后缀的那条；
 *   - 分档定价（tiered_pricing）取第一档；按单次请求长度加价（*_above_*）的不取，按基础价算；
 *   - 没有缓存读 / 写价格的记 null（页面按未缓存输入价算）。
 * DeepSeek 的 Flash / Pro 由页面里带调价历史与高峰时段的人民币价表负责，这里的同名条目不会被用到。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { normalizeModelId } from '../index.js'

const SOURCE = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'prices.json')
const PROVIDERS = [
  'anthropic',
  'openai',
  'gemini',
  'vertex_ai-language-models',
  'xai',
  'mistral',
  'deepseek',
  'moonshot',
  'zai',
  'minimax',
  'dashscope',
  'volcengine',
  'tencent',
]

const perMillion = (value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value * 1e6 * 1e6) / 1e6 : null)

function pricesOf(entry) {
  let input = perMillion(entry.input_cost_per_token)
  let output = perMillion(entry.output_cost_per_token)
  if ((input === null || output === null) && Array.isArray(entry.tiered_pricing) && entry.tiered_pricing.length) {
    const first = entry.tiered_pricing[0]
    input = perMillion(first.input_cost_per_token)
    output = perMillion(first.output_cost_per_token)
  }
  if (input === null || output === null) return null
  return [input, output, perMillion(entry.cache_read_input_token_cost), perMillion(entry.cache_creation_input_token_cost)]
}

async function load(file) {
  if (file) return JSON.parse(fs.readFileSync(file, 'utf8'))
  const response = await fetch(SOURCE)
  if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`)
  return response.json()
}

const data = await load(process.argv[2])
const best = new Map()
for (const [key, entry] of Object.entries(data)) {
  if (!entry || typeof entry !== 'object' || (entry.mode !== 'chat' && entry.mode !== 'responses')) continue
  const rank = PROVIDERS.indexOf(entry.litellm_provider)
  if (rank < 0) continue
  const bare = key.includes('/') ? key.slice(key.lastIndexOf('/') + 1) : key
  const id = normalizeModelId(bare)
  const prices = pricesOf(entry)
  if (!id || !prices) continue
  // 本来就不带日期 / preview 后缀的那条更像「这个模型的价格」
  const exact = bare.toLowerCase().replace(/[._]/g, '-') === id ? 0 : 1
  const score = [rank, exact, bare.length]
  const current = best.get(id)
  if (!current || score[0] < current.score[0] || (score[0] === current.score[0] && (score[1] < current.score[1] || (score[1] === current.score[1] && score[2] < current.score[2])))) {
    best.set(id, { score, prices })
  }
}

const models = Object.fromEntries([...best.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([id, item]) => [id, item.prices]))
const today = new Date().toISOString().slice(0, 10)
const header = {
  source: 'https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json',
  license: 'MIT License, Copyright (c) 2023 Berri AI. See THIRD_PARTY_NOTICES.md.',
  fetchedAt: today,
  currency: 'USD',
  unit: 'per 1M tokens',
  fields: ['input', 'output', 'cacheRead', 'cacheWrite'],
}
// 一行一个模型，更新时 diff 好看
const lines = Object.entries(models).map(([id, prices]) => `    ${JSON.stringify(id)}: ${JSON.stringify(prices)}`)
const text = `${JSON.stringify(header, null, 2).replace(/\n}$/, ',\n  "models": {\n')}${lines.join(',\n')}\n  }\n}\n`
JSON.parse(text)
fs.writeFileSync(OUT, text)
console.log(`prices.json：${Object.keys(models).length} 个模型（${today}）`)
