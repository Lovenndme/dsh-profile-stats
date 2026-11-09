/*
 * dsh-profile-stats 本地预览 —— 假宿主。
 *
 * 插件页面由仓库根目录的 client.js 渲染（同一份组件、同一份 CSS），这里只提供它在 DSH 里
 * 依赖的东西：window.__ModuleLoader__、slots 服务、locale 服务，以及被拦截的 fetch。
 * 数据全部内置，任何请求都不会离开本页。
 *
 * 页面状态记在地址栏 # 后面（theme / width / view / lang / update），刷新或分享链接都能复现同一画面。
 */
(function () {
  'use strict'

  var SNAPSHOT_URL = '/api/dsh-profile-stats/snapshot'
  var REFRESH_URL = '/api/dsh-profile-stats/refresh'
  var UPDATE_URL = '/api/dsh-profile-stats/update'
  var ALIAS_URL = '/api/dsh-profile-stats/alias'
  var BILLING_URL = '/api/dsh-profile-stats/billing'

  /* ------------------------------------------------------------ 模块加载器 */

  var definition = null
  window.__ModuleLoader__ = {
    load: function (def) {
      definition = def
    },
  }

  /* -------------------------------------------------------------- 预览状态 */

  var DEFAULTS = { theme: 'light', width: '1280', view: 'default', lang: 'zh-CN', update: 'off' }
  var state = readHash()

  function readHash() {
    var out = Object.assign({}, DEFAULTS)
    var raw = String(window.location.hash || '').replace(/^#/, '')
    raw.split('&').forEach(function (pair) {
      var parts = pair.split('=')
      if (parts.length === 2 && Object.prototype.hasOwnProperty.call(DEFAULTS, parts[0])) out[parts[0]] = decodeURIComponent(parts[1])
    })
    return out
  }

  function writeHash() {
    var text = Object.keys(DEFAULTS)
      .map(function (key) {
        return key + '=' + encodeURIComponent(state[key])
      })
      .join('&')
    try {
      window.history.replaceState(null, '', '#' + text)
    } catch (error) {
      window.location.hash = text
    }
  }

  /* ------------------------------------------------------------ 内置假快照 */

  function mulberry32(seed) {
    return function () {
      seed |= 0
      seed = (seed + 0x6d2b79f5) | 0
      var value = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296
    }
  }

  function addDays(date, days) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
  }

  function dayKey(date) {
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0')
  }

  /** 按权重把整数 total 拆开，余数给第一项，保证各项之和恰好等于 total。 */
  function split(total, weights) {
    var keys = Object.keys(weights)
    var sum = keys.reduce(function (acc, key) {
      return acc + weights[key]
    }, 0)
    var out = {}
    var used = 0
    keys.forEach(function (key) {
      var part = Math.floor((total * weights[key]) / sum)
      out[key] = part
      used += part
    })
    out[keys[0]] += total - used
    return out
  }

  /**
   * 默认快照：数量级按任务说明第 4 节（累计约 33.3 亿、缓存约 32 亿、输出约 690 万、最长任务约 1 小时、
   * 当前连续 10 天），日期相对「今天」生成，所以任何一天打开都有今天的数据。
   */
  /**
   * 各家供应商的缓存命中率不同（供应商卡片的「命中率」列才有区别）。
   * write 只在「含缓存写入」视图里生效：relay-lab 演示一家会报缓存写入的供应商（Token 构成多出一行）。
   */
  /**
   * 演示用的项目（工作目录）：虚构的公开路径。键和宿主一样（Windows 路径小写、正斜杠），
   * weight 是用量权重，subagent 是其中子代理会话的比例。
   */
  var PROJECTS = [
    { key: 'c:/users/mike/code/atlas-web', path: 'C:\\Users\\mike\\code\\atlas-web', weight: 52, subagent: 0.28 },
    { key: 'c:/users/mike/code/ledger-api', path: 'C:\\Users\\mike\\code\\ledger-api', weight: 31, subagent: 0.12 },
    { key: 'c:/users/mike/notes', path: 'C:\\Users\\mike\\notes', weight: 11, subagent: 0 },
    { key: 'd:/sandbox/demo', path: 'D:\\sandbox\\demo', weight: 6, subagent: 0.45 },
  ]

  /**
   * 每小时用量（slots）怎么摊：一天按这几个本地钟点分配（上午、下午是 DeepSeek 的高峰时段，晚上是空闲时段），
   * 每家供应商用一个模型。和宿主一样：[UTC 小时序号, 供应商, 模型, 项目键, 未缓存输入, 缓存读, 缓存写, 输出]。
   */
  var SLOT_HOURS = { 10: 0.4, 15: 0.4, 21: 0.2 }
  var PROVIDER_MODELS = {
    'deepseek-official': 'deepseek-flash',
    'deepseek-account': 'deepseek-v4-1-flash',
    'deepseek-modlens': 'deepseek-v4-pro',
    'relay-lab': 'deepseek-v4-1-flash',
  }

  function buildSlots(date, providerUsage) {
    var slots = []
    var parts = ['inputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens']
    Object.keys(providerUsage).forEach(function (id) {
      var usage = providerUsage[id]
      var byHour = parts.map(function (field) {
        return split(usage[field], SLOT_HOURS)
      })
      Object.keys(SLOT_HOURS).forEach(function (hour) {
        var epochHour = Math.floor(new Date(date.getFullYear(), date.getMonth(), date.getDate(), Number(hour)).getTime() / 3600000)
        var projectParts = parts.map(function (field, index) {
          var weights = {}
          PROJECTS.forEach(function (project) {
            weights[project.key] = project.weight
          })
          return split(byHour[index][hour], weights)
        })
        PROJECTS.forEach(function (project) {
          var values = projectParts.map(function (map) {
            return map[project.key]
          })
          if (values[0] + values[1] + values[2] + values[3] > 0) slots.push([epochHour, id, PROVIDER_MODELS[id], project.key].concat(values))
        })
      })
    })
    return slots
  }

  var PROVIDER_PROFILES = {
    'deepseek-official': { hit: 0.955, write: 0 },
    'deepseek-account': { hit: 0.988, write: 0 },
    'deepseek-modlens': { hit: 0.942, write: 0 },
    'relay-lab': { hit: 0.9, write: 0.03 },
  }

  function buildSnapshot(withWrites) {
    var rand = mulberry32(20261104)
    var today = new Date()
    today.setHours(0, 0, 0, 0)
    var HISTORY = 80
    var active = []
    for (var offset = HISTORY - 1; offset >= 0; offset -= 1) {
      var date = addDays(today, -offset)
      var isActive
      if (offset < 10) isActive = true
      else if (offset === 10) isActive = false
      else isActive = rand() < 0.55
      if (isActive) active.push({ date: date, offset: offset })
    }
    // 早期最长连续不超过 7 天，保证「最长连续」= 当前的 10 天
    var run = 0
    active.forEach(function (entry, index) {
      var previous = active[index - 1]
      run = previous && previous.offset === entry.offset + 1 ? run + 1 : 1
      if (entry.offset > 10 && run > 7) entry.drop = true
    })
    active = active.filter(function (entry) {
      return !entry.drop
    })

    var TOTAL = 3330000000
    var TODAY_TOKENS = 16500000
    var PEAK_OFFSET = 9
    var PEAK_TOKENS = 1200000000
    var weights = {}
    active.forEach(function (entry) {
      if (entry.offset === 0 || entry.offset === PEAK_OFFSET) return
      var weekday = entry.date.getDay()
      var base = weekday === 0 || weekday === 6 ? 0.45 : 1
      weights[dayKey(entry.date)] = base * (0.35 + rand() * 1.3) * (entry.offset < 30 ? 1.6 : 1)
    })
    var amounts = split(TOTAL - TODAY_TOKENS - PEAK_TOKENS, weights)
    amounts[dayKey(today)] = TODAY_TOKENS
    amounts[dayKey(addDays(today, -PEAK_OFFSET))] = PEAK_TOKENS

    var daily = active.map(function (entry) {
      var key = dayKey(entry.date)
      var tokens = amounts[key]
      var late = entry.offset < 45
      var models = late
        ? {
            'deepseek-v4-1-flash': 82,
            'deepseek-v4-1-pro': 9,
            'claude-sonnet-5-5': 3,
            'gpt-6-astra': 2,
            'claude-opus-5-5': 1.5,
            'claude-haiku-5-5': 1,
            'claude-fable-5-1': 0.8,
          }
        : { 'deepseek-v4-1-flash': 70, 'deepseek-v4-1-pro': 20, 'claude-sonnet-5-5': 10 }
      // 预览数据只用公开的供应商 id（宿主内置的 deepseek-*）加一个虚构的未知 id，演示「未知 id 原样显示」
      var providers = { 'deepseek-official': 52, 'deepseek-account': 30, 'deepseek-modlens': 14, 'relay-lab': 4 }
      if (entry.offset === 0) providers = { 'deepseek-official': 70, 'deepseek-account': 30 }
      // 和宿主一样四项互不重叠：每家 token = 未缓存输入 + 缓存读 + 缓存写 + 输出
      var byProvider = split(tokens, providers)
      var providerUsage = {}
      var sums = { input: 0, read: 0, write: 0, output: 0 }
      Object.keys(byProvider).forEach(function (id) {
        var amount = byProvider[id]
        var profile = PROVIDER_PROFILES[id]
        var read = Math.floor(amount * (profile.hit + (rand() - 0.5) * 0.012))
        var write = withWrites ? Math.floor(amount * profile.write) : 0
        var output = Math.floor(amount * (0.0016 + rand() * 0.001))
        var usage = { inputTokens: amount - read - write - output, cacheReadTokens: read, cacheWriteTokens: write, outputTokens: output }
        providerUsage[id] = usage
        sums.input += usage.inputTokens
        sums.read += read
        sums.write += write
        sums.output += output
      })
      // 按项目拆（各项目之和 = 当天总量）；子代理部分按各项目的比例取整（不消耗随机数，其余数字不变）
      var projectWeights = {}
      PROJECTS.forEach(function (project) {
        projectWeights[project.key] = project.weight
      })
      var byProject = split(tokens, projectWeights)
      var byProjectSubagent = {}
      PROJECTS.forEach(function (project) {
        var part = Math.floor(byProject[project.key] * project.subagent)
        if (part > 0) byProjectSubagent[project.key] = part
      })
      return {
        date: key,
        tokens: tokens,
        calls: Math.max(1, Math.round(tokens / 260000)),
        inputTokens: sums.input,
        outputTokens: sums.output,
        cacheReadTokens: sums.read,
        cacheWriteTokens: sums.write,
        byProvider: byProvider,
        providerUsage: providerUsage,
        byModel: split(tokens, models),
        byProject: byProject,
        byProjectSubagent: byProjectSubagent,
        slots: buildSlots(entry.date, providerUsage),
      }
    })

    var totals = {
      tokens: 0,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      byProvider: {},
      byModel: {},
    }
    var peak = { date: '', tokens: 0 }
    daily.forEach(function (entry) {
      totals.tokens += entry.tokens
      totals.calls += entry.calls
      totals.inputTokens += entry.inputTokens
      totals.outputTokens += entry.outputTokens
      totals.cacheReadTokens += entry.cacheReadTokens
      totals.cacheWriteTokens += entry.cacheWriteTokens
      Object.keys(entry.byProvider).forEach(function (id) {
        totals.byProvider[id] = (totals.byProvider[id] || 0) + entry.byProvider[id]
      })
      Object.keys(entry.byModel).forEach(function (id) {
        totals.byModel[id] = (totals.byModel[id] || 0) + entry.byModel[id]
      })
      if (entry.tokens > peak.tokens) peak = { date: entry.date, tokens: entry.tokens }
    })

    return Object.assign(
      {
        ok: true,
        identity: { name: 'Mike', handle: '@lovenndme', avatar: 'M' },
        scanning: false,
        progress: { done: 69, total: 69 },
        generatedAt: Date.now(),
        failedSessions: 0,
        daily: daily,
        projects: PROJECTS.reduce(function (map, project) {
          map[project.key] = project.path
          return map
        }, {}),
      },
      {
        totals: Object.assign(totals, {
          sessions: 69,
          activeDays: daily.length,
          firstDay: daily.length ? daily[0].date : '',
          lastDay: daily.length ? daily[daily.length - 1].date : '',
          peakDay: peak,
          peakStepTokens: 0,
          peakStepSession: null,
          peakSessionTokens: 0,
          peakSession: null,
          longestTurnMs: 3700000,
          longestTurnSession: 'session-preview',
          longestStreak: 10,
          currentStreak: 10,
          tokensWithInherited: totals.tokens + 70000000,
        }),
      },
    )
  }

  function emptyTotals() {
    return {
      tokens: 0,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      sessions: 0,
      activeDays: 0,
      firstDay: '',
      lastDay: '',
      peakDay: { date: '', tokens: 0 },
      longestTurnMs: 0,
      longestStreak: 0,
      currentStreak: 0,
      byProvider: {},
      byModel: {},
      tokensWithInherited: 0,
    }
  }

  var fullSnapshot = buildSnapshot(false)
  var writeSnapshot = buildSnapshot(true)
  /** 每次挂载重置的「宿主」运行状态：刷新后扫描几轮、首扫进度、升级进度。 */
  var hostState = null

  function resetHost() {
    hostState = { scanLeft: 0, firstScanDone: 23, updateAt: 0 }
  }

  function updateBlock() {
    var installed = '2.4.11'
    var latest = state.update === 'on' ? '2.4.12' : '2.4.11'
    if (hostState.updateAt && Date.now() > hostState.updateAt) installed = latest
    return { installed: installed, latest: latest, available: latest !== installed, canUpdate: true, checking: false, running: false, lastResult: null }
  }

  function currentSnapshot() {
    var identity = { name: 'Mike', handle: '@lovenndme', avatar: 'M' }
    if (state.view === 'empty') {
      return { ok: true, identity: identity, totals: emptyTotals(), daily: [], scanning: false, progress: { done: 0, total: 0 }, generatedAt: Date.now(), update: updateBlock() }
    }
    if (state.view === 'scanning') {
      // 首次扫描：每轮轮询推进一点，停在 68/69，保持「扫描中」画面
      hostState.firstScanDone = Math.min(68, hostState.firstScanDone + 3)
      return { ok: true, identity: identity, totals: emptyTotals(), daily: [], scanning: true, firstScan: true, progress: { done: hostState.firstScanDone, total: 69 }, generatedAt: 0, update: updateBlock() }
    }
    var body = JSON.parse(JSON.stringify(state.view === 'cache-write' ? writeSnapshot : fullSnapshot))
    body.aliases = { providers: readAliases() }
    body.billing = { providers: billingMemory || readBillingStore() }
    body.generatedAt = Date.now()
    body.update = updateBlock()
    if (hostState.scanLeft > 0) {
      // 点了刷新：后台重扫两三轮（不是首次扫描，页面只转刷新图标）
      hostState.scanLeft -= 1
      body.scanning = true
      body.firstScan = false
      body.progress = { done: 69 - hostState.scanLeft * 2, total: 69 }
    }
    return body
  }

  /* ------------------------------------------------------------- fetch 拦截 */

  var requestLog = { snapshot: 0, refresh: 0, update: 0, alias: 0, billing: 0, blocked: 0 }

  /** 计费方式：宿主存在本机 billing.json 里，预览存在这个浏览器的 localStorage 里。 */
  var BILLING_STORE = 'dps-preview-billing'
  var DEFAULT_BILLING = { 'relay-lab': { mode: 'multiplier', factor: 0.12 } }
  function readBillingStore() {
    try {
      var raw = window.localStorage.getItem(BILLING_STORE)
      if (raw === null) return JSON.parse(JSON.stringify(DEFAULT_BILLING))
      var parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch (error) {
      return JSON.parse(JSON.stringify(DEFAULT_BILLING))
    }
  }
  var billingMemory = null
  function writeBillingStore(provider, billing) {
    var current = billingMemory || readBillingStore()
    if (billing) current[provider] = billing
    else delete current[provider]
    billingMemory = current
    try {
      window.localStorage.setItem(BILLING_STORE, JSON.stringify(current))
    } catch (error) {
      /* 拿不到 localStorage：只在这次页面里生效 */
    }
    return current
  }

  /** 供应商显示名：宿主存在本机文件里，预览存在这个浏览器的 localStorage 里（刷新后还在）。 */
  var ALIAS_STORE = 'dps-preview-aliases'
  function readAliases() {
    try {
      var parsed = JSON.parse(window.localStorage.getItem(ALIAS_STORE) || '{}')
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch (error) {
      return {}
    }
  }
  function writeAlias(provider, name) {
    var aliases = readAliases()
    var label = String(name || '').trim().slice(0, 40)
    if (label) aliases[provider] = label
    else delete aliases[provider]
    try {
      window.localStorage.setItem(ALIAS_STORE, JSON.stringify(aliases))
    } catch (error) {
      /* 无痕窗口等拿不到 localStorage：只在这次页面里生效 */
    }
    return aliases
  }

  function renderLog() {
    var node = document.getElementById('pv-log')
    if (!node) return
    node.textContent =
      'GET snapshot ×' + requestLog.snapshot + ' · POST refresh ×' + requestLog.refresh + ' · POST update ×' + requestLog.update +
      (requestLog.alias ? ' · POST alias ×' + requestLog.alias : '') +
      (requestLog.billing ? ' · POST billing ×' + requestLog.billing : '') +
      (requestLog.blocked ? ' · 拦截外部请求 ×' + requestLog.blocked : '')
  }

  function json(status, body) {
    return new Response(JSON.stringify(body), { status: status, headers: { 'content-type': 'application/json' } })
  }

  function later(value) {
    return new Promise(function (resolve) {
      setTimeout(function () {
        resolve(value)
      }, 120)
    })
  }

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : input && input.url ? input.url : String(input)
    var method = String((init && init.method) || 'GET').toUpperCase()
    var result
    if (url === SNAPSHOT_URL && method === 'GET') {
      requestLog.snapshot += 1
      result = state.view === 'error' ? json(500, { ok: false, error: 'preview-error' }) : json(200, currentSnapshot())
    } else if (url === REFRESH_URL && method === 'POST') {
      requestLog.refresh += 1
      if (state.view !== 'empty' && state.view !== 'scanning' && state.view !== 'error') hostState.scanLeft = 3
      result = json(200, { ok: true, accepted: true })
    } else if (url === BILLING_URL && method === 'POST') {
      requestLog.billing += 1
      var billingBody = {}
      try {
        billingBody = JSON.parse((init && init.body) || '{}')
      } catch (error) {
        billingBody = {}
      }
      result = billingBody && typeof billingBody.provider === 'string' && billingBody.provider
        ? json(200, { ok: true, billing: { providers: writeBillingStore(billingBody.provider, billingBody.billing || null) } })
        : json(400, { ok: false, error: 'invalid-provider' })
    } else if (url === ALIAS_URL && method === 'POST') {
      requestLog.alias += 1
      var payload = {}
      try {
        payload = JSON.parse((init && init.body) || '{}')
      } catch (error) {
        payload = {}
      }
      result = payload && typeof payload.provider === 'string' && payload.provider
        ? json(200, { ok: true, aliases: { providers: writeAlias(payload.provider, payload.name) } })
        : json(400, { ok: false, error: 'invalid-provider' })
    } else if (url === UPDATE_URL && method === 'POST') {
      requestLog.update += 1
      hostState.updateAt = Date.now() + 3000
      result = json(200, { ok: true, target: '2.4.12' })
    } else {
      requestLog.blocked += 1
      renderLog()
      return Promise.reject(new TypeError('preview: blocked request to ' + url))
    }
    renderLog()
    return later(result)
  }

  /* ---------------------------------------------------------- 假 slots / locale */

  var registry = { sidebar: [], main: [] }
  var slots = {
    inject: function (name, callback) {
      callback()
    },
    register: function (options, component) {
      ;(options.name === 'main' ? registry.main : registry.sidebar).push({ options: options, component: component })
      return function () {}
    },
  }

  var dictionaries = {}
  var localeListeners = []
  var locale = {
    register: function (namespace, id, dict) {
      dictionaries[id] = dict
      return function () {}
    },
    bind: function () {
      return function (key) {
        var dict = dictionaries[state.lang] || dictionaries[state.lang.indexOf('zh') === 0 ? 'zh-CN' : 'en'] || {}
        return dict[key] || key
      }
    },
    getLocale: function () {
      return { active: state.lang, locales: [{ id: 'zh-CN' }, { id: 'en' }], revision: 1 }
    },
    subscribe: function (listener) {
      localeListeners.push(listener)
      return function () {}
    },
  }

  /* ------------------------------------------------------------------ 挂载 */

  var React = window.React
  var ReactDOM = window.ReactDOM
  var mainRoot = null
  var sidebarRoot = null
  var mountCount = 0

  function ErrorBoundary(props) {
    React.Component.call(this, props)
    this.state = { error: null }
  }
  ErrorBoundary.prototype = Object.create(React.Component.prototype)
  ErrorBoundary.prototype.constructor = ErrorBoundary
  ErrorBoundary.getDerivedStateFromError = function (error) {
    return { error: error }
  }
  ErrorBoundary.prototype.render = function () {
    if (this.state.error) {
      return React.createElement('pre', { style: { padding: '24px', color: 'crimson', whiteSpace: 'pre-wrap' } }, '插件渲染抛错：\n' + String(this.state.error && this.state.error.stack))
    }
    return this.props.children
  }

  function applyChrome() {
    document.body.toggleAttribute('data-ds-dark-theme', state.theme === 'dark')
    document.documentElement.lang = state.lang
    document.getElementById('pv-window').style.width = state.width + 'px'
    Array.prototype.forEach.call(document.querySelectorAll('[data-pv-group]'), function (group) {
      var key = group.getAttribute('data-pv-group')
      Array.prototype.forEach.call(group.querySelectorAll('button[data-value]'), function (button) {
        button.setAttribute('aria-pressed', button.getAttribute('data-value') === state[key] ? 'true' : 'false')
      })
    })
  }

  /** 「模型按月」「Cache Lens 放大」是组件内部状态：挂载后点插件自己的按钮进入，走真实代码路径。 */
  function applyViewAction(token) {
    var selector =
      state.view === 'model-month'
        ? '[data-dps-control="model-grain"] [data-value="month"]'
        : state.view === 'lens-zoom'
          ? '[data-dps-control="lens-zoom"]'
          : null
    if (!selector) return
    var started = Date.now()
    ;(function poll() {
      if (token !== mountCount) return
      var target = document.querySelector('#pv-main ' + selector)
      if (target) {
        target.click()
        return
      }
      if (Date.now() - started < 4000) setTimeout(poll, 60)
    })()
  }

  function mount() {
    mountCount += 1
    resetHost()
    applyChrome()
    var main = registry.main[0]
    var side = registry.sidebar[0]
    if (side) {
      var entry = document.getElementById('pv-sidebar-entry')
      var label = typeof side.options.label === 'function' ? side.options.label() : String(side.options.label || '')
      entry.title = label
      entry.setAttribute('aria-label', label)
      if (!sidebarRoot) sidebarRoot = ReactDOM.createRoot(entry)
      sidebarRoot.render(React.createElement(side.component, { key: 'side-' + mountCount }))
    }
    if (main) {
      if (!mainRoot) mainRoot = ReactDOM.createRoot(document.getElementById('pv-main'))
      mainRoot.render(React.createElement(ErrorBoundary, { key: 'main-' + mountCount }, React.createElement(main.component, null)))
    }
    applyViewAction(mountCount)
  }

  function boot() {
    renderLog()
    if (!definition) {
      document.getElementById('pv-missing').hidden = false
      return
    }
    var moduleExports = definition.factory(function (id) {
      if (id === 'react') return React
      throw new Error('preview: client.js required "' + id + '"; only react is provided by the host')
    })
    moduleExports.apply({
      get: function (name) {
        if (name === 'slots') return slots
        if (name === 'locale') return locale
        return undefined
      },
      inject: function () {},
    })

    Array.prototype.forEach.call(document.querySelectorAll('[data-pv-group]'), function (group) {
      var key = group.getAttribute('data-pv-group')
      group.addEventListener('click', function (event) {
        var button = event.target.closest('button[data-value]')
        if (!button) return
        var value = button.getAttribute('data-value')
        if (state[key] === value) return
        state[key] = value
        writeHash()
        if (key === 'lang') {
          applyChrome()
          localeListeners.forEach(function (listener) {
            listener()
          })
          var side = registry.sidebar[0]
          if (side && typeof side.options.label === 'function') document.getElementById('pv-sidebar-entry').title = side.options.label()
          return
        }
        if (key === 'theme' || key === 'width') {
          applyChrome()
          return
        }
        mount()
      })
    })
    document.getElementById('pv-remount').addEventListener('click', mount)
    window.addEventListener('hashchange', function () {
      state = readHash()
      mount()
    })
    writeHash()
    mount()
  }

  document.addEventListener('DOMContentLoaded', boot)
})()
