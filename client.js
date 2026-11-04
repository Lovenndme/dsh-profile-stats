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
    const CELL_PITCH = 14

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

    /** 'YYYY-MM-DD' → 本地化的完整日期（总是带年份），周/累计档的悬浮提示用。 */
    function formatCellDateFull(key) {
      const date = parseDateKey(key)
      return date ? formatDate(date, { year: 'numeric', month: 'long', day: 'numeric' }) : String(key || '')
    }

    /** 'YYYY-MM-DD' → 本地化的「月日」（跨年时带年份），热力图悬浮提示用。 */
    function formatCellDate(key) {
      const date = parseDateKey(key)
      if (!date) return String(key || '')
      const sameYear = date.getFullYear() === new Date().getFullYear()
      return formatDate(date, sameYear ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' })
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

    /* ------------------------------------------------------------ 热力图数据 */

    function buildHeatmap(daily) {
      const totals = new Map()
      for (const entry of daily || []) {
        if (entry && typeof entry.date === 'string') {
          totals.set(entry.date, { tokens: toNumber(entry.tokens), calls: toNumber(entry.calls) })
        }
      }
      const today = startOfDay(new Date())
      // 一周从周一开始，与模型分布「按周」同一口径（旧实现这里按周日起算，同一周两处合计对不上）。
      const start = startOfWeek(addDays(today, -(HEAT_WEEKS * 7 - 1)))
      const startKey = localDateKey(start)
      // 「累计总量」是截至每周的全部用量：窗口之前的天也要算进起点，而不是从窗口第一天的 0 开始。
      let baseline = 0
      for (const [key, day] of totals) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(key) && key < startKey) baseline += day.tokens
      }

      const cells = []
      const weeks = []
      const months = []
      const cursor = new Date(start.getTime())
      let column = 0
      let previousMonth = -1
      let cumulative = baseline

      while (cursor.getTime() <= today.getTime()) {
        const weekStart = new Date(cursor.getTime())
        let weekTokens = 0
        let weekEnd = weekStart
        for (let row = 0; row < 7; row += 1) {
          const key = localDateKey(cursor)
          const future = cursor.getTime() > today.getTime()
          const day = future ? null : totals.get(key)
          const tokens = day ? day.tokens : 0
          if (!future) {
            weekTokens += tokens
            weekEnd = new Date(cursor.getTime())
          }
          cells.push({ key, tokens, future, column, date: new Date(cursor.getTime()) })
          cursor.setDate(cursor.getDate() + 1)
        }
        cumulative += weekTokens
        weeks.push({
          column,
          startKey: localDateKey(weekStart),
          endKey: localDateKey(weekEnd),
          weekTokens,
          cumulativeTokens: cumulative,
        })
        const month = weekStart.getMonth()
        if (month !== previousMonth) {
          previousMonth = month
          months.push({ column, label: monthLabel(weekStart) })
        }
        column += 1
      }

      // 三档热力图各用一套分位阈值：每天看单日用量，每周看周合计，累计看截至该周的累计值。
      const leveler = (sourceValues) => {
        const sorted = sourceValues.filter((value) => value > 0).sort((left, right) => left - right)
        if (sorted.length === 0) return () => 0
        const quantile = (ratio) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * ratio)))]
        const thresholds = [quantile(0.25), quantile(0.5), quantile(0.75)]
        return (value) => {
          if (!(value > 0)) return 0
          if (value <= thresholds[0]) return 1
          if (value <= thresholds[1]) return 2
          if (value <= thresholds[2]) return 3
          return 4
        }
      }

      let windowTokens = 0
      for (const cell of cells) windowTokens += cell.tokens

      // 月份标签按列定位，列距只有 14px，而「10月」这类标签约 25px 宽：
      // 起点若是被截断的残月（只覆盖几天），就会和下一个整月挤在一起。
      // 这里按估算宽度做一次排布：和下一个标签抢位置时让位（丢掉的总是残月）。
      const labelWidth = (label) => {
        let units = 0
        for (const char of String(label)) units += /[\u2e80-\u9fff\uff00-\uffef]/.test(char) ? 1.7 : 1
        return units * 6.6
      }
      const spacedMonths = []
      for (let index = 0; index < months.length; index += 1) {
        const current = months[index]
        const next = months[index + 1]
        if (next && (next.column - current.column) * CELL_PITCH < labelWidth(current.label) + 6) continue
        const previous = spacedMonths[spacedMonths.length - 1]
        if (previous && (current.column - previous.column) * CELL_PITCH < labelWidth(previous.label) + 6) continue
        spacedMonths.push(current)
      }

      return {
        cells,
        weeks,
        months: spacedMonths,
        windowTokens,
        columns: column,
        levels: {
          day: leveler(cells.map((cell) => cell.tokens)),
          week: leveler(weeks.map((week) => week.weekTokens)),
          total: leveler(weeks.map((week) => week.cumulativeTokens)),
        },
      }
    }

    function heatBackground(level) {
      if (level <= 0) return undefined
      const mix = [26, 46, 68, 92][level - 1]
      return `color-mix(in srgb, var(--dsw-alias-brand-primary) ${mix}%, var(--dsw-alias-bg-layer-2))`
    }

    function Heatmap(props) {
      const heat = props.heat
      const mode = props.mode === 'week' || props.mode === 'total' ? props.mode : 'day'
      const [tip, setTip] = useState(null)

      /** 某一列（一周）的聚合值：周合计或累计值；每天模式不用它。 */
      const weekOf = (cell) => heat.weeks[cell.column] || { weekTokens: 0, cumulativeTokens: 0 }

      const showTip = (cell) => (event) => {
        const target = event && event.currentTarget
        if (!target || typeof target.getBoundingClientRect !== 'function') return
        const rect = target.getBoundingClientRect()
        const viewportWidth = typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : 1200
        const halfWidth = 104
        const centerX = rect.left + rect.width / 2
        setTip({
          cell,
          week: weekOf(cell),
          x: Math.min(Math.max(centerX, halfWidth), Math.max(halfWidth, viewportWidth - halfWidth)),
          /** 靠近视口顶部时改到格子下方，避免浮层被裁掉。 */
          y: rect.top < 96 ? rect.bottom + 8 : rect.top - 8,
          below: rect.top < 96,
        })
      }
      const hideTip = () => setTip(null)

      const cells = heat.cells.map((cell) => {
        // 只有「每天」这一档尊重未来日期（今天之后留白）；
        // 「每周 / 累计」是按整列聚合的，整列同色才看得出这一周的份量。
        const level =
          mode === 'week'
            ? heat.levels.week(weekOf(cell).weekTokens)
            : mode === 'total'
              ? heat.levels.total(weekOf(cell).cumulativeTokens)
              : cell.future
                ? 0
                : heat.levels.day(cell.tokens)
        return h('div', {
          key: cell.key,
          className: 'dps-cell',
          'data-future': cell.future ? 'true' : 'false',
          onMouseEnter: showTip(cell),
          onMouseLeave: hideTip,
          style: level > 0 ? { background: heatBackground(level), boxShadow: 'none' } : undefined,
        })
      })

      // 悬浮浮层只保留「时间 + 缩写用量」两行：精确数字与请求数不再展示。
      const tipLines = (() => {
        if (!tip) return null
        let label
        let value
        if (mode === 'week') {
          label = t('tip.week', { date: formatCellDateFull(tip.week.startKey) })
          value = toNumber(tip.week.weekTokens)
        } else if (mode === 'total') {
          label = t('tip.cumulative', { date: formatCellDateFull(tip.week.startKey) })
          value = toNumber(tip.week.cumulativeTokens)
        } else {
          label = formatCellDate(tip.cell.key)
          value = toNumber(tip.cell.tokens)
        }
        return [
          h('div', { className: 'dps-tip-date', key: 'd' }, label),
          h(
            'div',
            { className: 'dps-tip-value', key: 'v' },
            value > 0 ? t('tip.tokens', { value: formatTokens(value) }) : t('tip.none'),
          ),
        ]
      })()

      const tooltip = tipLines
        ? h(
            'div',
            { className: 'dps-tip', style: { left: `${tip.x}px`, top: `${tip.y}px`, transform: `translate(-50%, ${tip.below ? '0' : '-100%'})` } },
            tipLines,
          )
        : null

      const monthNodes = heat.months.map((month) =>
        h(
          'span',
          { key: `${month.column}-${month.label}`, className: 'dps-month', style: { left: `${(month.column / heat.columns) * 100}%` } },
          month.label,
        ),
      )

      return h(
        'div',
        { className: 'dps-card dps-heat' },
        h(
          'div',
          { style: { display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' } },
          h('span', { className: 'dps-section-note' }, t('note.range')),
          h('span', { className: 'dps-section-note' }, t('note.total', { value: formatTokens(heat.windowTokens) })),
        ),
        h('div', null, h('div', { className: 'dps-heat-grid' }, cells), h('div', { className: 'dps-months' }, monthNodes)),
        tooltip,
      )
    }

    /**
     * Token 构成 = Cache Lens：横向分段占比条 + 三行明细，可放大到「非缓存」内部构成。
     *
     * 口径：不同供应商的 usage.inputTokens 语义不一致（有的已含缓存命中），所以
     * 不能直接用 input + cache + output 当初值。这里以 total（每步 max(totalTokens, input+output)）
     * 为准，未缓存输入由 total 反推：未缓存输入 = total − 缓存 − 输出，保证三段互斥且合计等于 total。
     */
    function Breakdown(props) {
      const totals = props.totals || {}
      const [zoomed, setZoomed] = useState(false)
      const [hover, setHover] = useState(null)
      const [tip, setTip] = useState(null)

      // 三段必须互斥、且合计恰好等于 total。上游不自洽（缓存 + 输出 > 总量）时按 输出 → 缓存 依次夹紧；
      // 旧实现只把未缓存输入夹到 0，另两段原样保留，三段合计会超过 100%。
      const total = toNumber(totals.tokens)
      const output = Math.min(toNumber(totals.outputTokens), total)
      const cache = Math.min(toNumber(totals.cacheReadTokens) + toNumber(totals.cacheWriteTokens), total - output)
      const uncached = total - cache - output

      // 三行明细始终齐全（某一类为 0 时显示 0，而不是整行消失）。
      const overall = [
        { key: 'cache', label: t('lens.cache'), value: cache, color: 'var(--dsw-alias-brand-primary)' },
        { key: 'input', label: t('lens.input'), value: uncached, color: 'var(--dsw-alias-label-primary)' },
        { key: 'output', label: t('lens.output'), value: output, color: 'var(--dsw-alias-state-success-primary)' },
      ]
      const uncachedTotal = uncached + output
      const inner = [
        { key: 'input', label: t('lens.input'), value: uncached, color: 'var(--dsw-alias-label-primary)' },
        { key: 'output', label: t('lens.output'), value: output, color: 'var(--dsw-alias-state-success-primary)' },
      ]

      const rows = zoomed ? inner : overall
      const denominator = zoomed ? uncachedTotal : total
      const share = (value) => (denominator > 0 ? (value / denominator) * 100 : 0)

      const primary = zoomed ? uncachedTotal : total
      const primaryLabel = zoomed ? t('lens.uncachedTotal') : t('lens.total')
      // 顶部第二个指标用官方口径：缓存命中率 = 缓存 ÷（缓存 + 未缓存输入），与官方用量弹窗一致。
      // 明细行的百分比仍是「占总量」，两者分母不同但各自自洽。
      // 全程用精确值参与运算，只有到渲染那一步才 toFixed。
      const cacheHitRate = cache + uncached > 0 ? (cache / (cache + uncached)) * 100 : 0
      const secondary = zoomed ? share(uncached) : cacheHitRate
      const secondaryLabel = zoomed ? t('lens.uncachedShare') : t('lens.cacheHit')

      const showTip = (row) => (event) => {
        const target = event && event.currentTarget
        if (!target || typeof target.getBoundingClientRect !== 'function') return
        const rect = target.getBoundingClientRect()
        const width = rect.width || 40
        const halfWidth = 110
        const centerX = rect.left + width / 2
        const viewportWidth = typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : 1200
        setHover(row.key)
        setTip({
          row,
          x: Math.min(Math.max(centerX, halfWidth), Math.max(halfWidth, viewportWidth - halfWidth)),
          y: rect.top - 8,
        })
      }
      const hideTip = () => {
        setHover(null)
        setTip(null)
      }

      const bar = h(
        'div',
        { className: 'dps-lens-bar', role: 'group' },
        rows.map((row) =>
          h('span', {
            key: row.key,
            className: 'dps-lens-seg',
            tabIndex: 0,
            'data-dim': hover && hover !== row.key ? 'true' : 'false',
            style: { width: `${share(row.value)}%`, background: row.color },
            onMouseEnter: showTip(row),
            onMouseLeave: hideTip,
            onFocus: showTip(row),
            onBlur: hideTip,
          }),
        ),
      )

      const detail = h(
        'div',
        { className: 'dps-lens-rows' },
        rows.map((row) =>
          h(
            'div',
            {
              key: row.key,
              className: 'dps-lens-row',
              'data-active': hover === row.key ? 'true' : 'false',
              onMouseEnter: () => setHover(row.key),
              onMouseLeave: () => setHover(null),
            },
            h('span', { className: 'dps-lens-dot', style: { background: row.color } }),
            h('span', { className: 'dps-lens-name' }, row.label),
            h('span', { className: 'dps-lens-value' }, formatTokens(row.value)),
            h('span', { className: 'dps-lens-share' }, `${share(row.value).toFixed(1)}%`),
          ),
        ),
      )

      const tooltip = tip
        ? h(
            'div',
            { className: 'dps-tip', style: { left: `${tip.x}px`, top: `${tip.y}px`, transform: 'translate(-50%, -100%)' } },
            h('div', { className: 'dps-tip-date' }, tip.row.label),
            h('div', { className: 'dps-tip-value' }, formatTokens(tip.row.value)),
            h('div', { className: 'dps-tip-date' }, `${share(tip.row.value).toFixed(1)}%`),
          )
        : null

      return h(
        'div',
        { className: 'dps-card dps-lens' },
        h(
          'div',
          { className: 'dps-chart-head' },
          h('div', { className: 'dps-chart-title' }, zoomed ? t('lens.uncachedTitle') : t('section.breakdown')),
        ),
        h(
          'div',
          { className: 'dps-lens-metrics' },
          h(
            'div',
            { className: 'dps-lens-metric' },
            h('div', { className: 'dps-lens-big' }, formatTokens(primary)),
            h('div', { className: 'dps-lens-cap' }, primaryLabel),
          ),
          h(
            'div',
            { className: 'dps-lens-metric' },
            h('div', { className: 'dps-lens-big dps-lens-accent' }, `${secondary.toFixed(1)}%`),
            h('div', { className: 'dps-lens-cap' }, secondaryLabel),
          ),
        ),
        bar,
        detail,
        zoomed
          ? h('div', { className: 'dps-lens-note' }, t('lens.basis'))
          : null,
        h(
          'button',
          {
            type: 'button',
            className: 'dps-lens-action',
            onClick: () => {
              setZoomed(!zoomed)
              hideTip()
            },
          },
          h(Icon, { name: zoomed ? 'back' : 'zoom' }),
          zoomed ? t('lens.back') : t('lens.zoom'),
        ),
        tooltip,
      )
    }
    /**
     * 宿主主题（dsh-client-ui-theme）里没有 --dsw-alias-state-idle-primary 这个 token，
     * 用它的那一段会是透明的；第五色改由两个已定义的状态色混出来。
     */
    const PROVIDER_COLORS = [
      'var(--dsw-alias-brand-primary)',
      'var(--dsw-alias-state-success-primary)',
      'var(--dsw-alias-state-warn-primary)',
      'var(--dsw-alias-state-error-primary)',
      'color-mix(in srgb, var(--dsw-alias-state-success-primary) 50%, var(--dsw-alias-state-error-primary))',
      'var(--dsw-alias-label-secondary)',
    ]

    function providerLabel(id) {
      if (id === '__other') return t('provider.other')
      const key = `provider.${id}`
      const text = t(key)
      return text === key ? String(id) : text
    }

    /**
     * 按「计费通道」拆分：每一步的 provider 决定它进了哪家账单。
     * 之所以要这块，是因为中转网关的「总 Token」把缓存命中重复加了一列，
     * 只有按 provider 拆开，才能和网关令牌对得上账。
     */
    function ProviderBreakdown(props) {
      const [scope, setScope] = useState('today')
      const today = props.today
      const totals = props.totals
      const source = scope === 'today' ? ((today && today.byProvider) || {}) : ((totals && totals.byProvider) || {})
      const rows = Object.entries(source)
        .map(([id, tokens]) => ({ id, tokens: toNumber(tokens) }))
        .filter((row) => row.tokens > 0)
        .sort((left, right) => right.tokens - left.tokens)

      const sum = rows.reduce((total, row) => total + row.tokens, 0)
      const visible = rows.slice(0, 6)
      const rest = rows.slice(6)
      if (rest.length > 0) {
        visible.push({ id: '__other', tokens: rest.reduce((total, row) => total + row.tokens, 0) })
      }

      const toggle = h(
        'div',
        { className: 'dps-switch' },
        [
          { id: 'today', label: t('toggle.today') },
          { id: 'all', label: t('toggle.all') },
        ].map((option) =>
          h(
            'button',
            {
              key: option.id,
              type: 'button',
              'data-active': scope === option.id ? 'true' : 'false',
              onClick: () => setScope(option.id),
            },
            option.label,
          ),
        ),
      )

      const list = h(
        'div',
        { className: 'dps-prov' },
        visible.map((row, index) =>
          h(
            'div',
            { className: 'dps-prov-row-v2', key: row.id },
            h(
              'div',
              { className: 'dps-prov-top' },
              h('span', { className: 'dps-prov-name', title: providerLabel(row.id) }, providerLabel(row.id)),
              h('span', { className: 'dps-prov-value' }, formatTokens(row.tokens)),
              h('span', { className: 'dps-prov-share' }, `${sum > 0 ? ((row.tokens / sum) * 100).toFixed(1) : '0.0'}%`),
            ),
            h(
              'span',
              { className: 'dps-prov-track' },
              h('span', {
                style: {
                  width: `${sum > 0 ? Math.max((row.tokens / sum) * 100, 1.5) : 0}%`,
                  background: PROVIDER_COLORS[index % PROVIDER_COLORS.length],
                },
              }),
            ),
          ),
        ),
      )

      return h(
        'div',
        { className: 'dps-card dps-prov-card' },
        h('div', { className: 'dps-prov-head' }, h('span', { className: 'dps-section-title' }, t('section.provider')), toggle),
        list,
      )
    }

    /** 模型系列配色（超出前几名的一律聚合成「其他」）。 */
    const MODEL_PALETTE = PROVIDER_COLORS
    /** 「其他模型」单独一色：旧实现复用了 MODEL_PALETTE[2]，和第三名家族同色、分不出来。 */
    const MODEL_OTHER_COLOR = 'color-mix(in srgb, var(--dsw-alias-label-secondary) 45%, transparent)'

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

    /** 模型图自带的范围开关（页面级范围生效时隐藏）。 */
    /** 通用分段开关：id / label 列表 + 当前值 + 回调。 */
    function segmentedSwitch(options, active, onPick) {
      return h(
        'div',
        { className: 'dps-switch' },
        options.map((option) =>
          h(
            'button',
            {
              key: option.id,
              type: 'button',
              'data-active': active === option.id ? 'true' : 'false',
              onClick: () => onPick(option.id),
            },
            option.label,
          ),
        ),
      )
    }

    /** 模型分布自己的时间窗：日 / 周 / 月 各 12 个桶。 */
    const MODEL_WINDOW = 12

    function modelBuckets(daily, granularity) {
      const byDate = new Map()
      for (const entry of daily) {
        if (entry && typeof entry.date === 'string') byDate.set(entry.date, entry)
      }
      const today = startOfDay(new Date())
      const keys = []
      if (granularity === 'day') {
        for (let offset = MODEL_WINDOW - 1; offset >= 0; offset -= 1) {
          keys.push(localDateKey(addDays(today, -offset)))
        }
      } else if (granularity === 'month') {
        for (let offset = MODEL_WINDOW - 1; offset >= 0; offset -= 1) {
          const point = new Date(today.getFullYear(), today.getMonth() - offset, 1)
          keys.push(`${point.getFullYear()}-${String(point.getMonth() + 1).padStart(2, '0')}`)
        }
      } else {
        const thisWeek = startOfWeek(today)
        for (let offset = MODEL_WINDOW - 1; offset >= 0; offset -= 1) {
          keys.push(localDateKey(addDays(thisWeek, -offset * 7)))
        }
      }

      const bucketOf = (dateKey) => {
        if (granularity === 'month') return dateKey.slice(0, 7)
        if (granularity === 'week') {
          const parts = dateKey.split('-')
          return localDateKey(startOfWeek(new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))))
        }
        return dateKey
      }

      const buckets = new Map(keys.map((key) => [key, { key, values: {} }]))
      for (const [dateKey, entry] of byDate) {
        const bucket = buckets.get(bucketOf(dateKey))
        if (!bucket) continue
        for (const [family, raw] of Object.entries(entry.byModel || {})) {
          const value = toNumber(raw)
          if (!(value > 0)) continue
          const group = modelFamily(family)
          bucket.values[group] = (bucket.values[group] || 0) + value
        }
      }
      return { list: keys.map((key) => buckets.get(key)), keys }
    }

    function bucketLabel(key, granularity) {
      // 月份名走 Intl（旧实现硬编码「月」，英文界面也显示「11月」）
      if (granularity === 'month') return monthLabel(new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 1))
      return key.slice(5).replace('-', '/')
    }

    /**
     * 模型分布：自带「日 / 周 / 月」与「柱状 / 折线」两套开关，不受页面级时间范围影响。
     * 柱状 = 前 6 个模型家族堆叠；折线 = 每桶总量 + 平均线。
     */
    /**
     * 模型分布：自带「日 / 周 / 月」开关，不受页面级时间范围影响。
     * 柱状 = 前 6 个模型家族堆叠（其余合成「其他模型」）。
     */
    function ModelChart(props) {
      const [granularity, setGranularity] = useState('week')
      const [tip, setTip] = useState(null)
      const daily = props.daily || []

      const { list: buckets } = modelBuckets(daily, granularity)
      const familyTotals = new Map()
      for (const bucket of buckets) {
        for (const [family, value] of Object.entries(bucket.values)) {
          familyTotals.set(family, (familyTotals.get(family) || 0) + value)
        }
      }
      const ranked = [...familyTotals.entries()].sort((left, right) => right[1] - left[1]).filter(([, value]) => value > 0)
      const rangeTotal = ranked.reduce((sum, [, value]) => sum + value, 0)

      const heads = h(
        'div',
        { className: 'dps-chart-head' },
        h(
          'div',
          { className: 'dps-chart-title' },
          t('section.model'),
          h('span', { className: 'dps-chart-total' }, t('chart.total', { value: formatTokens(rangeTotal) })),
        ),
        h(
          'div',
          { className: 'dps-chart-tools' },
          segmentedSwitch(
            [
              { id: 'day', label: t('grain.day') },
              { id: 'week', label: t('grain.week') },
              { id: 'month', label: t('grain.month') },
            ],
            granularity,
            setGranularity,
          ),
        ),
      )

      const showTip = (bucket) => (event) => {
        const clientX = typeof event.clientX === 'number' ? event.clientX : null
        const clientY = typeof event.clientY === 'number' ? event.clientY : null
        const viewportWidth = typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : 1200
        const viewportHeight = typeof window !== 'undefined' && window.innerHeight ? window.innerHeight : 800
        let x = viewportWidth / 2
        let y = 60
        if (clientX !== null && clientY !== null) {
          const tipWidth = 240
          x = clientX + 14 + tipWidth > viewportWidth - 8 ? clientX - tipWidth - 8 : clientX + 14
          y = clientY + 16 + 120 > viewportHeight - 8 ? clientY - 120 : clientY + 16
        }
        setTip({ bucket, x, y })
      }

      if (ranked.length === 0) {
        return h('div', { className: 'dps-card dps-chart' }, heads, h('div', { className: 'dps-chart-plot' }))
      }

      const top = ranked.slice(0, 6)
      const rest = ranked.slice(6)
      const series = top.map(([family], index) => ({
        key: family,
        name: familyLabel(family),
        color: MODEL_PALETTE[index % MODEL_PALETTE.length],
        total: familyTotals.get(family) || 0,
      }))
      if (rest.length > 0) {
        series.push({
          key: '__other',
          name: `${t('model.others')} (${rest.length})`,
          color: MODEL_OTHER_COLOR,
          total: rest.reduce((sum, [, value]) => sum + value, 0),
        })
      }
      const restKeys = new Set(rest.map(([family]) => family))
      const valueOf = (bucket, key) => {
        if (key !== '__other') return toNumber(bucket.values[key])
        let sum = 0
        for (const [family, value] of Object.entries(bucket.values)) {
          if (restKeys.has(family)) sum += value
        }
        return sum
      }

      let max = 0
      for (const bucket of buckets) {
        for (const item of series) max = Math.max(max, valueOf(bucket, item.key))
      }
      if (!(max > 0)) max = 1

      const step = niceStep(max)
      const axisMax = Math.max(step, Math.ceil(max / step) * step)
      const tickValues = []
      for (let value = 0; value <= axisMax + step / 1000; value += step) tickValues.push(value)

      const stride = Math.max(1, Math.ceil(buckets.length / 12))

      const plot = h(
        'div',
        { className: 'dps-chart-plot' },
        h(
          'div',
          { className: 'dps-chart-ticks' },
          tickValues.map((value) =>
            h(
              'div',
              { className: 'dps-chart-tick', key: value, style: { bottom: `${(value / axisMax) * 100}%` } },
              h('span', null, formatAxis(value)),
            ),
          ),
        ),
        h(
          'div',
          { className: 'dps-chart-scroll' },
          h(
            'div',
            { className: 'dps-chart-bars', key: `bar-${granularity}`, style: { minWidth: `${buckets.length * 14}px` } },
            buckets.map((bucket, index) =>
              h(
                'div',
                {
                  className: 'dps-chart-bucket',
                  key: bucket.key,
                  onMouseEnter: showTip(bucket),
                  onMouseMove: showTip(bucket),
                  onMouseLeave: () => setTip(null),
                },
                h(
                  'div',
                  { className: 'dps-chart-stack', style: { animationDelay: `${Math.min(index * 18, 320)}ms` } },
                  series
                    .slice()
                    .reverse()
                    .map((item) => {
                      const value = valueOf(bucket, item.key)
                      if (!(value > 0)) return null
                      return h('div', {
                        key: item.key,
                        className: 'dps-chart-seg',
                        style: {
                          height: `${axisMax > 0 ? (value / axisMax) * 100 : 0}%`,
                          background: item.color,
                        },
                      })
                    }),
                ),
                index % stride === 0
                  ? h('div', { className: 'dps-chart-label' }, bucketLabel(bucket.key, granularity))
                  : null,
              ),
            ),
          ),
        ),
      )

      const legend = h(
        'div',
        { className: 'dps-chart-legend' },
        series.map((item) =>
          h(
            'span',
            { className: 'dps-chart-legend-item', key: item.key },
            h('span', { className: 'dps-dot', style: { background: item.color } }),
            item.name,
            h('span', { className: 'dps-chart-legend-total' }, formatTokens(item.total)),
          ),
        ),
      )

      const tooltip = tip
        ? h(
            'div',
            { className: 'dps-tip', style: { left: `${tip.x}px`, top: `${tip.y}px`, transform: 'translate(0, 0)' } },
            h('div', { className: 'dps-tip-date' }, bucketLabel(tip.bucket.key, granularity)),
            series.map((item) => {
              const value = valueOf(tip.bucket, item.key)
              if (!(value > 0)) return null
              return h(
                'div',
                { className: 'dps-tip-row', key: item.key },
                h('span', { className: 'dps-dot', style: { background: item.color } }),
                h('span', null, item.name),
                h('span', { className: 'dps-tip-value' }, formatTokens(value)),
              )
            }),
          )
        : null

      return h('div', { className: 'dps-card dps-chart' }, heads, plot, legend, tooltip)
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

/* —— 过渡期：以下是尚未重做的卡片沿用的旧样式，随各卡片重做逐步删除 —— */
.dps-section{display:flex;flex-direction:column;gap:14px}
.dps-section-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap}
.dps-section-title{font-size:14px;font-weight:600}
.dps-section-note{font-size:12px;color:var(--dsw-alias-label-secondary)}
.dps-card{padding:14px;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1)}
.dps-heat{display:flex;flex-direction:column;gap:10px;overflow:visible}
.dps-heat-grid{display:grid;grid-auto-flow:column;grid-template-rows:repeat(7,auto);grid-auto-columns:minmax(0,1fr);gap:2px;width:100%}
.dps-cell{width:100%;aspect-ratio:1;height:auto;border-radius:2.5px;background:var(--dsw-alias-bg-layer-2);box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l1)}
.dps-cell[data-future="true"]{opacity:.35}
.dps-months{position:relative;height:14px;font-size:10px;color:var(--dsw-alias-label-secondary)}
.dps-tip{position:fixed;z-index:9999;pointer-events:none;transform:translate(-50%,-100%);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 10px;box-shadow:0 10px 28px var(--dps-shadow);white-space:nowrap;text-align:left}
.dps-tip-date{font-size:10px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.dps-tip-value{font-size:12px;line-height:1.5;font-weight:600;font-variant-numeric:tabular-nums}
.dps-prov-card{display:flex;flex-direction:column;gap:12px}
.dps-prov-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.dps-prov{display:flex;flex-direction:column;gap:9px}
.dps-prov-row{display:grid;grid-template-columns:132px minmax(60px,1fr) auto 48px;gap:10px;align-items:center;font-size:12px}
.dps-prov-name{color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dps-prov-bar{height:6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;display:block}
.dps-prov-bar > span{display:block;height:100%;border-radius:999px}
.dps-prov-value{font-variant-numeric:tabular-nums;font-weight:600;white-space:nowrap}
.dps-prov-share{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary);text-align:right}
.dps-chart{display:flex;flex-direction:column;gap:14px}
.dps-chart-head{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
.dps-chart-title{display:flex;align-items:baseline;gap:8px;font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dps-chart-tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dps-chart-total{font-size:12px;font-weight:400;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.dps-chart-legend{display:flex;align-items:center;justify-content:center;gap:16px;flex-wrap:wrap;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dps-chart-legend-item{display:inline-flex;align-items:center;gap:6px}
.dps-chart-legend-total{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;margin-left:2px}
.dps-chart-plot{position:relative;height:240px;min-width:0;flex:1 1 auto}
.dps-chart-ticks{position:absolute;left:0;right:0;top:0;bottom:18px;pointer-events:none}
.dps-chart-tick{position:absolute;left:0;right:0;border-top:1px solid var(--dsw-alias-border-l2);opacity:.55}
.dps-chart-tick > span{position:absolute;left:0;top:-8px;font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;padding-right:6px}
.dps-chart-scroll{position:absolute;left:40px;right:0;top:0;bottom:0;overflow-x:auto;overflow-y:hidden}
.dps-chart-bars{position:relative;height:100%;display:flex;align-items:stretch;gap:6px}
@keyframes dps-grow{from{transform:scaleY(0)}to{transform:scaleY(1)}}
.dps-chart-stack{transform-origin:bottom center;animation:dps-grow .58s cubic-bezier(.22,.61,.36,1) both}
@media (prefers-reduced-motion:reduce){.dps-chart-stack{animation:none}}
.dps-chart-bucket{flex:1 1 0;min-width:0;min-height:0;height:100%;display:flex;flex-direction:column}
.dps-chart-stack{display:flex;flex-direction:column;justify-content:flex-end;align-items:stretch;width:100%;max-width:22px;margin:0 auto;flex:1 1 0;min-height:0;border-radius:2px 2px 0 0;overflow:hidden}
.dps-chart-seg{width:100%;min-height:0;transition:opacity .12s ease-out}
.dps-chart-bucket:hover .dps-chart-seg{opacity:.82}
.dps-chart-label{height:18px;line-height:18px;text-align:center;font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden}
.dps-tip-row{display:flex;align-items:center;gap:6px;font-size:12px;white-space:nowrap}
.dps-tip-row .dps-dot{width:8px;height:8px;border-radius:2px;flex:0 0 auto}
.dps-tip-row .dps-tip-value{margin-left:auto;padding-left:12px}
.dps-switch{display:inline-flex;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;overflow:hidden}
.dps-switch button{appearance:none;border:none;background:transparent;color:var(--dsw-alias-label-secondary);font-size:11px;padding:4px 10px;cursor:pointer;font-family:inherit}
.dps-switch button[data-active="true"]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dps-month{position:absolute;top:0;white-space:nowrap}
.dps-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:7px;vertical-align:1px}
.dps-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.dps-lens{display:flex;flex-direction:column;gap:12px}
.dps-lens-metrics{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding-top:2px}
.dps-lens-big{font-size:26px;font-weight:700;letter-spacing:-.02em;font-variant-numeric:tabular-nums;line-height:1.1}
.dps-lens-accent{color:var(--dsw-alias-brand-primary)}
.dps-lens-cap{font-size:12px;color:var(--dsw-alias-label-secondary);margin-top:2px}
.dps-lens-bar{display:flex;width:100%;height:14px;border-radius:999px;overflow:hidden;background:var(--dsw-alias-bg-layer-2)}
.dps-lens-seg{display:block;height:100%;transition:width .26s ease,opacity .18s ease,filter .18s ease;min-width:2px;cursor:default}
.dps-lens-seg:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dps-lens-seg[data-dim="true"]{opacity:.45}
.dps-lens-rows{display:flex;flex-direction:column;gap:2px}
.dps-lens-row{display:grid;grid-template-columns:10px 1fr auto 52px;align-items:baseline;gap:10px;font-size:13px;padding:6px 4px;border-radius:8px;transition:background .18s ease}
.dps-lens-row[data-active="true"]{background:var(--dsw-alias-bg-layer-2)}
.dps-lens-dot{width:10px;height:10px;border-radius:50%}
.dps-lens-name{color:var(--dsw-alias-label-secondary)}
.dps-lens-value{font-weight:600;font-variant-numeric:tabular-nums;text-align:right}
.dps-lens-share{color:var(--dsw-alias-label-secondary);text-align:right;font-variant-numeric:tabular-nums}
.dps-lens-note{font-size:11px;color:var(--dsw-alias-label-secondary)}
.dps-lens-action{display:inline-flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:9px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;font-family:inherit;cursor:pointer;transition:border-color .18s ease,color .18s ease}
.dps-lens-action:hover,.dps-lens-action:focus-visible{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);outline:none}
.dps-lens-action svg{width:15px;height:15px}
@media (prefers-reduced-motion:reduce){.dps-lens-seg,.dps-lens-row,.dps-lens-action{transition:none}}
.dps-prov-track{height:8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
.dps-prov-track > span{display:block;height:100%;border-radius:999px}
.dps-prov-row-v2{display:flex;flex-direction:column;gap:8px}
.dps-prov-row-v2 + .dps-prov-row-v2{margin-top:14px}
.dps-prov-top{display:flex;align-items:baseline;gap:10px;font-size:13px}
.dps-prov-top .dps-prov-value{margin-left:auto;font-weight:600}
.dps-card{padding:18px 20px;border:1px solid var(--dps-line);border-radius:var(--dps-radius);background:var(--dps-card)}
.dps-section{display:flex;flex-direction:column;gap:12px}
.dps-section-title{font-size:14px;font-weight:600}
.dps-chart-plot{height:260px}
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
      const [activityMode, setActivityMode] = useState('day')

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
      const heat = useMemo(() => buildHeatmap(daily), [daily, todayKey])

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

      const activity = h(
        'div',
        { className: 'dps-section' },
        h(
          'div',
          { className: 'dps-section-head' },
          h('span', { className: 'dps-section-title' }, t('section.activity')),
          h(
            'div',
            { className: 'dps-switch' },
            [
              ['day', t('mode.day')],
              ['week', t('mode.week')],
              ['total', t('mode.total')],
            ].map(([id, label]) =>
              h(
                'button',
                {
                  key: id,
                  type: 'button',
                  'data-active': activityMode === id ? 'true' : 'false',
                  onClick: () => setActivityMode(id),
                },
                label,
              ),
            ),
          ),
        ),
        h(Heatmap, { heat, mode: activityMode, key: `heat-${activityMode}` }),
      )

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
          activity,
          h(
            'div',
            { className: 'dps-grid' },
            h(ModelChart, { daily }),
            h('div', { className: 'dps-side' }, h(Breakdown, { totals }), h(ProviderBreakdown, { today: todayEntry, totals })),
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
