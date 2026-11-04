/**
 * dsh-profile-stats — 浏览器半区。
 *
 * 在左侧图标栏加一个「个人主页」入口，主区渲染个人用量页：
 * 页头（头像 / 名字 / 刷新 / 更新）· 五个指标 · Token 活动 · 模型分布 · Token 构成（Cache Lens）· 供应商分类。
 *
 * 数字只有一个来源：宿主的 GET /api/dsh-profile-stats/snapshot。这里只做两件事：
 *   1. 派生展示值（占比、分桶求和、坐标轴），全程用原始整数，格式化只发生在渲染那一步；
 *   2. 画出来。颜色全部取自宿主主题 token（浅色 / 深色两套都能用），不写死任何色值。
 */

window.__ModuleLoader__.load({
  id: 'dsh-profile-stats',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const useState = React.useState
    const useEffect = React.useEffect
    const useMemo = React.useMemo
    const useCallback = React.useCallback
    const useRef = React.useRef
    const useLayoutEffect = React.useLayoutEffect || React.useEffect

    const NS = 'dsh-profile-stats'
    const SNAPSHOT_URL = '/api/dsh-profile-stats/snapshot'
    const REFRESH_URL = '/api/dsh-profile-stats/refresh'
    const UPDATE_URL = '/api/dsh-profile-stats/update'
    const PANEL_ID = 'profile'
    const STYLE_ID = 'dsh-profile-stats-style'
    /** 指标卡里的迷你柱：最近多少天。 */
    const SPARK_DAYS = 14
    const HEAT_WEEKS = 53

    /* -------------------------------------------------------------- 文案字典 */

    const EN = {
      'panel.title': 'Profile',
      'stat.tokens': 'Total tokens',
      'stat.today': 'Tokens today',
      'stat.longestTurn': 'Longest task',
      'stat.longestStreak': 'Longest streak',
      'stat.currentStreak': 'Current streak',
      'section.activity': 'Token activity',
      'section.model': 'Token by model',
      'section.breakdown': 'Token mix',
      'section.provider': 'Provider split',
      'note.range': 'Last 12 months',
      'note.total': '{value} in total',
      'mode.day': 'Daily',
      'mode.week': 'Weekly',
      'mode.total': 'Cumulative',
      'grain.day': 'Daily',
      'grain.week': 'Weekly',
      'grain.month': 'Monthly',
      'toggle.today': 'Today',
      'toggle.all': 'All time',
      'legend.less': 'Less',
      'legend.more': 'More',
      'tip.tokens': '{value} tokens',
      'tip.none': 'No activity',
      'tip.week': 'Week of {date}',
      'tip.weekRange': '{start} – {end}',
      'tip.cumulative': 'Cumulative through the week of {date}',
      'tip.through': 'Through {date}',
      'tip.total': 'Total',
      'chart.total': 'total {value}',
      'chart.empty': 'No data',
      'model.others': 'Other models',
      'model.unknown': 'Unknown model',
      'lens.total': 'Total tokens',
      'lens.cacheHit': 'Cache hit rate',
      'lens.uncachedTotal': 'Uncached total',
      'lens.uncachedShare': 'Uncached input share',
      'lens.cache': 'Cache hit',
      'lens.input': 'Uncached input',
      'lens.output': 'Output',
      'lens.zoom': 'Zoom into uncached',
      'lens.back': 'Back to overall',
      'lens.basis': 'Shares are computed over the uncached total',
      'lens.uncachedTitle': 'Uncached token mix',
      'lens.colType': 'Type',
      'lens.colAmount': 'Tokens',
      'lens.colShareTotal': 'of total',
      'lens.colShareUncached': 'of uncached',
      'provider.wincode': 'WinCode relay',
      'provider.arkcli-coding-plan': 'Ark Coding Plan',
      'provider.myapi': 'MyAPI',
      'provider.deepseek-account': 'DeepSeek account',
      'provider.deepseek-official': 'DeepSeek official',
      'provider.deepseek-modlens': 'DeepSeek ModLens',
      'provider.unknown': 'Unknown',
      'provider.other': 'Other',
      'status.loading': 'Scanning local session logs…',
      'action.refresh': 'Refresh',
      'action.retry': 'Retry',
      'action.update': 'Update to {version}',
      'action.updating': 'Updating…',
      'error.title': 'Failed to load usage stats',
      'error.stale': 'The last refresh failed',
      'empty.title': 'No sessions yet',
      'unit.days': '{count} d',
      'unit.hour': '{count} h',
      'unit.minute': '{count} m',
      'unit.day': 'd',
      'unit.hourShort': 'h',
      'unit.minuteShort': 'm',
      'unit.none': '—',
      'aria.activity': 'Token activity chart',
      'aria.model': 'Token by model chart',
      'aria.lens': 'Token mix bar',
      'aria.spark': 'Daily tokens, last 14 days',
    }

    const ZH = {
      'panel.title': '个人主页',
      'stat.tokens': '累计 Token 数',
      'stat.today': '今日 Token 用量',
      'stat.longestTurn': '最长任务用时',
      'stat.longestStreak': '最长连续天数',
      'stat.currentStreak': '当前连续天数',
      'section.activity': 'Token 活动',
      'section.model': '模型分布',
      'section.breakdown': 'Token 构成',
      'section.provider': '供应商分类',
      'note.range': '近 12 个月',
      'note.total': '共 {value}',
      'mode.day': '每天',
      'mode.week': '每周',
      'mode.total': '累计总量',
      'grain.day': '按日',
      'grain.week': '按周',
      'grain.month': '按月',
      'toggle.today': '今日',
      'toggle.all': '累计',
      'legend.less': '少',
      'legend.more': '多',
      'tip.tokens': '{value} tokens',
      'tip.none': '无活动',
      'tip.week': '{date} 起的一周',
      'tip.weekRange': '{start} – {end}',
      'tip.cumulative': '累计至 {date} 起的一周',
      'tip.through': '截至 {date}',
      'tip.total': '合计',
      'chart.total': '总计 {value}',
      'chart.empty': '暂无数据',
      'model.others': '其他模型',
      'model.unknown': '未知模型',
      'lens.total': '总 Token',
      'lens.cacheHit': '缓存命中率',
      'lens.uncachedTotal': '非缓存 Token 合计',
      'lens.uncachedShare': '未缓存输入占比',
      'lens.cache': '缓存命中',
      'lens.input': '未缓存输入',
      'lens.output': '输出',
      'lens.zoom': '放大非缓存细分',
      'lens.back': '返回整体构成',
      'lens.basis': '当前比例基于非缓存 Token 合计计算',
      'lens.uncachedTitle': '非缓存 Token 构成',
      'lens.colType': '类型',
      'lens.colAmount': '用量',
      'lens.colShareTotal': '占总 Token',
      'lens.colShareUncached': '占非缓存合计',
      'provider.wincode': '卫宁中转 WinCode',
      'provider.arkcli-coding-plan': '火山 Coding Plan',
      'provider.myapi': 'MyAPI',
      'provider.deepseek-account': 'DeepSeek 账号',
      'provider.deepseek-official': 'DeepSeek 官方',
      'provider.deepseek-modlens': 'DeepSeek ModLens',
      'provider.unknown': '未知来源',
      'provider.other': '其他',
      'status.loading': '正在统计本地会话日志…',
      'action.refresh': '刷新',
      'action.retry': '重试',
      'action.update': '更新到 {version}',
      'action.updating': '更新中…',
      'error.title': '读取用量统计失败',
      'error.stale': '最近一次刷新失败',
      'empty.title': '还没有可统计的会话',
      'unit.days': '{count} 天',
      'unit.hour': '{count} 小时',
      'unit.minute': '{count} 分',
      'unit.day': '天',
      'unit.hourShort': '小时',
      'unit.minuteShort': '分',
      'unit.none': '—',
      'aria.activity': 'Token 活动图',
      'aria.model': '模型分布图',
      'aria.lens': 'Token 构成条',
      'aria.spark': '最近 14 天每日用量',
    }

    const localeBridge = {
      translate: null,
      localeId: 'zh-CN',
      listeners: new Set(),
      notify() {
        for (const listener of Array.from(localeBridge.listeners)) {
          try {
            listener()
          } catch (error) {
            console.warn('[dsh-profile-stats] locale listener failed', error)
          }
        }
      },
    }

    function fallbackTranslate(key) {
      const dict = String(localeBridge.localeId || '').toLowerCase().startsWith('zh') ? ZH : EN
      return dict[key] || ZH[key] || EN[key] || key
    }

    function format(template, vars) {
      if (!vars) return template
      return String(template).replace(/\{(\w+)\}/g, (match, name) => (vars[name] === undefined ? match : String(vars[name])))
    }

    function t(key, vars) {
      const translate = localeBridge.translate
      let text
      try {
        text = translate ? translate(key) : fallbackTranslate(key)
      } catch {
        text = fallbackTranslate(key)
      }
      if (!text || text === key) text = fallbackTranslate(key)
      return format(text, vars)
    }

    function currentLocaleId() {
      return localeBridge.localeId || 'zh-CN'
    }

    function isChineseLocale() {
      return String(currentLocaleId()).toLowerCase().startsWith('zh')
    }

    function useLocaleRevision() {
      const [, setRevision] = useState(0)
      useEffect(() => {
        const listener = () => setRevision((value) => value + 1)
        localeBridge.listeners.add(listener)
        return () => {
          localeBridge.listeners.delete(listener)
        }
      }, [])
      return null
    }

    function attachLocale(ctx) {
      if (localeBridge.translate) return true
      const locale = typeof ctx.get === 'function' ? ctx.get('locale') : undefined
      if (!locale) return false
      try {
        const snapshot = locale.getLocale ? locale.getLocale() : undefined
        // 中文包的 locale id 不一定是 zh-CN（可能是 zh / zh-Hans / zh-TW…），
        // 只注册死 zh-CN 会让中文界面回落到英文包，标签就变成 "Profile"。
        // 所以把当前语言目录里所有 zh* 以及激活语言本身都注册上。
        const localeIds = new Set(['en', 'zh-CN'])
        if (snapshot && typeof snapshot.active === 'string') localeIds.add(snapshot.active)
        const languages = snapshot && Array.isArray(snapshot.locales) ? snapshot.locales : []
        for (const language of languages) {
          if (!language || typeof language.id !== 'string') continue
          if (language.id === 'en' || language.id.toLowerCase().startsWith('zh')) localeIds.add(language.id)
        }
        // HMR 重载同一模块时 (ns, locale) 可能已经注册过：重复注册只抛这一条，
        // 不该连带让文案绑定失败，所以每份字典各自吞掉自己的错。
        for (const id of localeIds) {
          const dict = id.toLowerCase().startsWith('zh') ? ZH : EN
          try {
            locale.register(NS, id, dict)
          } catch (error) {
            console.warn(`[dsh-profile-stats] 文案 ${id} 已注册，复用现有字典：`, error && error.message ? error.message : error)
          }
        }
        localeBridge.translate = locale.bind(NS)
        if (snapshot && snapshot.active) localeBridge.localeId = snapshot.active
        if (typeof locale.subscribe === 'function') {
          locale.subscribe(() => {
            const next = locale.getLocale ? locale.getLocale() : undefined
            if (next && next.active) localeBridge.localeId = next.active
            localeBridge.notify()
          })
        }
        return true
      } catch (error) {
        console.warn('[dsh-profile-stats] 绑定文案失败：', error && error.message ? error.message : error)
        return false
      }
    }

    /* ---------------------------------------------------------------- 数值格式 */

    function toNumber(value) {
      return typeof value === 'number' && Number.isFinite(value) ? value : 0
    }

    /**
     * token 数 → { value, unit }：≥1 亿用「亿」，≥1 万用「万」，一位小数。
     * 单位按「取一位小数之后」的值来选：99,999,999 不能显示成「10000.0 万」。
     * 只在渲染那一步调用；任何求和、占比都用原始整数。
     */
    function tokenParts(value) {
      const number = toNumber(value)
      if (number <= 0) return { value: '0', unit: '' }
      if (number >= 1e8 || Number((number / 1e4).toFixed(1)) >= 1e4) return { value: (number / 1e8).toFixed(1), unit: '亿' }
      if (number >= 1e4) return { value: (number / 1e4).toFixed(1), unit: '万' }
      return { value: number.toLocaleString(currentLocaleId()), unit: '' }
    }

    function formatTokens(value) {
      const parts = tokenParts(value)
      return parts.unit ? `${parts.value} ${parts.unit}` : parts.value
    }

    /** 纵轴刻度文案：去掉多余的 .0（1.0 亿 → 1 亿）。 */
    function formatAxis(value) {
      const number = toNumber(value)
      if (number <= 0) return '0'
      return formatTokens(number).replace(/\.0(?=\s)/, '')
    }

    /**
     * 百分比（0–100）→ 文案。极小的非零值写成「<0.1%」而不是「0.0%」（否则看起来像没有），
     * 不足 100 的值不会被四舍五入成「100.0%」。
     */
    function formatPercent(value) {
      const number = toNumber(value)
      if (number <= 0) return '0%'
      if (number < 0.05) return '<0.1%'
      if (number >= 100) return '100%'
      if (number >= 99.95) return '>99.9%'
      return `${number.toFixed(1)}%`
    }

    /** 纵轴步长取整齐值：1 / 2 / 2.5 / 5 × 10ⁿ，token 是整数所以步长至少为 1。 */
    function niceStep(max, count) {
      if (!(max > 0)) return 1
      const rough = max / (count || 4)
      const magnitude = Math.pow(10, Math.floor(Math.log10(rough)))
      const normalized = rough / magnitude
      const multiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10
      return Math.max(1, multiplier * magnitude)
    }

    /** 坐标轴：{ max, ticks }，max 是步长的整数倍且不小于数据最大值。 */
    function niceScale(max, count) {
      const step = niceStep(max, count)
      const top = Math.max(step, Math.ceil(toNumber(max) / step) * step)
      const ticks = []
      for (let index = 0; index * step <= top + step / 1000; index += 1) ticks.push(index * step)
      return { max: top, step, ticks }
    }

    /** 毫秒 → [{ value, unit }]，例如 1 小时 2 分；没有数据时返回 null。 */
    function durationParts(ms) {
      const value = toNumber(ms)
      if (value <= 0) return null
      const totalMinutes = Math.round(value / 60000)
      const hours = Math.floor(totalMinutes / 60)
      const minutes = totalMinutes % 60
      if (hours <= 0) return [{ value: String(Math.max(minutes, 1)), unit: t('unit.minuteShort') }]
      if (minutes === 0) return [{ value: String(hours), unit: t('unit.hourShort') }]
      return [
        { value: String(hours), unit: t('unit.hourShort') },
        { value: String(minutes), unit: t('unit.minuteShort') },
      ]
    }

    function partsText(parts) {
      if (!parts) return t('unit.none')
      return parts.map((part) => (part.unit ? `${part.value} ${part.unit}` : part.value)).join(' ')
    }

    /* ---------------------------------------------------------------- 日期 */

    function startOfDay(date) {
      const copy = new Date(date.getTime())
      copy.setHours(0, 0, 0, 0)
      return copy
    }

    /**
     * 本地日历 ± n 天。必须按年/月/日推，不能用「毫秒 − n × 86400000」：
     * 夏令时切换日只有 23/25 小时，毫秒差会落到前一天 23:00，周桶键变成周日、日桶跳过一天。
     */
    function addDays(date, days) {
      return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
    }

    /** 周一为一周起点的当地日期（热力图与模型分布同一口径）。 */
    function startOfWeek(date) {
      const copy = startOfDay(date)
      return addDays(copy, -((copy.getDay() + 6) % 7))
    }

    function localDateKey(date) {
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      return `${year}-${month}-${day}`
    }

    /** 'YYYY-MM-DD' → 本地 Date；格式不对返回 null（不拿字符串直接比大小）。 */
    function parseDateKey(key) {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''))
      if (!match) return null
      const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
      return Number.isNaN(date.getTime()) ? null : date
    }

    function formatDate(date, options) {
      try {
        return new Intl.DateTimeFormat(currentLocaleId(), options).format(date)
      } catch {
        return localDateKey(date)
      }
    }

    function monthLabel(date) {
      return formatDate(date, { month: 'short' })
    }

    /* ------------------------------------------------------------ 数据派生 */

    /** daily[] → Map(dateKey → entry)，只收格式正确的日期。 */
    function indexDaily(daily) {
      const map = new Map()
      for (const entry of Array.isArray(daily) ? daily : []) {
        if (entry && parseDateKey(entry.date)) map.set(entry.date, entry)
      }
      return map
    }

    /** 五个指标 + 指标卡里的迷你柱（最近 SPARK_DAYS 天，最后一根是今天）。 */
    function deriveKpis(snapshot, today) {
      const totals = (snapshot && snapshot.totals) || {}
      const byDate = indexDaily(snapshot && snapshot.daily)
      const todayKey = localDateKey(today)
      const todayEntry = byDate.get(todayKey)
      const spark = []
      for (let offset = SPARK_DAYS - 1; offset >= 0; offset -= 1) {
        const key = localDateKey(addDays(today, -offset))
        const entry = byDate.get(key)
        spark.push({ key, tokens: entry ? toNumber(entry.tokens) : 0, today: offset === 0 })
      }
      return {
        tokens: toNumber(totals.tokens),
        today: todayEntry ? toNumber(todayEntry.tokens) : 0,
        longestTurnMs: toNumber(totals.longestTurnMs),
        longestStreak: toNumber(totals.longestStreak),
        currentStreak: toNumber(totals.currentStreak),
        spark,
      }
    }

    /* -------------------------------------------------------------- 数据拉取 */

    /**
     * 快照轮询。`reload()` 立刻重拉一次；`refresh()` 先请求宿主重扫，再立刻重拉——
     * 新快照带 scanning: true，于是切到 900ms 快轮询，扫描进度和新数字马上可见。
     */
    function useSnapshot(intervalMs = 45000) {
      const [snapshot, setSnapshot] = useState(null)
      const [error, setError] = useState(null)
      const loaderRef = useRef(null)

      useEffect(() => {
        let alive = true
        let timer = null
        // 每次请求一个序号：连点刷新时，先发出的慢请求不能覆盖后发出的新结果。
        let ticket = 0

        const schedule = (delay) => {
          if (timer) clearTimeout(timer)
          timer = setTimeout(load, delay)
        }

        const load = async () => {
          ticket += 1
          const mine = ticket
          if (timer) {
            clearTimeout(timer)
            timer = null
          }
          // 宿主卡住时不能让轮询永久停摆：15 秒没回应就当失败，按失败节奏重试。
          const controller = typeof AbortController === 'function' ? new AbortController() : null
          const abortTimer = controller ? setTimeout(() => controller.abort(), 15000) : null
          try {
            const response = await fetch(SNAPSHOT_URL, {
              headers: { accept: 'application/json' },
              cache: 'no-store',
              signal: controller ? controller.signal : undefined,
            })
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            const payload = await response.json()
            if (!alive || mine !== ticket) return
            setSnapshot(payload && typeof payload === 'object' ? payload : null)
            setError(null)
            schedule(payload && payload.scanning ? 900 : intervalMs)
          } catch (failure) {
            if (!alive || mine !== ticket) return
            setError(failure || new Error('request failed'))
            schedule(4000)
          } finally {
            if (abortTimer) clearTimeout(abortTimer)
          }
        }

        loaderRef.current = load
        load()
        return () => {
          alive = false
          loaderRef.current = null
          if (timer) clearTimeout(timer)
        }
      }, [intervalMs])

      const reload = useCallback(() => (loaderRef.current ? loaderRef.current() : Promise.resolve()), [])

      const refresh = useCallback(async () => {
        try {
          await fetch(REFRESH_URL, { method: 'POST' })
        } catch {
          /* 宿主没回应也照样重拉一次快照，错误态由快照请求呈现 */
        }
        return reload()
      }, [reload])

      return { snapshot, error, refresh, reload }
    }

    /** 组件是否仍挂载（异步流程里决定还要不要 setState）。 */
    function useMounted() {
      const mounted = useRef(true)
      useEffect(() => {
        mounted.current = true
        return () => {
          mounted.current = false
        }
      }, [])
      return mounted
    }

    /* ------------------------------------------------------------------ 图标 */

    function ProfileIcon(props) {
      const size = props && typeof props.size === 'number' ? props.size : 20
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          style: { display: 'block' },
        },
        h('circle', { cx: 12, cy: 8.2, r: 3.5 }),
        h('path', { d: 'M4.9 19.6c.7-3.2 3.6-5.1 7.1-5.1s6.4 1.9 7.1 5.1' }),
      )
    }

    /** 小图标集（内联 SVG，currentColor 描边，随主题走）。 */
    const ICON_PATHS = {
      tokens: 'M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3zM4.5 7.7L12 12l7.5-4.3M12 12v8.6',
      today: 'M4 19V11m5.3 8V6m5.4 13v-7M20 19V9',
      clock: 'M12 7v5l3 2M12 3a9 9 0 100 18 9 9 0 000-18z',
      calendar: 'M4 7h16v13H4zM8 3v4m8-4v4M4 11h16',
      flame: 'M12 21c3.9 0 6-2.4 6-5.4 0-4.2-4.2-5.6-3.3-10.6-2.6.8-4.2 3.1-4.2 5 0 1.1.4 1.9.4 2.7 0 1.1-.8 1.8-1.7 1.8-1 0-1.9-.9-1.9-2.2-1 1.4-1.3 2.9-1.3 4.2C6 18.6 8.1 21 12 21z',
      refresh: 'M20 12a8 8 0 11-2.3-5.6M20 4v4h-4',
      zoom: 'M11 18a7 7 0 100-14 7 7 0 000 14zM16 16l4 4M8.5 11h5',
      back: 'M19 12H5m6-6l-6 6 6 6',
      update: 'M12 16V4m-5 5l5-5 5 5M5 20h14',
      alert: 'M12 8v5m0 3.5v.01M10.3 3.9L2.6 17.5A2 2 0 004.3 20.5h15.4a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
    }

    function Icon(props) {
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          focusable: 'false',
        },
        h('path', { d: ICON_PATHS[props.name] || ICON_PATHS.tokens }),
      )
    }

    /* ------------------------------------------------------------ 模型名称 */

    const MODEL_VENDORS = {
      deepseek: 'DeepSeek', claude: 'Claude', gpt: 'GPT', gemini: 'Gemini', qwen: 'Qwen',
      glm: 'GLM', kimi: 'Kimi', doubao: 'Doubao', llama: 'Llama', mistral: 'Mistral',
      grok: 'Grok', ernie: 'ERNIE', hunyuan: 'Hunyuan', minimax: 'MiniMax', yi: 'Yi',
      step: 'Step', o: 'OpenAI o',
    }

    /**
     * 无版本号的别名 → 归入对应家族。官方渠道的 `deepseek-flash` 就是 V4.1 Flash 的别名
     * （请求什么就回什么，日志里不会自带版本号）。
     */
    const MODEL_ALIASES = {
      'deepseek-flash': 'deepseek-v4-1-flash',
      'deepseek-pro': 'deepseek-v4-1-pro',
    }

    /**
     * 型号家族：用户只关心版本 + 档位，不关心供应商写法。
     * deepseek-v4-flash / deepseek-v4-flash-vision → v4 flash；deepseek-v4-1-flash / -economy → v4.1 flash；
     * 无版本别名按 MODEL_ALIASES 归并；其余保留各自的归一化 id。
     *
     * 只有 DeepSeek 自家型号才按 flash / pro 归族，而且 flash / pro 必须是独立的一段：
     * 旧实现对任何含 "pro" / "flash" 子串的 id 都套 DeepSeek 家族，gemini-2-5-pro 被叫成
     * 「DeepSeek V4.1 Pro」、glm-4-flash 被并进「DeepSeek V4.1 Flash」、deepseek-prover-v2 成了「V2 Pro」。
     */
    function modelFamily(id) {
      const text = String(id || '').toLowerCase()
      if (MODEL_ALIASES[text]) return MODEL_ALIASES[text]
      if (!/^deepseek(-|$)/.test(text)) return text
      const tier = /(^|-)pro(-|$)/.test(text) ? 'pro' : /(^|-)flash(-|$)/.test(text) ? 'flash' : ''
      if (!tier) return text
      // 版本号是家族的一部分：v4-flash 与 v4-1-flash 是两个家族
      const match = text.match(/-v(\d+)(?:-(\d+))?/)
      const version = match ? (match[2] ? `v${match[1]}-${match[2]}` : `v${match[1]}`) : ''
      const key = version ? `deepseek-${version}-${tier}` : `deepseek-${tier}`
      return MODEL_ALIASES[key] || key
    }

    /** deepseek-v4-1-flash → 「DeepSeek V4.1 Flash」；不带版本时就是「DeepSeek Flash」。 */
    function familyLabel(key) {
      const match = String(key).match(/^deepseek-(v\d+(?:-\d+)?-)?(flash|pro)$/)
      if (!match) return prettyModelName(key)
      const version = match[1] ? match[1].replace(/-$/, '').replace('-', '.').toUpperCase() : ''
      const tier = match[2] === 'flash' ? 'Flash' : 'Pro'
      return ['DeepSeek', version, tier].filter(Boolean).join(' ')
    }

    /** 把归一化后的模型 id 转成可读名字：deepseek-v4-1-flash → DeepSeek V4.1 Flash。 */
    function prettyModelName(id) {
      if (!id || id === 'unknown') return t('model.unknown')
      const parts = String(id).split('-').filter(Boolean)
      const out = []
      for (let index = 0; index < parts.length; index += 1) {
        const piece = parts[index]
        if (index === 0 && MODEL_VENDORS[piece]) {
          out.push(MODEL_VENDORS[piece])
          continue
        }
        if (/^v\d+$/.test(piece) && index + 1 < parts.length && /^\d+$/.test(parts[index + 1])) {
          out.push(`${piece.toUpperCase()}.${parts[index + 1]}`)
          index += 1
          continue
        }
        // 宿主把版本号里的点归一成了短横线：claude-3-5-sonnet → 「Claude 3.5 Sonnet」，gemini-2-5-pro → 「Gemini 2.5 Pro」
        if (/^\d+$/.test(piece) && index + 1 < parts.length && /^\d+$/.test(parts[index + 1])) {
          out.push(`${piece}.${parts[index + 1]}`)
          index += 1
          continue
        }
        out.push(piece.charAt(0).toUpperCase() + piece.slice(1))
      }
      return out.join(' ')
    }

    /* ------------------------------------------------------------ 活动图数据 */

    /** 活动图几何（SVG 用户单位）：格距 10、格子 8，三档共用同一坐标系，所以切换时高度不变。 */
    const ACT_PITCH = 10
    const ACT_CELL = 8
    const ACT_HEIGHT = 7 * ACT_PITCH - (ACT_PITCH - ACT_CELL)

    /**
     * 近 12 个月（53 周，周一起算）的活动数据：
     *   cells  每天一格：tokens / level（0–4，按非零日的四分位）/ future（今天之后）
     *   weeks  每周一列：tokens（周合计）/ cumulative（截至该周的全部用量，含窗口之前）
     *   months 月份标签所在列（相邻标签至少隔 3 列，冲突时丢掉靠前的残月）
     */
    function buildActivity(daily, today) {
      const byDate = indexDaily(daily)
      const todayStart = startOfDay(today)
      const todayKey = localDateKey(todayStart)
      const start = startOfWeek(addDays(todayStart, -(HEAT_WEEKS * 7 - 1)))
      const startKey = localDateKey(start)

      // 窗口之前的用量是「累计」的起点。键已校验为 YYYY-MM-DD（定长、补零），字典序即日期序。
      let baseline = 0
      for (const [key, entry] of byDate) {
        if (key < startKey) baseline += toNumber(entry.tokens)
      }

      const cells = []
      const weeks = []
      const monthStarts = []
      let running = baseline
      let windowTokens = 0
      for (let col = 0; ; col += 1) {
        const weekStart = addDays(start, col * 7)
        if (weekStart.getTime() > todayStart.getTime()) break
        let weekTokens = 0
        let lastKey = localDateKey(weekStart)
        for (let row = 0; row < 7; row += 1) {
          const date = addDays(weekStart, row)
          const key = localDateKey(date)
          const future = date.getTime() > todayStart.getTime()
          const entry = future ? null : byDate.get(key)
          const tokens = entry ? toNumber(entry.tokens) : 0
          if (!future) {
            weekTokens += tokens
            lastKey = key
          }
          if (date.getDate() === 1) monthStarts.push({ col, date })
          cells.push({ key, col, row, tokens, future, today: key === todayKey })
        }
        running += weekTokens
        windowTokens += weekTokens
        weeks.push({ col, startKey: localDateKey(weekStart), endKey: lastKey, tokens: weekTokens, cumulative: running })
      }

      const months = []
      for (const item of monthStarts) {
        const previous = months[months.length - 1]
        if (previous && item.col - previous.col < 3) months.pop()
        months.push({ col: item.col, label: monthLabel(item.date), key: localDateKey(item.date) })
      }
      if (months.length > 0 && months[0].col < 2 && months.length > 1 && months[1].col - months[0].col < 4) months.shift()

      // 四档阈值：非零日的 25 / 50 / 75 分位
      const values = cells
        .filter((cell) => !cell.future && cell.tokens > 0)
        .map((cell) => cell.tokens)
        .sort((left, right) => left - right)
      const quantile = (ratio) => values[Math.min(values.length - 1, Math.max(0, Math.floor(values.length * ratio)))]
      const thresholds = values.length > 0 ? [quantile(0.25), quantile(0.5), quantile(0.75)] : []
      const level = (value) => {
        if (!(value > 0) || thresholds.length === 0) return 0
        if (value <= thresholds[0]) return 1
        if (value <= thresholds[1]) return 2
        if (value <= thresholds[2]) return 3
        return 4
      }
      for (const cell of cells) cell.level = cell.future ? 0 : level(cell.tokens)

      return { columns: weeks.length, cells, weeks, months, windowTokens, baseline, todayKey }
    }

    /* ------------------------------------------------------------ 浮层 */

    /**
     * 悬浮浮层。先以 visibility:hidden 渲染，layout effect 里量出真实尺寸，再相对锚点定位：
     * 优先放在锚点上方，放不下就翻到下方，左右夹在面板可视区（.dps-root 与视口的交集）以内。
     * 用 position:fixed，但会量出包含块的实际原点再修正——祖先有 transform / 容器查询时也不会错位。
     */
    function Popover(props) {
      const ref = useRef(null)
      const anchor = props.anchor
      useLayoutEffect(() => {
        const element = ref.current
        if (!element || !anchor || typeof element.getBoundingClientRect !== 'function') return
        element.style.left = '0px'
        element.style.top = '0px'
        const origin = element.getBoundingClientRect()
        const viewportWidth = (typeof window !== 'undefined' && window.innerWidth) || origin.right + 1000
        const viewportHeight = (typeof window !== 'undefined' && window.innerHeight) || origin.bottom + 1000
        const root = typeof element.closest === 'function' ? element.closest('.dps-root') : null
        const area = root ? root.getBoundingClientRect() : { left: 0, top: 0, right: viewportWidth, bottom: viewportHeight }
        const bounds = {
          left: Math.max(area.left, 0) + 8,
          top: Math.max(area.top, 0) + 8,
          right: Math.min(area.right, viewportWidth) - 8,
          bottom: Math.min(area.bottom, viewportHeight) - 8,
        }
        const width = origin.width
        const height = origin.height
        const gap = 10
        const center = anchor.left + anchor.width / 2
        const left = Math.max(bounds.left, Math.min(center - width / 2, bounds.right - width))
        let top = anchor.top - gap - height
        if (top < bounds.top) {
          const below = anchor.top + anchor.height + gap
          top = below + height <= bounds.bottom ? below : Math.max(bounds.top, Math.min(top, bounds.bottom - height))
        }
        element.style.left = `${Math.round(left - origin.left)}px`
        element.style.top = `${Math.round(top - origin.top)}px`
        element.style.visibility = 'visible'
      })
      if (!anchor) return null
      return h(
        'div',
        { ref, className: 'dps-pop', role: 'tooltip', style: { left: '0px', top: '0px', visibility: 'hidden' } },
        props.children,
      )
    }

    /** 屏幕阅读器用的实时播报（键盘移动图表焦点时读出浮层内容）。 */
    function LiveText(props) {
      return h('span', { className: 'dps-sr', 'aria-live': 'polite', 'aria-atomic': 'true' }, props.text || '')
    }

    /* -------------------------------------------------------------- 活动图 */

    function weekdayLabel(row) {
      // 第 0 行是周一；2026-11-02 是周一，借它取本地化的星期名
      const date = new Date(2026, 10, 2 + row)
      return formatDate(date, isChineseLocale() ? { weekday: 'narrow' } : { weekday: 'short' })
    }

    function ActivityCard(props) {
      const today = props.today
      const [mode, setMode] = useState('day')
      const [active, setActive] = useState(null)
      const plotRef = useRef(null)
      const data = useMemo(() => buildActivity(props.daily, today), [props.daily, localDateKey(today)])
      const columns = Math.max(1, data.columns)
      const width = columns * ACT_PITCH - (ACT_PITCH - ACT_CELL)
      const height = ACT_HEIGHT
      const daily = mode === 'day'

      let maxValue = 0
      for (const week of data.weeks) maxValue = Math.max(maxValue, mode === 'total' ? week.cumulative : week.tokens)
      const scale = niceScale(maxValue > 0 ? maxValue : 1, 3)
      const yOf = (value) => height - (scale.max > 0 ? (value / scale.max) * height : 0)

      const cellAt = (col, row) => data.cells[col * 7 + row] || null
      const clampActive = (col, row) => {
        const safeCol = Math.max(0, Math.min(columns - 1, col))
        let safeRow = Math.max(0, Math.min(6, row))
        // 本周今天之后的格子不可选
        while (safeRow > 0 && cellAt(safeCol, safeRow) && cellAt(safeCol, safeRow).future) safeRow -= 1
        return { col: safeCol, row: safeRow }
      }

      const onMove = (event) => {
        const element = plotRef.current
        if (!element || typeof element.getBoundingClientRect !== 'function') return
        const rect = element.getBoundingClientRect()
        if (!(rect.width > 0)) return
        const unit = rect.width / width
        const col = Math.floor((event.clientX - rect.left) / unit / ACT_PITCH)
        const row = Math.floor((event.clientY - rect.top) / unit / ACT_PITCH)
        if (col < 0 || col >= columns) return
        const next = daily ? clampActive(col, row) : { col, row: 0 }
        if (daily && (row < 0 || row > 6 || (cellAt(col, row) && cellAt(col, row).future))) {
          if (active) setActive(null)
          return
        }
        if (!active || active.col !== next.col || active.row !== next.row) setActive(next)
      }

      const todayCell = data.cells.find((cell) => cell.today)
      const onKeyDown = (event) => {
        const current = active || (todayCell ? { col: todayCell.col, row: todayCell.row } : { col: columns - 1, row: 0 })
        let next = null
        if (event.key === 'ArrowLeft') next = { col: current.col - 1, row: current.row }
        else if (event.key === 'ArrowRight') next = { col: current.col + 1, row: current.row }
        else if (event.key === 'ArrowUp' && daily) next = { col: current.col, row: current.row - 1 }
        else if (event.key === 'ArrowDown' && daily) next = { col: current.col, row: current.row + 1 }
        else if (event.key === 'Home') next = { col: 0, row: current.row }
        else if (event.key === 'End') next = { col: columns - 1, row: current.row }
        else if (event.key === 'Escape') {
          setActive(null)
          return
        }
        if (!next) return
        if (typeof event.preventDefault === 'function') event.preventDefault()
        setActive(clampActive(next.col, daily ? next.row : 0))
      }
      const onFocus = () => {
        if (!active) setActive(todayCell ? { col: todayCell.col, row: daily ? todayCell.row : 0 } : { col: columns - 1, row: 0 })
      }

      // —— 图形 ——
      let layer
      if (daily) {
        layer = h(
          'g',
          { key: 'day', className: 'dps-act-layer', 'data-layer': 'day' },
          data.cells
            .filter((cell) => !cell.future)
            .map((cell) =>
              h('rect', {
                key: cell.key,
                className: 'dps-act-cell',
                x: cell.col * ACT_PITCH,
                y: cell.row * ACT_PITCH,
                width: ACT_CELL,
                height: ACT_CELL,
                rx: 1.8,
                'data-cell': cell.key,
                'data-tokens': cell.tokens,
                'data-level': cell.level,
                'data-today': cell.today ? 'true' : 'false',
              }),
            ),
        )
      } else if (mode === 'week') {
        layer = h(
          'g',
          { key: 'week', className: 'dps-act-layer', 'data-layer': 'week' },
          data.weeks.map((week) => {
            const top = yOf(week.tokens)
            const barHeight = week.tokens > 0 ? Math.max(0.8, height - top) : 0
            return h('rect', {
              key: week.startKey,
              className: 'dps-act-bar',
              x: week.col * ACT_PITCH,
              y: height - barHeight,
              width: ACT_CELL,
              height: barHeight,
              rx: 1.5,
              'data-week': week.startKey,
              'data-tokens': week.tokens,
              'data-active': active && active.col === week.col ? 'true' : 'false',
            })
          }),
        )
      } else {
        const points = data.weeks.map((week) => [week.col * ACT_PITCH + ACT_CELL / 2, yOf(week.cumulative)])
        const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point[0].toFixed(2)} ${point[1].toFixed(2)}`).join(' ')
        const area = points.length > 0 ? `${line} L${points[points.length - 1][0].toFixed(2)} ${height} L${points[0][0].toFixed(2)} ${height} Z` : ''
        const last = data.weeks[data.weeks.length - 1]
        layer = h(
          'g',
          { key: 'total', className: 'dps-act-layer', 'data-layer': 'total' },
          h('path', { className: 'dps-act-area', d: area }),
          h('path', {
            className: 'dps-act-line',
            d: line,
            'data-cumulative': 'true',
            'data-points': data.weeks.length,
            'data-last': last ? last.cumulative : 0,
            'data-first': data.weeks.length > 0 ? data.weeks[0].cumulative : 0,
          }),
          active && points[active.col]
            ? h('circle', { className: 'dps-act-dot', cx: points[active.col][0], cy: points[active.col][1], r: 2.4 })
            : null,
        )
      }

      const grid = daily
        ? null
        : h(
            'g',
            { className: 'dps-act-grid', 'aria-hidden': true },
            scale.ticks.map((tick) => h('line', { key: tick, x1: 0, x2: width, y1: yOf(tick), y2: yOf(tick) })),
          )

      let highlight = null
      if (active) {
        if (daily) {
          highlight = h('rect', {
            className: 'dps-act-focus',
            x: active.col * ACT_PITCH - 1,
            y: active.row * ACT_PITCH - 1,
            width: ACT_CELL + 2,
            height: ACT_CELL + 2,
            rx: 2.6,
          })
        } else {
          highlight = h('rect', {
            className: 'dps-act-band',
            x: active.col * ACT_PITCH - 1,
            y: 0,
            width: ACT_CELL + 2,
            height,
            rx: 2,
          })
        }
      }

      // —— 浮层 ——
      let tip = null
      let liveText = ''
      if (active && plotRef.current && typeof plotRef.current.getBoundingClientRect === 'function') {
        const rect = plotRef.current.getBoundingClientRect()
        const unit = rect.width / width
        const week = data.weeks[active.col]
        let title = ''
        let value = 0
        let anchorTop = rect.top
        if (daily) {
          const cell = cellAt(active.col, active.row)
          if (cell) {
            title = formatDate(parseDateKey(cell.key), { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })
            value = cell.tokens
            anchorTop = rect.top + active.row * ACT_PITCH * unit
          }
        } else if (week) {
          const startDate = parseDateKey(week.startKey)
          const endDate = parseDateKey(week.endKey)
          const short = { month: 'short', day: 'numeric' }
          if (mode === 'week') {
            title = t('tip.weekRange', { start: formatDate(startDate, short), end: formatDate(endDate, short) })
            value = week.tokens
          } else {
            title = t('tip.through', { date: formatDate(endDate, { year: 'numeric', month: 'short', day: 'numeric' }) })
            value = week.cumulative
          }
          anchorTop = rect.top + yOf(value) * unit
        }
        const valueText = value > 0 ? t('tip.tokens', { value: formatTokens(value) }) : t('tip.none')
        liveText = `${title} ${valueText}`
        tip = h(
          Popover,
          {
            anchor: {
              left: rect.left + active.col * ACT_PITCH * unit,
              top: anchorTop,
              width: ACT_CELL * unit,
              height: daily ? ACT_CELL * unit : 1,
            },
          },
          h('div', { className: 'dps-pop-title' }, title),
          h('div', { className: 'dps-pop-value', 'data-dps-field': 'tip-value' }, valueText),
        )
      }

      // —— 左侧标签：每天档是星期，另外两档是纵轴刻度 ——
      const gutter = daily
        ? [0, 2, 4].map((row) =>
            h(
              'span',
              { key: `r${row}`, style: { top: `${((row * ACT_PITCH + ACT_CELL / 2) / height) * 100}%` } },
              weekdayLabel(row),
            ),
          )
        : scale.ticks
            .filter((tick) => tick > 0)
            .map((tick) => h('span', { key: `t${tick}`, style: { top: `${(yOf(tick) / height) * 100}%` } }, formatAxis(tick)))

      // 图例行三档都占位（非每天档只是隐藏内容），切换时卡片高度不变
      const legend = h(
        'div',
        { className: 'dps-act-legend', 'aria-hidden': true, 'data-hidden': daily ? 'false' : 'true' },
        h('span', null, t('legend.less')),
        [0, 1, 2, 3, 4].map((level) => h('i', { key: level, 'data-level': level })),
        h('span', null, t('legend.more')),
      )

      return h(
        'section',
        { className: 'dps-panel dps-act', 'data-dps-card': 'activity', 'data-mode': mode },
        h(
          'header',
          { className: 'dps-panel-head' },
          h(
            'div',
            { className: 'dps-panel-title' },
            h('h2', null, t('section.activity')),
            h(
              'span',
              { className: 'dps-panel-meta', 'data-dps-field': 'window-total', 'data-value': data.windowTokens },
              `${t('note.range')} · ${formatTokens(data.windowTokens)}`,
            ),
          ),
          h(Segmented, {
            control: 'activity-mode',
            label: t('section.activity'),
            value: mode,
            onChange: (next) => {
              setMode(next)
              setActive(null)
            },
            options: [
              { id: 'day', label: t('mode.day') },
              { id: 'week', label: t('mode.week') },
              { id: 'total', label: t('mode.total') },
            ],
          }),
        ),
        h(
          'div',
          { className: 'dps-act-body' },
          h('div', { className: 'dps-act-gutter', 'data-kind': daily ? 'weekday' : 'axis', 'aria-hidden': true }, gutter),
          h(
              'div',
              {
                ref: plotRef,
                className: 'dps-act-plot',
                tabIndex: 0,
                role: 'group',
                'aria-label': t('aria.activity'),
                onMouseMove: onMove,
                onMouseLeave: () => setActive(null),
                onKeyDown,
                onFocus,
                onBlur: () => setActive(null),
              },
              h(
                'svg',
                {
                  className: 'dps-act-svg',
                  viewBox: `0 0 ${width} ${height}`,
                  'data-dps-chart': 'activity',
                  'aria-hidden': true,
                  focusable: 'false',
                },
                grid,
                highlight && !daily ? highlight : null,
                layer,
                highlight && daily ? highlight : null,
              ),
            ),
          h('span', { className: 'dps-act-corner', 'aria-hidden': true }),
          h(
            'div',
            { className: 'dps-act-months', 'aria-hidden': true },
            data.months.map((month) =>
              h(
                'span',
                {
                  key: month.key,
                  // 最右侧两列放不下整段标签：改为右对齐，避免溢出卡片
                  style: month.col > columns - 3 ? { right: 0 } : { left: `${((month.col * ACT_PITCH) / width) * 100}%` },
                },
                month.label,
              ),
            ),
          ),
        ),
        legend,
        h(LiveText, { text: liveText }),
        tip,
      )
    }

    /* ------------------------------------------------------------ 模型分布数据 */

    /** 模型分布自己的时间窗：日 / 周 / 月 各 12 个桶；前 6 个家族各自一段，其余合成「其他模型」。 */
    const MODEL_WINDOW = 12
    const MODEL_TOP = 6
    const SERIES_COLORS = ['var(--dps-s1)', 'var(--dps-s2)', 'var(--dps-s3)', 'var(--dps-s4)', 'var(--dps-s5)', 'var(--dps-s6)']
    const OTHER_COLOR = 'var(--dps-other)'

    /** 窗口内的桶（含没有活动的桶）：key + 起止日期。周一起算；本周/本月的终点截到今天。 */
    function modelBucketFrames(granularity, today) {
      const todayStart = startOfDay(today)
      const frames = []
      for (let offset = MODEL_WINDOW - 1; offset >= 0; offset -= 1) {
        if (granularity === 'month') {
          const start = new Date(todayStart.getFullYear(), todayStart.getMonth() - offset, 1)
          const last = new Date(start.getFullYear(), start.getMonth() + 1, 0)
          const key = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`
          frames.push({ key, start, end: last.getTime() > todayStart.getTime() ? todayStart : last })
        } else if (granularity === 'week') {
          const start = addDays(startOfWeek(todayStart), -offset * 7)
          const last = addDays(start, 6)
          frames.push({ key: localDateKey(start), start, end: last.getTime() > todayStart.getTime() ? todayStart : last })
        } else {
          const day = addDays(todayStart, -offset)
          frames.push({ key: localDateKey(day), start: day, end: day })
        }
      }
      return frames
    }

    function modelBucketKeyOf(date, granularity) {
      if (granularity === 'month') return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
      if (granularity === 'week') return localDateKey(startOfWeek(date))
      return localDateKey(date)
    }

    /**
     * 12 个桶 × 模型家族。全程原始整数：桶合计、家族合计、头部总计都是同一批整数相加，
     * 纵轴按最高的那根堆叠柱取整齐刻度。
     */
    function buildModelSeries(daily, granularity, today) {
      const buckets = modelBucketFrames(granularity, today).map((frame) => ({ ...frame, values: {}, total: 0 }))
      const index = new Map(buckets.map((bucket) => [bucket.key, bucket]))
      for (const entry of indexDaily(daily).values()) {
        const bucket = index.get(modelBucketKeyOf(parseDateKey(entry.date), granularity))
        if (!bucket) continue
        for (const [raw, amount] of Object.entries(entry.byModel || {})) {
          const value = toNumber(amount)
          if (!(value > 0)) continue
          const family = modelFamily(raw)
          bucket.values[family] = (bucket.values[family] || 0) + value
          bucket.total += value
        }
      }
      const familyTotals = new Map()
      for (const bucket of buckets) {
        for (const [family, value] of Object.entries(bucket.values)) familyTotals.set(family, (familyTotals.get(family) || 0) + value)
      }
      const ranked = [...familyTotals.entries()]
        .filter(([, value]) => value > 0)
        .sort((left, right) => right[1] - left[1] || (left[0] < right[0] ? -1 : 1))
      const top = ranked.slice(0, MODEL_TOP)
      const rest = ranked.slice(MODEL_TOP)
      const series = top.map(([family, value], position) => ({
        key: family,
        name: familyLabel(family),
        color: SERIES_COLORS[position],
        total: value,
        members: [family],
      }))
      if (rest.length > 0) {
        series.push({
          key: '__other',
          name: `${t('model.others')} (${rest.length})`,
          color: OTHER_COLOR,
          total: rest.reduce((sum, [, value]) => sum + value, 0),
          members: rest.map(([family]) => family),
        })
      }
      const restSet = new Set(rest.map(([family]) => family))
      let total = 0
      let max = 0
      for (const bucket of buckets) {
        bucket.segments = series.map((item) => {
          let value = 0
          if (item.key === '__other') {
            for (const [family, amount] of Object.entries(bucket.values)) if (restSet.has(family)) value += amount
          } else {
            value = bucket.values[item.key] || 0
          }
          return { key: item.key, value }
        })
        total += bucket.total
        max = Math.max(max, bucket.total)
      }
      return { granularity, buckets, series, total, axis: niceScale(max > 0 ? max : 1, 4) }
    }

    function bucketTick(bucket, granularity) {
      if (granularity === 'month') return monthLabel(bucket.start)
      return formatDate(bucket.start, { month: 'numeric', day: 'numeric' })
    }

    function bucketTitle(bucket, granularity) {
      if (granularity === 'month') return formatDate(bucket.start, { year: 'numeric', month: 'long' })
      if (granularity === 'week') {
        const short = { month: 'short', day: 'numeric' }
        return t('tip.weekRange', { start: formatDate(bucket.start, short), end: formatDate(bucket.end, short) })
      }
      return formatDate(bucket.start, { month: 'long', day: 'numeric', weekday: 'short' })
    }

    /* -------------------------------------------------------------- 模型分布 */

    function ModelCard(props) {
      const today = props.today
      const [granularity, setGranularity] = useState('week')
      const [active, setActive] = useState(null)
      const barsRef = useRef(null)
      const data = useMemo(() => buildModelSeries(props.daily, granularity, today), [props.daily, granularity, localDateKey(today)])
      const count = data.buckets.length
      const empty = data.total <= 0

      const indexFromEvent = (event) => {
        const element = barsRef.current
        if (!element || typeof element.getBoundingClientRect !== 'function') return null
        const rect = element.getBoundingClientRect()
        if (!(rect.width > 0)) return null
        const position = Math.floor(((event.clientX - rect.left) / rect.width) * count)
        return position >= 0 && position < count ? position : null
      }
      const onMove = (event) => {
        const position = indexFromEvent(event)
        if (position !== active) setActive(position)
      }
      const onKeyDown = (event) => {
        const current = active === null ? count - 1 : active
        let next = null
        if (event.key === 'ArrowLeft') next = Math.max(0, current - 1)
        else if (event.key === 'ArrowRight') next = Math.min(count - 1, current + 1)
        else if (event.key === 'Home') next = 0
        else if (event.key === 'End') next = count - 1
        else if (event.key === 'Escape') {
          setActive(null)
          return
        }
        if (next === null) return
        if (typeof event.preventDefault === 'function') event.preventDefault()
        setActive(next)
      }

      const ticks = data.axis.ticks
      const axisMax = data.axis.max

      const columns = data.buckets.map((bucket, position) => {
        const height = axisMax > 0 ? (bucket.total / axisMax) * 100 : 0
        return h(
          'div',
          {
            key: bucket.key,
            className: 'dps-mc-col',
            'data-bucket': bucket.key,
            'data-total': bucket.total,
            'data-active': active === position ? 'true' : 'false',
            'data-dim': active !== null && active !== position ? 'true' : 'false',
          },
          h(
            'div',
            { className: 'dps-mc-stack', style: { height: `${height}%` } },
            bucket.segments
              .filter((segment) => segment.value > 0)
              .map((segment) =>
                h('span', {
                  key: segment.key,
                  className: 'dps-mc-seg',
                  'data-series': segment.key,
                  'data-value': segment.value,
                  style: {
                    height: `${(segment.value / bucket.total) * 100}%`,
                    background: (data.series.find((item) => item.key === segment.key) || {}).color,
                  },
                }),
              ),
          ),
        )
      })

      let tip = null
      let liveText = ''
      if (active !== null && data.buckets[active] && barsRef.current && typeof barsRef.current.getBoundingClientRect === 'function') {
        const bucket = data.buckets[active]
        const rect = barsRef.current.getBoundingClientRect()
        const columnWidth = rect.width / count
        const top = rect.top + rect.height * (1 - (axisMax > 0 ? bucket.total / axisMax : 0))
        const title = bucketTitle(bucket, granularity)
        const rows = data.series
          .map((item, position) => ({ item, value: bucket.segments[position] ? bucket.segments[position].value : 0 }))
          .filter((row) => row.value > 0)
        liveText = `${title} ${t('tip.total')} ${formatTokens(bucket.total)}`
        tip = h(
          Popover,
          { anchor: { left: rect.left + active * columnWidth, top, width: columnWidth, height: 1 } },
          h('div', { className: 'dps-pop-title' }, title),
          rows.length === 0
            ? h('div', { className: 'dps-pop-value' }, t('tip.none'))
            : h(
                'div',
                { className: 'dps-pop-rows' },
                rows.map((row) =>
                  h(
                    'div',
                    { key: row.item.key, className: 'dps-pop-row' },
                    h('i', { style: { background: row.item.color } }),
                    h('span', { className: 'dps-pop-name' }, row.item.name),
                    h('span', { className: 'dps-pop-num' }, formatTokens(row.value)),
                  ),
                ),
                rows.length > 1
                  ? h(
                      'div',
                      { className: 'dps-pop-row dps-pop-sum' },
                      h('i', null),
                      h('span', { className: 'dps-pop-name' }, t('tip.total')),
                      h('span', { className: 'dps-pop-num' }, formatTokens(bucket.total)),
                    )
                  : null,
              ),
        )
      }

      const legend = data.series.length
        ? h(
            'ul',
            { className: 'dps-legend' },
            data.series.map((item) =>
              h(
                'li',
                {
                  key: item.key,
                  'data-series': item.key,
                  'data-value': item.total,
                  title: item.key === '__other' ? item.members.map(familyLabel).join('、') : undefined,
                },
                h('i', { style: { background: item.color } }),
                h('span', { className: 'dps-legend-name' }, item.name),
                h('span', { className: 'dps-legend-value' }, formatTokens(item.total)),
              ),
            ),
          )
        : null

      return h(
        'section',
        { className: 'dps-panel dps-mc', 'data-dps-card': 'model', 'data-grain': granularity, 'data-empty': empty ? 'true' : 'false' },
        h(
          'header',
          { className: 'dps-panel-head' },
          h(
            'div',
            { className: 'dps-panel-title' },
            h('h2', null, t('section.model')),
            h(
              'span',
              { className: 'dps-panel-meta', 'data-dps-field': 'model-total', 'data-value': data.total },
              t('chart.total', { value: formatTokens(data.total) }),
            ),
          ),
          h(Segmented, {
            control: 'model-grain',
            label: t('section.model'),
            value: granularity,
            onChange: (next) => {
              setGranularity(next)
              setActive(null)
            },
            options: [
              { id: 'day', label: t('grain.day') },
              { id: 'week', label: t('grain.week') },
              { id: 'month', label: t('grain.month') },
            ],
          }),
        ),
        h(
          'div',
          { className: 'dps-mc-chart' },
          h(
            'div',
            { className: 'dps-mc-axis', 'aria-hidden': true },
            ticks.map((tick) =>
              h('span', { key: tick, 'data-tick': tick, style: { bottom: `${(tick / axisMax) * 100}%` } }, empty && tick > 0 ? '' : formatAxis(tick)),
            ),
          ),
          h(
            'div',
            {
              className: 'dps-mc-plot',
              tabIndex: 0,
              role: 'group',
              'aria-label': t('aria.model'),
              onMouseMove: onMove,
              onMouseLeave: () => setActive(null),
              onKeyDown,
              onFocus: () => {
                if (active === null) setActive(count - 1)
              },
              onBlur: () => setActive(null),
            },
            h(
              'div',
              { className: 'dps-mc-grid', 'aria-hidden': true },
              ticks.map((tick) => h('i', { key: tick, style: { bottom: `${(tick / axisMax) * 100}%` } })),
            ),
            h('div', { ref: barsRef, className: 'dps-mc-bars', 'data-dps-chart': 'model', key: granularity }, columns),
            empty ? h('div', { className: 'dps-mc-empty' }, t('chart.empty')) : null,
          ),
          h('span', { className: 'dps-mc-corner', 'aria-hidden': true }),
          h(
            'div',
            { className: 'dps-mc-ticks', 'aria-hidden': true },
            data.buckets.map((bucket) => h('span', { key: bucket.key }, bucketTick(bucket, granularity))),
          ),
        ),
        legend,
        h(LiveText, { text: liveText }),
        tip,
      )
    }

    /* ------------------------------------------------------------ Token 构成 */

    /**
     * Token 构成（Cache Lens）的派生值。口径：
     *   总 Token        = totals.tokens（宿主按每步 max(totalTokens, input + output) 折叠）
     *   未缓存输入      = 总 Token − 缓存 − 输出（反推；不同供应商的 inputTokens 语义不一致，不能直接用）
     *   缓存命中率      = 缓存 ÷（缓存 + 未缓存输入）
     *   未缓存输入占比  = 未缓存输入 ÷（未缓存输入 + 输出）——放大视图的分母是「非缓存合计」
     * 上游不自洽（缓存 + 输出 > 总量）时按 输出 → 缓存 依次夹紧，保证三段互斥、合计恰好等于总量。
     */
    function deriveLens(totals) {
      const source = totals || {}
      const total = toNumber(source.tokens)
      const output = Math.min(toNumber(source.outputTokens), total)
      const cache = Math.min(toNumber(source.cacheReadTokens) + toNumber(source.cacheWriteTokens), total - output)
      const uncached = total - cache - output
      const uncachedTotal = uncached + output
      return {
        total,
        cache,
        uncached,
        output,
        uncachedTotal,
        hitRate: cache + uncached > 0 ? (cache / (cache + uncached)) * 100 : 0,
        uncachedShare: uncachedTotal > 0 ? (uncached / uncachedTotal) * 100 : 0,
      }
    }

    const LENS_COLORS = {
      cache: 'var(--dps-accent)',
      input: 'var(--dsw-alias-state-warn-primary)',
      output: 'var(--dsw-alias-state-success-primary)',
    }

    function LensCard(props) {
      const lens = useMemo(() => deriveLens(props.totals), [props.totals])
      const [zoomed, setZoomed] = useState(false)
      const [hover, setHover] = useState(null)
      const segmentRefs = useRef({})

      const denominator = zoomed ? lens.uncachedTotal : lens.total
      const share = (value) => (denominator > 0 ? (value / denominator) * 100 : 0)
      const rows = [
        { key: 'cache', label: t('lens.cache'), value: lens.cache, visible: !zoomed },
        { key: 'input', label: t('lens.input'), value: lens.uncached, visible: true },
        { key: 'output', label: t('lens.output'), value: lens.output, visible: true },
      ]

      const metrics = zoomed
        ? [
            { id: 'primary', label: t('lens.uncachedTotal'), value: lens.uncachedTotal, parts: [tokenParts(lens.uncachedTotal)] },
            { id: 'secondary', label: t('lens.uncachedShare'), value: lens.uncachedShare, text: formatPercent(lens.uncachedShare), swatch: 'input' },
          ]
        : [
            { id: 'primary', label: t('lens.total'), value: lens.total, parts: [tokenParts(lens.total)] },
            { id: 'secondary', label: t('lens.cacheHit'), value: lens.hitRate, text: formatPercent(lens.hitRate), swatch: 'cache', accent: true },
          ]

      let visibleBefore = false
      const segments = rows.map((row) => {
        const shown = row.visible && row.value > 0
        const separator = shown && visibleBefore
        if (shown) visibleBefore = true
        const ratio = row.visible ? share(row.value) : 0
        return h('span', {
          key: row.key,
          ref: (node) => {
            segmentRefs.current[row.key] = node
          },
          className: 'dps-lens-seg',
          'data-segment': row.key,
          'data-value': row.visible ? row.value : 0,
          'data-share': ratio,
          'data-sep': separator ? 'true' : 'false',
          'data-dim': hover && hover !== row.key ? 'true' : 'false',
          // 宽度严格按占比（flex-grow = 百分比）；非零段最少 3px 才看得见，但不把 0.2% 画成 20%
          style: { flexGrow: ratio, minWidth: shown ? '3px' : '0px', background: LENS_COLORS[row.key] },
          onMouseEnter: () => setHover(row.key),
          onMouseLeave: () => setHover(null),
        })
      })

      let tip = null
      const hovered = hover ? rows.find((row) => row.key === hover && row.visible) : null
      const hoveredNode = hovered ? segmentRefs.current[hovered.key] : null
      if (hovered && hoveredNode && typeof hoveredNode.getBoundingClientRect === 'function') {
        const rect = hoveredNode.getBoundingClientRect()
        tip = h(
          Popover,
          { anchor: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } },
          h('div', { className: 'dps-pop-title' }, hovered.label),
          h('div', { className: 'dps-pop-value' }, t('tip.tokens', { value: formatTokens(hovered.value) })),
          h(
            'div',
            { className: 'dps-pop-title' },
            `${formatPercent(share(hovered.value))} · ${zoomed ? t('lens.colShareUncached') : t('lens.colShareTotal')}`,
          ),
        )
      }

      return h(
        'section',
        { className: 'dps-panel dps-lens', 'data-dps-card': 'lens', 'data-zoomed': zoomed ? 'true' : 'false', 'data-denominator': denominator },
        h(
          'header',
          { className: 'dps-panel-head' },
          h('div', { className: 'dps-panel-title' }, h('h2', null, zoomed ? t('lens.uncachedTitle') : t('section.breakdown'))),
          h(
            'button',
            {
              type: 'button',
              className: 'dps-ghost',
              'data-dps-control': 'lens-zoom',
              'aria-pressed': zoomed ? 'true' : 'false',
              onClick: () => {
                setZoomed(!zoomed)
                setHover(null)
              },
            },
            h(Icon, { name: zoomed ? 'back' : 'zoom' }),
            zoomed ? t('lens.back') : t('lens.zoom'),
          ),
        ),
        h(
          'div',
          { className: 'dps-lens-metrics' },
          metrics.map((metric) =>
            h(
              'div',
              { key: metric.id, className: 'dps-metric', 'data-dps-metric': metric.id, 'data-value': metric.value, 'data-accent': metric.accent ? 'true' : 'false' },
              h(
                'div',
                { className: 'dps-metric-value' },
                metric.parts ? h(ValueParts, { parts: metric.parts }) : h('span', { className: 'dps-num' }, metric.text),
              ),
              h(
                'div',
                { className: 'dps-metric-label' },
                // 比率说的是哪一类，就用那一类的色块标出来（放大视图里是琥珀色的「未缓存输入」）
                metric.swatch ? h('i', { className: 'dps-lens-dot', style: { background: LENS_COLORS[metric.swatch] }, 'aria-hidden': true }) : null,
                metric.label,
              ),
            ),
          ),
        ),
        h('div', { className: 'dps-lens-bar', role: 'img', 'aria-label': t('aria.lens') }, segments),
        h(
          'div',
          { className: 'dps-lens-table', role: 'table' },
          h(
            'div',
            { className: 'dps-lens-row dps-lens-th', role: 'row' },
            h('span', { role: 'columnheader', 'aria-hidden': true }),
            h('span', { role: 'columnheader' }, t('lens.colType')),
            h('span', { role: 'columnheader' }, t('lens.colAmount')),
            h('span', { role: 'columnheader', 'data-dps-field': 'share-basis' }, zoomed ? t('lens.colShareUncached') : t('lens.colShareTotal')),
          ),
          // 放大视图只列未缓存输入 / 输出；第三行留一个等高的空位，切换时卡片高度不变、整页不跳
          zoomed ? h('div', { key: 'spacer', className: 'dps-lens-row', 'data-placeholder': 'true', 'aria-hidden': true }, h('i', { className: 'dps-lens-dot' }), h('span', null, '\u00a0')) : null,
          rows
            .filter((row) => row.visible)
            .map((row) =>
              h(
                'div',
                {
                  key: row.key,
                  className: 'dps-lens-row',
                  role: 'row',
                  'data-row': row.key,
                  'data-value': row.value,
                  'data-share': share(row.value),
                  'data-active': hover === row.key ? 'true' : 'false',
                  onMouseEnter: () => setHover(row.key),
                  onMouseLeave: () => setHover(null),
                },
                h('i', { className: 'dps-lens-dot', style: { background: LENS_COLORS[row.key] }, 'aria-hidden': true }),
                h('span', { className: 'dps-lens-name', role: 'cell' }, row.label),
                h('span', { className: 'dps-lens-value', role: 'cell' }, formatTokens(row.value)),
                h('span', { className: 'dps-lens-share', role: 'cell' }, formatPercent(share(row.value))),
              ),
            ),
        ),
        tip,
      )
    }

    /* ------------------------------------------------------------ 供应商分类 */

    function providerLabel(id) {
      if (id === '__other') return t('provider.other')
      const key = `provider.${id}`
      const text = t(key)
      return text === key ? String(id) : text
    }

    /** byProvider → 降序行；前 6 个各一行，其余合成「其他」。占比的分母是这一档的全部合计。 */
    function deriveProviders(source) {
      const entries = Object.entries(source || {})
        .map(([id, tokens]) => ({ id, tokens: toNumber(tokens) }))
        .filter((row) => row.tokens > 0)
        .sort((left, right) => right.tokens - left.tokens || (left.id < right.id ? -1 : 1))
      const total = entries.reduce((sum, row) => sum + row.tokens, 0)
      const rows = entries.slice(0, 6)
      const rest = entries.slice(6)
      if (rest.length > 0) rows.push({ id: '__other', tokens: rest.reduce((sum, row) => sum + row.tokens, 0) })
      return { total, rows: rows.map((row) => ({ ...row, share: total > 0 ? (row.tokens / total) * 100 : 0 })) }
    }

    function ProviderCard(props) {
      const [scope, setScope] = useState('today')
      const source = scope === 'today' ? (props.todayEntry && props.todayEntry.byProvider) || {} : (props.totals && props.totals.byProvider) || {}
      const data = useMemo(() => deriveProviders(source), [source])
      return h(
        'section',
        { className: 'dps-panel dps-prov', 'data-dps-card': 'provider', 'data-scope': scope },
        h(
          'header',
          { className: 'dps-panel-head' },
          h(
            'div',
            { className: 'dps-panel-title' },
            h('h2', null, t('section.provider')),
            h('span', { className: 'dps-panel-meta', 'data-dps-field': 'provider-total', 'data-value': data.total }, t('chart.total', { value: formatTokens(data.total) })),
          ),
          h(Segmented, {
            control: 'provider-scope',
            label: t('section.provider'),
            value: scope,
            onChange: setScope,
            options: [
              { id: 'today', label: t('toggle.today') },
              { id: 'all', label: t('toggle.all') },
            ],
          }),
        ),
        data.rows.length === 0
          ? h('div', { className: 'dps-prov-empty' }, t('chart.empty'))
          : h(
              'ul',
              { className: 'dps-prov-list' },
              data.rows.map((row) =>
                h(
                  'li',
                  { key: row.id, className: 'dps-prov-row', 'data-provider': row.id, 'data-value': row.tokens, 'data-share': row.share },
                  h('span', { className: 'dps-prov-name', title: providerLabel(row.id) }, providerLabel(row.id)),
                  h('span', { className: 'dps-prov-value' }, formatTokens(row.tokens)),
                  h('span', { className: 'dps-prov-share' }, formatPercent(row.share)),
                  h(
                    'span',
                    { className: 'dps-prov-track', 'aria-hidden': true },
                    h('span', { className: 'dps-prov-fill', style: { width: `${row.share}%`, minWidth: row.tokens > 0 ? '3px' : '0px' } }),
                  ),
                ),
              ),
            ),
      )
    }

    /* ------------------------------------------------------------------- 样式 */

    const CSS = `
.dps-root{
--dps-ink:var(--dsw-alias-label-primary);
--dps-muted:var(--dsw-alias-label-secondary);
--dps-faint:color-mix(in srgb,var(--dsw-alias-label-secondary) 72%,transparent);
--dps-page:var(--dsw-alias-bg-base);
--dps-card:var(--dsw-alias-bg-layer-1);
--dps-line:var(--dsw-alias-border-l2);
--dps-hair:var(--dsw-alias-border-l1);
--dps-accent:var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary));
--dps-on-accent:var(--dsw-alias-bg-base);
--dps-track:color-mix(in srgb,var(--dsw-alias-label-primary) 7%,transparent);
--dps-hover:color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent);
--dps-shadow:var(--dsw-alias-bg-mask-2,transparent);
--dps-radius:16px;
--dps-s1:var(--dps-accent);
--dps-s2:var(--dsw-alias-state-success-primary);
--dps-s3:var(--dsw-alias-state-warn-primary);
--dps-s4:color-mix(in srgb,var(--dps-accent) 55%,var(--dsw-alias-state-error-primary));
--dps-s5:color-mix(in srgb,var(--dps-accent) 50%,var(--dsw-alias-state-success-primary));
--dps-s6:var(--dsw-alias-state-error-primary);
--dps-other:color-mix(in srgb,var(--dsw-alias-label-secondary) 50%,transparent);
height:100%;min-height:0;overflow-y:auto;overflow-x:hidden;box-sizing:border-box;
background:var(--dps-page);color:var(--dps-ink);
font-size:13px;line-height:1.45;-webkit-font-smoothing:antialiased}
.dps-root *,.dps-root *::before,.dps-root *::after{box-sizing:border-box}
.dps-root button{font-family:inherit}
.dps-root :focus-visible{outline:2px solid var(--dps-accent);outline-offset:2px}
.dps-page{container-type:inline-size;container-name:dps;max-width:1240px;margin:0 auto;padding:28px 32px 56px;display:flex;flex-direction:column;gap:16px}
.dps-top{display:flex;align-items:center;gap:14px;min-width:0;padding:2px 2px 6px}
.dps-avatar{flex:0 0 auto;width:48px;height:48px;border-radius:14px;display:grid;place-items:center;background:var(--dps-ink);color:var(--dps-page);font-size:20px;font-weight:650;letter-spacing:-.01em;user-select:none}
.dps-who{min-width:0;display:flex;flex-direction:column;gap:3px}
.dps-name{font-size:20px;font-weight:650;line-height:1.15;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dps-handle{font-size:13px;color:var(--dps-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dps-actions{margin-left:auto;display:flex;align-items:center;gap:8px;flex:0 0 auto}
.dps-iconbtn{appearance:none;width:36px;height:36px;border-radius:10px;border:1px solid var(--dps-line);background:var(--dps-card);color:var(--dps-muted);display:grid;place-items:center;cursor:pointer;transition:color .15s ease,background-color .15s ease}
.dps-iconbtn:hover{color:var(--dps-ink);background:var(--dps-hover)}
.dps-iconbtn svg{width:16px;height:16px;display:block}
.dps-iconbtn[data-busy="true"] svg{animation:dps-spin .9s linear infinite}
.dps-update{appearance:none;height:36px;display:inline-flex;align-items:center;gap:7px;padding:0 14px;border:0;border-radius:10px;background:var(--dps-accent);color:var(--dps-on-accent);font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;transition:filter .15s ease}
.dps-update:hover{filter:brightness(1.06)}
.dps-update svg{width:15px;height:15px}
.dps-updating{display:inline-flex;align-items:center;gap:7px;height:36px;padding:0 12px;border-radius:10px;color:var(--dps-muted);font-size:13px;white-space:nowrap}
.dps-updating svg{width:15px;height:15px;animation:dps-spin .9s linear infinite}
@keyframes dps-spin{to{transform:rotate(360deg)}}
.dps-status{display:flex;align-items:center;gap:12px;min-height:42px;padding:9px 12px 9px 14px;border-radius:12px;border:1px solid var(--dps-line);background:var(--dps-card);font-size:13px;color:var(--dps-muted)}
.dps-status[data-kind="error"]{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 50%,var(--dps-line));color:var(--dps-ink)}
.dps-status-icon{display:grid;place-items:center;color:var(--dsw-alias-state-error-primary)}
.dps-status-icon svg{width:16px;height:16px}
.dps-status-text{white-space:nowrap}
.dps-status-detail{color:var(--dps-muted);font-variant-numeric:tabular-nums;flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dps-status-count{font-variant-numeric:tabular-nums;color:var(--dps-ink);min-width:52px;text-align:right}
.dps-progress{flex:1 1 auto;height:4px;border-radius:999px;background:var(--dps-track);overflow:hidden}
.dps-progress > span{display:block;height:100%;border-radius:inherit;background:var(--dps-accent);transition:width .4s ease}
.dps-btn{appearance:none;height:30px;padding:0 12px;border-radius:8px;border:1px solid var(--dps-line);background:var(--dps-card);color:var(--dps-ink);font-size:12.5px;cursor:pointer;white-space:nowrap;transition:background-color .15s ease}
.dps-btn:hover{background:var(--dps-hover)}
.dps-seg{position:relative;display:inline-grid;grid-auto-flow:column;grid-auto-columns:1fr;padding:2px;border-radius:9px;background:var(--dps-track);flex:0 0 auto}
.dps-seg-thumb{position:absolute;top:2px;bottom:2px;left:2px;width:calc((100% - 4px) / var(--count));transform:translateX(calc(var(--index) * 100%));border-radius:7px;background:var(--dps-card);box-shadow:0 0 0 1px var(--dps-line),0 1px 2px var(--dps-shadow);transition:transform .22s cubic-bezier(.3,.7,.2,1)}
.dps-seg button{appearance:none;position:relative;border:0;background:transparent;color:var(--dps-muted);font-size:12px;line-height:1;padding:7px 12px;border-radius:7px;cursor:pointer;white-space:nowrap;transition:color .15s ease}
.dps-seg button:hover{color:var(--dps-ink)}
.dps-seg button[aria-pressed="true"]{color:var(--dps-ink);font-weight:600}
.dps-kpis{display:grid;grid-template-columns:minmax(0,1.6fr) repeat(4,minmax(0,1fr));gap:12px}
.dps-kpi{min-width:0;display:flex;flex-direction:column;justify-content:space-between;gap:16px;padding:16px 18px 18px;border:1px solid var(--dps-line);border-radius:var(--dps-radius);background:var(--dps-card)}
.dps-kpi[data-hero="true"]{border-color:color-mix(in srgb,var(--dps-accent) 30%,var(--dps-line));background:color-mix(in srgb,var(--dps-accent) 5%,var(--dps-card))}
.dps-kpi-label{display:flex;align-items:center;gap:7px;min-width:0;font-size:12.5px;color:var(--dps-muted)}
.dps-kpi-label svg{width:15px;height:15px;flex:0 0 auto}
.dps-kpi-label span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dps-kpi[data-hero="true"] .dps-kpi-label svg{color:var(--dps-accent)}
.dps-kpi-body{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;min-width:0}
.dps-kpi-value{display:flex;align-items:baseline;flex-wrap:nowrap;white-space:nowrap;min-width:0;font-variant-numeric:tabular-nums}
.dps-num{font-size:28px;font-weight:650;line-height:1;letter-spacing:-.02em}
.dps-num-empty{color:var(--dps-faint);font-weight:500}
.dps-unit{font-size:13px;font-weight:500;color:var(--dps-muted);margin:0 7px 0 3px}
.dps-unit:last-child{margin-right:0}
.dps-kpi[data-hero="true"] .dps-num{font-size:34px}
.dps-spark{flex:0 1 150px;min-width:64px;height:32px;display:block}
.dps-spark rect{fill:color-mix(in srgb,var(--dps-accent) 40%,transparent)}
.dps-spark rect[data-zero="true"]{fill:var(--dps-track)}
.dps-spark rect[data-today="true"]{fill:var(--dps-accent)}
.dps-grid{display:grid;grid-template-columns:minmax(0,1.62fr) minmax(0,1fr);gap:16px;align-items:stretch}
.dps-side{min-width:0;display:flex;flex-direction:column;gap:16px}
@container dps (max-width:1040px){
.dps-kpis{grid-template-columns:repeat(4,minmax(0,1fr))}
.dps-kpi[data-hero="true"]{grid-column:1 / -1}
.dps-grid{grid-template-columns:minmax(0,1fr)}
.dps-side{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}
}
@container dps (max-width:720px){
.dps-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}
.dps-side{grid-template-columns:minmax(0,1fr)}
.dps-num{font-size:24px}
.dps-kpi[data-hero="true"] .dps-num{font-size:30px}
}
@media (prefers-reduced-motion:reduce){.dps-root *,.dps-root *::before,.dps-root *::after{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important}}

.dps-panel{min-width:0;display:flex;flex-direction:column;gap:16px;padding:18px 20px 20px;border:1px solid var(--dps-line);border-radius:var(--dps-radius);background:var(--dps-card)}
.dps-panel-head{display:flex;align-items:center;justify-content:space-between;gap:10px 14px;flex-wrap:wrap;min-height:30px}
.dps-panel-title{display:flex;align-items:baseline;gap:10px;min-width:0;flex-wrap:wrap}
.dps-panel-title h2{margin:0;font-size:14px;font-weight:650;line-height:1.3;color:var(--dps-ink)}
.dps-panel-meta{font-size:12.5px;color:var(--dps-muted);font-variant-numeric:tabular-nums;white-space:nowrap}
.dps-act-body{display:grid;grid-template-columns:40px minmax(0,1fr);grid-template-rows:auto auto;column-gap:8px;row-gap:6px}
.dps-act-gutter{position:relative;font-size:11px;color:var(--dps-faint);font-variant-numeric:tabular-nums}
.dps-act-gutter span{position:absolute;right:0;transform:translateY(-50%);line-height:1;white-space:nowrap}
.dps-act-plot{position:relative;min-width:0;border-radius:4px;cursor:default}
.dps-act-plot:focus-visible{outline-offset:6px}
.dps-act-svg{display:block;width:100%;height:auto;overflow:visible}
.dps-act-cell{fill:var(--dps-track)}
.dps-act-cell[data-level="1"],.dps-act-legend i[data-level="1"]{fill:color-mix(in srgb,var(--dps-accent) 28%,transparent);background:color-mix(in srgb,var(--dps-accent) 28%,transparent)}
.dps-act-cell[data-level="2"],.dps-act-legend i[data-level="2"]{fill:color-mix(in srgb,var(--dps-accent) 50%,transparent);background:color-mix(in srgb,var(--dps-accent) 50%,transparent)}
.dps-act-cell[data-level="3"],.dps-act-legend i[data-level="3"]{fill:color-mix(in srgb,var(--dps-accent) 74%,transparent);background:color-mix(in srgb,var(--dps-accent) 74%,transparent)}
.dps-act-cell[data-level="4"],.dps-act-legend i[data-level="4"]{fill:var(--dps-accent);background:var(--dps-accent)}
.dps-act-cell[data-today="true"]{stroke:var(--dps-ink);stroke-width:1.25;vector-effect:non-scaling-stroke}
.dps-act-focus{fill:none;stroke:var(--dps-ink);stroke-width:1.6;vector-effect:non-scaling-stroke;pointer-events:none}
.dps-act-band{fill:var(--dps-hover)}
.dps-act-bar{fill:color-mix(in srgb,var(--dps-accent) 72%,transparent);transition:fill .12s ease}
.dps-act-bar[data-active="true"]{fill:var(--dps-accent)}
.dps-act-grid line{stroke:var(--dps-line);stroke-width:1;stroke-dasharray:2 3;vector-effect:non-scaling-stroke}
.dps-act-area{fill:color-mix(in srgb,var(--dps-accent) 15%,transparent)}
.dps-act-line{fill:none;stroke:var(--dps-accent);stroke-width:2;stroke-linejoin:round;stroke-linecap:round;vector-effect:non-scaling-stroke}
.dps-act-dot{fill:var(--dps-card);stroke:var(--dps-accent);stroke-width:2;vector-effect:non-scaling-stroke}
.dps-act-months{position:relative;height:14px;font-size:11px;line-height:14px;color:var(--dps-faint)}
.dps-act-months span{position:absolute;top:0;white-space:nowrap}
.dps-act-legend{display:flex;align-items:center;justify-content:flex-end;gap:3px;margin-top:-6px;font-size:11px;color:var(--dps-faint)}
.dps-act-legend[data-hidden="true"]{visibility:hidden}
.dps-act-legend span{margin:0 5px}
.dps-act-legend i{display:block;width:10px;height:10px;border-radius:2.5px;background:var(--dps-track)}
.dps-pop{position:fixed;z-index:60;pointer-events:none;min-width:128px;max-width:320px;padding:8px 11px 9px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dps-line);box-shadow:0 10px 30px var(--dps-shadow);color:var(--dps-ink);font-size:12px;line-height:1.5}
.dps-pop-title{font-size:11.5px;color:var(--dps-muted);white-space:nowrap}
.dps-pop-value{font-size:13px;font-weight:650;font-variant-numeric:tabular-nums;white-space:nowrap}
.dps-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.dps-mc{height:100%}
.dps-mc-chart{flex:1 1 auto;min-height:250px;display:grid;grid-template-columns:44px minmax(0,1fr);grid-template-rows:minmax(200px,1fr) auto;column-gap:8px;row-gap:8px}
.dps-mc-axis{position:relative;font-size:11px;color:var(--dps-faint);font-variant-numeric:tabular-nums}
.dps-mc-axis span{position:absolute;right:0;transform:translateY(50%);line-height:1;white-space:nowrap}
.dps-mc-plot{position:relative;min-width:0;border-radius:4px}
.dps-mc-plot:focus-visible{outline-offset:4px}
.dps-mc-grid{position:absolute;inset:0;pointer-events:none}
.dps-mc-grid i{position:absolute;left:0;right:0;height:0;border-top:1px dashed var(--dps-line)}
.dps-mc-grid i:first-child{border-top-style:solid}
.dps-mc-bars{position:absolute;inset:0;display:grid;grid-template-columns:repeat(12,minmax(0,1fr))}
.dps-mc-col{position:relative;min-width:0;display:flex;align-items:flex-end;justify-content:center;border-radius:7px 7px 0 0;transition:opacity .15s ease,background-color .15s ease}
.dps-mc-col[data-active="true"]{background:var(--dps-hover)}
.dps-mc-col[data-dim="true"]{opacity:.45}
.dps-mc-stack{width:min(30px,58%);min-height:0;display:flex;flex-direction:column-reverse;border-radius:5px 5px 1.5px 1.5px;overflow:hidden}
.dps-mc-seg{display:block;flex:0 0 auto;width:100%}
.dps-mc-seg + .dps-mc-seg{box-shadow:inset 0 -1.5px 0 var(--dps-card)}
.dps-mc-empty{position:absolute;inset:0;display:grid;place-items:center;font-size:12.5px;color:var(--dps-faint);pointer-events:none}
.dps-mc-ticks{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));font-size:11px;color:var(--dps-faint);text-align:center;font-variant-numeric:tabular-nums}
.dps-mc-ticks span{white-space:nowrap;overflow:hidden}
.dps-legend{list-style:none;margin:0;padding:2px 0 0;display:flex;flex-wrap:wrap;gap:8px 18px;font-size:12px}
.dps-legend li{display:inline-flex;align-items:center;gap:7px;min-width:0}
.dps-legend i{width:9px;height:9px;border-radius:2.5px;flex:0 0 auto}
.dps-legend-name{color:var(--dps-muted);white-space:nowrap}
.dps-legend-value{color:var(--dps-ink);font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}
.dps-pop-rows{display:flex;flex-direction:column;gap:3px;margin-top:6px;min-width:190px}
.dps-pop-row{display:grid;grid-template-columns:8px minmax(0,1fr) auto;align-items:center;gap:8px;font-size:12px}
.dps-pop-row i{display:block;width:8px;height:8px;border-radius:2px}
.dps-pop-name{color:var(--dps-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dps-pop-num{font-weight:600;font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
.dps-pop-sum{margin-top:3px;padding-top:6px;border-top:1px solid var(--dps-line)}
.dps-pop-sum .dps-pop-name{color:var(--dps-ink)}
.dps-ghost{appearance:none;display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 10px 0 9px;border-radius:8px;border:1px solid var(--dps-line);background:transparent;color:var(--dps-muted);font-size:12.5px;cursor:pointer;white-space:nowrap;transition:color .15s ease,background-color .15s ease}
.dps-ghost:hover{color:var(--dps-ink);background:var(--dps-hover)}
.dps-ghost svg{width:15px;height:15px}
.dps-lens-metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.dps-metric{min-width:0}
.dps-metric-value{display:flex;align-items:baseline;white-space:nowrap;font-variant-numeric:tabular-nums}
.dps-metric-value .dps-num{font-size:28px}
.dps-metric[data-accent="true"] .dps-num{color:var(--dps-accent)}
.dps-metric-label{display:flex;align-items:center;gap:6px;margin-top:7px;font-size:12.5px;color:var(--dps-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dps-metric-label .dps-lens-dot{width:8px;height:8px;border-radius:2px;flex:0 0 auto}
.dps-lens-bar{display:flex;height:12px;border-radius:999px;overflow:hidden;background:var(--dps-track)}
.dps-lens-seg{display:block;height:100%;flex-shrink:1;flex-basis:0;transition:flex-grow .5s cubic-bezier(.3,.7,.2,1),min-width .5s ease,opacity .15s ease}
.dps-lens-seg[data-sep="true"]{border-left:2px solid var(--dps-card)}
.dps-lens-seg[data-dim="true"]{opacity:.35}
.dps-lens-table{display:flex;flex-direction:column;gap:1px;margin:0 -8px}
.dps-lens-row{display:grid;grid-template-columns:10px minmax(0,1fr) 84px 76px;align-items:center;column-gap:10px;padding:7px 8px;border-radius:8px;font-size:13px;transition:background-color .15s ease}
.dps-lens-row[data-active="true"]{background:var(--dps-hover)}
.dps-lens-row[data-placeholder="true"]{visibility:hidden;order:9}
.dps-lens-th{padding-top:0;padding-bottom:3px;font-size:11.5px;color:var(--dps-faint)}
.dps-lens-th span:nth-child(n+3),.dps-lens-value,.dps-lens-share{text-align:right}
.dps-lens-dot{display:block;width:10px;height:10px;border-radius:3px}
.dps-lens-name{color:var(--dps-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dps-lens-value{font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}
.dps-lens-share{color:var(--dps-muted);font-variant-numeric:tabular-nums;white-space:nowrap}
.dps-prov{flex:1 1 auto}
.dps-prov-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:14px}
.dps-prov-row{display:grid;grid-template-columns:minmax(0,1fr) auto 56px;align-items:baseline;column-gap:10px;row-gap:7px;font-size:13px}
.dps-prov-name{min-width:0;color:var(--dps-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dps-prov-value{font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}
.dps-prov-share{color:var(--dps-muted);font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
.dps-prov-track{grid-column:1 / -1;display:block;height:6px;border-radius:999px;background:var(--dps-track);overflow:hidden}
.dps-prov-fill{display:block;height:100%;border-radius:inherit;background:var(--dps-accent);transition:width .45s cubic-bezier(.3,.7,.2,1)}
.dps-prov-empty{flex:1 1 auto;display:grid;place-items:center;min-height:72px;font-size:12.5px;color:var(--dps-faint)}
`

    /* ------------------------------------------------------------ 通用组件 */

    /**
     * 样式注入：在首帧绘制前（layout effect）写入，并且总是写当前这份 CSS（热重载后不残留旧样式）。
     * 样式只有一个带 dps- 前缀的 <style>，常驻无副作用，不在卸载时删除（另一个实例可能还在用）。
     */
    function StyleTag() {
      useLayoutEffect(() => {
        if (typeof document === 'undefined' || !document.head) return
        let element = document.getElementById(STYLE_ID)
        if (!element) {
          element = document.createElement('style')
          element.id = STYLE_ID
          document.head.appendChild(element)
        }
        if (element.textContent !== CSS) element.textContent = CSS
      }, [])
      return null
    }

    /**
     * 分段开关。选中态用滑块表示（CSS 变量 --index / --count 定位），按钮带 aria-pressed，
     * data-dps-control / data-value 供测试与预览页定位。
     */
    function Segmented(props) {
      const options = props.options
      const index = Math.max(0, options.findIndex((option) => option.id === props.value))
      return h(
        'div',
        {
          className: 'dps-seg',
          role: 'group',
          'aria-label': props.label,
          'data-dps-control': props.control,
          style: { '--index': index, '--count': options.length },
        },
        h('span', { className: 'dps-seg-thumb', 'aria-hidden': true }),
        options.map((option) =>
          h(
            'button',
            {
              key: option.id,
              type: 'button',
              'data-value': option.id,
              'aria-pressed': option.id === props.value ? 'true' : 'false',
              onClick: () => {
                if (option.id !== props.value) props.onChange(option.id)
              },
            },
            option.label,
          ),
        ),
      )
    }

    /** 数字 + 单位分开排版：数字大、单位小。 */
    function ValueParts(props) {
      const parts = props.parts
      if (!parts) return h('span', { className: 'dps-num dps-num-empty' }, t('unit.none'))
      return parts.map((part, index) =>
        h(
          React.Fragment,
          { key: index },
          h('span', { className: 'dps-num' }, part.value),
          part.unit ? h('span', { className: 'dps-unit' }, part.unit) : null,
        ),
      )
    }

    /* ------------------------------------------------------------------ 页头 */

    function Header(props) {
      const identity = props.identity
      const update = props.update
      const initial = String(identity.avatar || identity.name || 'D').trim().charAt(0).toUpperCase() || 'D'
      const updateReady = Boolean(update && update.available && update.latest && update.latest !== update.installed)
      return h(
        'header',
        { className: 'dps-top' },
        h('div', { className: 'dps-avatar', 'aria-hidden': true }, initial),
        h(
          'div',
          { className: 'dps-who' },
          h('div', { className: 'dps-name', 'data-dps-field': 'name' }, identity.name || 'DSH'),
          h('div', { className: 'dps-handle', 'data-dps-field': 'handle' }, identity.handle || '@local'),
        ),
        h(
          'div',
          { className: 'dps-actions' },
          props.updating
            ? h(
                'span',
                { className: 'dps-updating', role: 'status', 'data-dps-field': 'updating' },
                h(Icon, { name: 'refresh' }),
                t('action.updating'),
              )
            : updateReady
              ? h(
                  'button',
                  { type: 'button', className: 'dps-update', 'data-dps-action': 'update', onClick: props.onUpdate },
                  h(Icon, { name: 'update' }),
                  t('action.update', { version: update.latest }),
                )
              : null,
          h(
            'button',
            {
              type: 'button',
              className: 'dps-iconbtn',
              'data-dps-action': 'refresh',
              'data-busy': props.busy ? 'true' : 'false',
              'aria-busy': props.busy ? 'true' : 'false',
              'aria-label': t('action.refresh'),
              title: t('action.refresh'),
              onClick: props.onRefresh,
            },
            h(Icon, { name: 'refresh' }),
          ),
        ),
      )
    }

    /* ---------------------------------------------------------------- 状态条 */

    /**
     * 只在有事可说时出现：首扫进度 / 后台重扫进度、读取失败（带重试）、没有任何会话。
     * 都是状态，不是说明文字。
     */
    function StatusBar(props) {
      const { snapshot, error, hasData } = props
      if (error) {
        return h(
          'div',
          { className: 'dps-status', 'data-kind': 'error', role: 'alert', 'data-dps-status': 'error' },
          h('span', { className: 'dps-status-icon' }, h(Icon, { name: 'alert' })),
          h('span', { className: 'dps-status-text' }, snapshot ? t('error.stale') : t('error.title')),
          h('span', { className: 'dps-status-detail' }, String((error && error.message) || '')),
          h(
            'button',
            { type: 'button', className: 'dps-btn', 'data-dps-action': 'retry', onClick: props.onRetry },
            t('action.retry'),
          ),
        )
      }
      if (!snapshot) return null
      const progress = snapshot.progress || {}
      const done = toNumber(progress.done)
      const total = toNumber(progress.total)
      if (snapshot.scanning) {
        const ratio = total > 0 ? Math.min(1, done / total) : 0
        return h(
          'div',
          { className: 'dps-status', 'data-kind': 'scan', role: 'status', 'data-dps-status': 'scanning' },
          h('span', { className: 'dps-status-text' }, t('status.loading')),
          h(
            'span',
            {
              className: 'dps-progress',
              role: 'progressbar',
              'aria-valuemin': 0,
              'aria-valuemax': total || 1,
              'aria-valuenow': total > 0 ? done : 0,
            },
            h('span', { style: { width: `${ratio * 100}%` } }),
          ),
          total > 0 ? h('span', { className: 'dps-status-count', 'data-dps-field': 'progress' }, `${done}/${total}`) : null,
        )
      }
      if (!hasData) {
        return h(
          'div',
          { className: 'dps-status', 'data-kind': 'empty', role: 'status', 'data-dps-status': 'empty' },
          h('span', { className: 'dps-status-text' }, t('empty.title')),
        )
      }
      return null
    }

    /* -------------------------------------------------------------- 指标卡 */

    function Sparkline(props) {
      const points = props.points || []
      let max = 0
      for (const point of points) max = Math.max(max, point.tokens)
      const pitch = 7
      const width = points.length * pitch - 2
      const height = 32
      return h(
        'svg',
        {
          className: 'dps-spark',
          viewBox: `0 0 ${Math.max(width, 1)} ${height}`,
          preserveAspectRatio: 'none',
          role: 'img',
          'aria-label': t('aria.spark'),
        },
        points.map((point, index) => {
          // 非零的天至少 2px 高，零值画一条底线；比例本身不夸大。
          const barHeight = point.tokens > 0 && max > 0 ? Math.max(2, (point.tokens / max) * height) : 2
          return h('rect', {
            key: point.key,
            x: index * pitch,
            y: height - barHeight,
            width: pitch - 2,
            height: barHeight,
            rx: 1.2,
            'data-today': point.today ? 'true' : 'false',
            'data-zero': point.tokens > 0 ? 'false' : 'true',
          })
        }),
      )
    }

    function Kpi(props) {
      return h(
        'div',
        {
          className: 'dps-kpi',
          'data-dps-kpi': props.id,
          'data-value': props.raw === undefined ? '' : String(props.raw),
          'data-hero': props.hero ? 'true' : 'false',
        },
        h('div', { className: 'dps-kpi-label' }, h(Icon, { name: props.icon }), h('span', null, props.label)),
        h(
          'div',
          { className: 'dps-kpi-body' },
          h('div', { className: 'dps-kpi-value', 'data-dps-field': 'value' }, h(ValueParts, { parts: props.parts })),
          props.extra || null,
        ),
      )
    }

    function KpiStrip(props) {
      const k = props.kpis
      const ready = props.ready
      const tokenValue = (value) => {
        const parts = tokenParts(value)
        return [parts]
      }
      const dayValue = (value) => [{ value: String(Math.max(0, Math.round(toNumber(value)))), unit: t('unit.day') }]
      return h(
        'section',
        { className: 'dps-kpis', 'data-dps-card': 'kpis' },
        h(Kpi, {
          id: 'tokens',
          icon: 'tokens',
          hero: true,
          label: t('stat.tokens'),
          raw: ready ? k.tokens : undefined,
          parts: ready ? tokenValue(k.tokens) : null,
          extra: h(Sparkline, { points: ready ? k.spark : [] }),
        }),
        h(Kpi, { id: 'today', icon: 'today', label: t('stat.today'), raw: ready ? k.today : undefined, parts: ready ? tokenValue(k.today) : null }),
        h(Kpi, {
          id: 'longestTurn',
          icon: 'clock',
          label: t('stat.longestTurn'),
          raw: ready ? k.longestTurnMs : undefined,
          parts: ready ? durationParts(k.longestTurnMs) : null,
        }),
        h(Kpi, {
          id: 'longestStreak',
          icon: 'calendar',
          label: t('stat.longestStreak'),
          raw: ready ? k.longestStreak : undefined,
          parts: ready ? dayValue(k.longestStreak) : null,
        }),
        h(Kpi, {
          id: 'currentStreak',
          icon: 'flame',
          label: t('stat.currentStreak'),
          raw: ready ? k.currentStreak : undefined,
          parts: ready ? dayValue(k.currentStreak) : null,
        }),
      )
    }

    /* ------------------------------------------------------------------ 页面 */

    function ProfilePage() {
      useLocaleRevision()
      const { snapshot, error, refresh, reload } = useSnapshot()
      const mounted = useMounted()
      const [refreshing, setRefreshing] = useState(false)
      const [updating, setUpdating] = useState(false)

      const runRefresh = useCallback(async () => {
        setRefreshing(true)
        try {
          await refresh()
        } finally {
          if (mounted.current) setRefreshing(false)
        }
      }, [refresh, mounted])

      useEffect(() => {
        // 打开页面就请求一次后台补扫：页面先画旧快照，补扫开始后快照带 scanning，切到快轮询。
        runRefresh()
      }, [runRefresh])

      const totals = (snapshot && snapshot.totals) || {}
      const daily = snapshot && Array.isArray(snapshot.daily) ? snapshot.daily : []
      const scanning = Boolean(snapshot && snapshot.scanning)
      const hasData = toNumber(totals.calls) > 0 || toNumber(totals.tokens) > 0
      // 首次扫描还没有任何数据时显示「—」而不是一排 0
      const ready = Boolean(snapshot) && !(scanning && !hasData)
      const identity = (snapshot && snapshot.identity) || { name: 'DSH', handle: '@local' }
      const updateInfo = snapshot && snapshot.update ? snapshot.update : null

      const today = startOfDay(new Date())
      const todayKey = localDateKey(today)
      const kpis = useMemo(() => deriveKpis(snapshot, today), [snapshot, todayKey])
      const todayEntry = daily.find((entry) => entry && entry.date === todayKey) || null

      useEffect(() => {
        if (!updating || !updateInfo) return
        if (updateInfo.installed && updateInfo.installed === updateInfo.latest) setUpdating(false)
      }, [updating, updateInfo && updateInfo.installed, updateInfo && updateInfo.latest])

      const startUpdate = async () => {
        if (updating || !updateInfo) return
        const target = updateInfo.latest
        setUpdating(true)
        try {
          const response = await fetch(UPDATE_URL, { method: 'POST' })
          const result = await response.json().catch(() => null)
          // 宿主拒绝（非 registry 安装、已是最新…）就别空等 60 秒
          if (result && result.ok === false && result.error !== 'in-progress') {
            if (mounted.current) setUpdating(false)
            return
          }
        } catch {
          /* 重装期间路由会短暂消失，继续轮询 */
        }
        for (let attempt = 0; attempt < 40; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 1500))
          if (!mounted.current) return
          try {
            const response = await fetch(SNAPSHOT_URL, { cache: 'no-store' })
            const payload = await response.json()
            // 新版本的 client.js 只有重新加载页面才会生效
            if (payload && payload.update && payload.update.installed === target) {
              window.location.reload()
              return
            }
          } catch {
            /* 重装期间路由会短暂消失，继续等 */
          }
        }
        if (mounted.current) setUpdating(false)
      }

      return h(
        'div',
        { className: 'dps-root' },
        h(StyleTag, null),
        h(
          'div',
          { className: 'dps-page' },
          h(Header, {
            identity,
            update: updateInfo,
            updating,
            onUpdate: startUpdate,
            busy: refreshing || scanning,
            onRefresh: runRefresh,
          }),
          h(StatusBar, { snapshot, error, hasData, onRetry: reload }),
          h(KpiStrip, { kpis, ready }),
          h(ActivityCard, { daily, today }),
          h(
            'div',
            { className: 'dps-grid' },
            h(ModelCard, { daily, today }),
            h('div', { className: 'dps-side' }, h(LensCard, { totals }), h(ProviderCard, { todayEntry, totals })),
          ),
        ),
      )
    }

    /* ------------------------------------------------------------------ 注册 */

    function apply(ctx) {
      const slots = typeof ctx.get === 'function' ? ctx.get('slots') : ctx.slots
      if (!slots) {
        console.warn('[dsh-profile-stats] slots 服务不可用，跳过个人主页注册')
        return
      }

      if (!attachLocale(ctx) && typeof ctx.inject === 'function') {
        try {
          ctx.inject(['locale'], () => {
            attachLocale(ctx)
          })
        } catch (error) {
          console.warn('[dsh-profile-stats] 等待 locale 服务失败：', error && error.message ? error.message : error)
        }
      }

      slots.inject('sidebar.panellist', () =>
        slots.register(
          {
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 20,
            label: () => t('panel.title'),
          },
          ProfileIcon,
        ),
      )

      slots.inject('main', () =>
        slots.register(
          {
            name: 'main',
            key: PANEL_ID,
          },
          ProfilePage,
        ),
      )
    }

    return {
      inject: ['slots'],
      apply,
    }
  },
})
