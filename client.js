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
    const ALIAS_URL = '/api/dsh-profile-stats/alias'
    const BILLING_URL = '/api/dsh-profile-stats/billing'
    const PANEL_ID = 'profile'
    const STYLE_ID = 'dsh-profile-stats-style'
    /** 指标卡里的迷你柱：最近多少天。 */
    /** 活动图窗口：本周 + 之前 52 周。 */
    const ACTIVITY_WEEKS = 53

    /* -------------------------------------------------------------- 文案字典 */

    const EN = {
      'panel.title': 'Profile',
      'stat.today': 'Tokens today',
      'stat.longestTurn': 'Longest task',
      'stat.longestStreak': 'Longest streak',
      'stat.currentStreak': 'Current streak',
      'section.activity': 'Token activity',
      'section.model': 'Token by model',
      'section.breakdown': 'Token mix',
      'section.provider': 'Provider split',
      'mode.day': 'Daily',
      'mode.week': 'Weekly',
      'mode.total': 'Cumulative',
      'grain.day': 'Daily',
      'grain.week': 'Weekly',
      'grain.month': 'Monthly',
      'range.day': 'Today',
      'range.week': 'This week',
      'range.month': 'This month',
      'range.all': 'All time',
      'range.custom': 'Custom',
      'range.from': 'From',
      'range.to': 'To',
      'action.apply': 'Apply',
      'stat.streak': 'Active streak',
      'stat.best': 'best {n}d',
      'stat.todayHit': 'Cache hit today',
      'provider.rename': 'Rename',
      'section.project': 'Projects',
      'project.colName': 'Project',
      'project.colSubagent': 'Subagents',
      'project.unknown': 'Unknown project',
      'project.others': 'Other projects ({count})',
      'model.modeTokens': 'Tokens',
      'model.modeShare': 'Share',
      'stat.tokens': 'Total tokens',
      'stat.cost': '{range} spend',
      'stat.totalCost': 'Total spend',
      'cost.hintUnset': '{count} provider(s) without a billing method are not included',
      'cost.hintUnpriced': 'Usage without a known list price is not included',
      'cost.hintPeak': 'For models with peak pricing (DeepSeek), the share of the list-price value used in peak hours (Beijing time, weekdays 9–12 and 14–18)',
      'provider.colCost': 'Spend',
      'provider.setBilling': 'Set',
      'billing.official': 'List price',
      'billing.multiplier': 'Discount',
      'billing.plan': 'Monthly',
      'billing.free': 'Not mine',
      'billing.factor': 'Multiplier',
      'billing.monthly': '¥ per month',
      'billing.since': 'Since',
      'billing.reset': 'Default',
      'billing.cancel': 'Cancel',
      'billing.listValue': 'At list price {value}',
      'billing.excluded': 'Excluded',
      'billing.planMonth': 'Since {start} {used} / fee {fee}',
      'billing.tagPlan': 'plan',
      'billing.unpriced': 'No list price: {models}',
      'billing.saveFailed': 'Not saved: {reason}',
      'billing.tagUnsaved': 'not saved',
      'stat.rangeTokens': '{range} tokens',
      'action.export': 'Export',
      'action.exportCsv': 'CSV (daily)',
      'action.exportJson': 'JSON (snapshot)',
      'delta.hint': 'Versus the same days of the previous period, today excluded',
      'legend.less': 'Less',
      'legend.more': 'More',
      'tip.tokens': '{value} tokens',
      'tip.none': 'No activity',
      'tip.weekRange': '{start} – {end}',
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
      'lens.cacheWrite': 'Cache write',
      'lens.input': 'Uncached input',
      'lens.output': 'Output',
      'lens.zoom': 'Zoom into uncached',
      'lens.back': 'Back to overall',
      'lens.uncachedTitle': 'Uncached token mix',
      'lens.colType': 'Type',
      'lens.colAmount': 'Tokens',
      'lens.colShareTotal': 'of input',
      'lens.colShareUncached': 'of uncached',
      'provider.deepseek-account': 'DeepSeek account',
      'provider.deepseek-official': 'DeepSeek official',
      'provider.deepseek-modlens': 'DeepSeek ModLens',
      'provider.unknown': 'Unknown',
      'provider.other': 'Other',
      'provider.today': 'Today',
      'provider.colName': 'Provider',
      'provider.colAmount': 'Tokens',
      'provider.colShare': 'Share',
      'provider.colHit': 'Cache hit',
      'status.loading': 'Scanning local session logs…',
      'action.refresh': 'Refresh',
      'action.retry': 'Retry',
      'action.update': 'Update to {version}',
      'action.updating': 'Updating…',
      'error.title': 'Failed to load usage stats',
      'error.stale': 'The last refresh failed',
      'empty.title': 'No sessions yet',
      'unit.day': 'd',
      'unit.hourShort': 'h',
      'unit.minuteShort': 'm',
      'unit.none': '—',
      'aria.activity': 'Token activity chart',
      'aria.model': 'Token by model chart',
      'aria.lens': 'Token mix bar',
      'aria.range': 'Time range',
      'aria.hitTrend': 'Daily cache hit rate',
      'lens.hitTrend': 'Daily cache hit rate',
    }

    const ZH = {
      'panel.title': '个人主页',
      'stat.today': '今日 Token 用量',
      'stat.longestTurn': '最长任务用时',
      'stat.longestStreak': '最长连续天数',
      'stat.currentStreak': '当前连续天数',
      'section.activity': 'Token 活动',
      'section.model': '模型分布',
      'section.breakdown': 'Token 构成',
      'section.provider': '供应商分类',
      'mode.day': '每天',
      'mode.week': '每周',
      'mode.total': '累计总量',
      'grain.day': '按日',
      'grain.week': '按周',
      'grain.month': '按月',
      'range.day': '本日',
      'range.week': '本周',
      'range.month': '本月',
      'range.all': '累计',
      'range.custom': '自定义',
      'range.from': '开始',
      'range.to': '结束',
      'action.apply': '确定',
      'stat.streak': '连续天数',
      'stat.best': '最长 {n} 天',
      'stat.todayHit': '今日缓存命中率',
      'provider.rename': '改名',
      'section.project': '项目',
      'project.colName': '项目',
      'project.colSubagent': '子代理',
      'project.unknown': '未知项目',
      'project.others': '其他项目（{count}）',
      'model.modeTokens': '用量',
      'model.modeShare': '占比',
      'stat.tokens': '累计 Token 数',
      'stat.cost': '{range}花费',
      'stat.totalCost': '累计花费',
      'cost.hintUnset': '另有 {count} 家未设置计费方式，未计入',
      'cost.hintUnpriced': '部分用量没有已知的官方价，未计入',
      'cost.hintPeak': '有高峰 / 空闲时段的模型（DeepSeek）按官方价折算，高峰时段（北京时间工作日 9–12、14–18 点）的占比',
      'provider.colCost': '费用',
      'provider.setBilling': '设置',
      'billing.official': '官方价',
      'billing.multiplier': '打折',
      'billing.plan': '包月',
      'billing.free': '不计入',
      'billing.factor': '倍数',
      'billing.monthly': '月费（元）',
      'billing.since': '开始日期',
      'billing.reset': '恢复默认',
      'billing.cancel': '取消',
      'billing.listValue': '按官方价算 {value}',
      'billing.excluded': '不计入',
      'billing.planMonth': '{start} 起已用 {used} / 月费 {fee}',
      'billing.tagPlan': '包月',
      'billing.unpriced': '没有官方价：{models}',
      'billing.saveFailed': '没有存上：{reason}',
      'billing.tagUnsaved': '未保存',
      'stat.rangeTokens': '{range} Token',
      'action.export': '导出',
      'action.exportCsv': 'CSV（按天）',
      'action.exportJson': 'JSON（快照）',
      'delta.hint': '与上一周期的同样天数相比（不含今天）',
      'legend.less': '少',
      'legend.more': '多',
      'tip.tokens': '{value} tokens',
      'tip.none': '无活动',
      'tip.weekRange': '{start} – {end}',
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
      'lens.cacheWrite': '缓存写入',
      'lens.input': '未缓存输入',
      'lens.output': '输出',
      'lens.zoom': '放大非缓存细分',
      'lens.back': '返回整体构成',
      'lens.uncachedTitle': '非缓存 Token 构成',
      'lens.colType': '类型',
      'lens.colAmount': '用量',
      'lens.colShareTotal': '占输入',
      'lens.colShareUncached': '占非缓存合计',
      'provider.deepseek-account': 'DeepSeek 账号',
      'provider.deepseek-official': 'DeepSeek 官方',
      'provider.deepseek-modlens': 'DeepSeek ModLens',
      'provider.unknown': '未知来源',
      'provider.other': '其他',
      'provider.today': '今日',
      'provider.colName': '供应商',
      'provider.colAmount': '用量',
      'provider.colShare': '占比',
      'provider.colHit': '命中率',
      'status.loading': '正在统计本地会话日志…',
      'action.refresh': '刷新',
      'action.retry': '重试',
      'action.update': '更新到 {version}',
      'action.updating': '更新中…',
      'error.title': '读取用量统计失败',
      'error.stale': '最近一次刷新失败',
      'empty.title': '还没有可统计的会话',
      'unit.day': '天',
      'unit.hourShort': '小时',
      'unit.minuteShort': '分',
      'unit.none': '—',
      'aria.activity': 'Token 活动图',
      'aria.model': '模型分布图',
      'aria.lens': 'Token 构成条',
      'aria.range': '时间范围',
      'aria.hitTrend': '每日缓存命中率',
      'lens.hitTrend': '每日缓存命中率',
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
     * ≥ 1 万的数 → { value, unit }，一位小数：中文界面用「万 / 亿」，其他语言用 K / M / B。
     * 单位按「取一位小数之后」的值来选：99,999,999 不能显示成「10000.0 万」，999,950 不能显示成「1000.0K」。
     */
    function bigNumberParts(number) {
      const steps = isChineseLocale()
        ? [
            [1e8, '亿'],
            [1e4, '万'],
          ]
        : [
            [1e9, 'B'],
            [1e6, 'M'],
            [1e3, 'K'],
          ]
      for (let index = 0; index < steps.length; index += 1) {
        const [size, unit] = steps[index]
        if (number < size && index < steps.length - 1) continue
        const text = (number / size).toFixed(1)
        const bigger = steps[index - 1]
        if (bigger && Number(text) * size >= bigger[0]) return { value: (number / bigger[0]).toFixed(1), unit: bigger[1] }
        return { value: text, unit }
      }
      return { value: String(number), unit: '' }
    }

    /** 数和单位之间：中文的「万 / 亿」隔一个空格（1.2 万），K / M / B 紧挨着（1.2K）。 */
    function unitGap(unit) {
      return /^[KMB]$/.test(unit) ? '' : ' '
    }

    /** 列表的分隔符：中文用顿号，其他语言用逗号。 */
    function listJoin(items) {
      return items.join(isChineseLocale() ? '、' : ', ')
    }

    /**
     * token 数 → { value, unit }：一万以下写全（9,999），一万起见 bigNumberParts。
     * 只在渲染那一步调用；任何求和、占比都用原始整数。
     */
    function tokenParts(value) {
      const number = toNumber(value)
      if (number <= 0) return { value: '0', unit: '' }
      if (number >= 1e4) return bigNumberParts(number)
      return { value: number.toLocaleString(currentLocaleId()), unit: '' }
    }

    function formatTokens(value) {
      const parts = tokenParts(value)
      return parts.unit ? `${parts.value}${unitGap(parts.unit)}${parts.unit}` : parts.value
    }

    /** 纵轴刻度文案：去掉多余的 .0（1.0 亿 → 1 亿，1.0B → 1B）。 */
    function formatAxis(value) {
      const number = toNumber(value)
      if (number <= 0) return '0'
      return formatTokens(number).replace(/\.0(?=\s|[KMB])/, '')
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

    /* ------------------------------------------------------------ 时间范围 */

    /** 顶部范围：本日、本周（周一起算）、本月、累计（不限起点）、自定义。 */
    const RANGE_IDS = ['day', 'week', 'month', 'all', 'custom']

    function daysBetween(start, end) {
      return Math.round((startOfDay(end).getTime() - startOfDay(start).getTime()) / 86400000) + 1
    }

    /**
     * 范围 → 起止日期键。
     *   本日：今天一天（kind = 'day'）；
     *   本周：本周一到今天（kind = 'week'，周一起算，和活动图一致；环比按周对齐）；
     *   本月：1 号到今天（kind = 'month'，环比按自然月对齐）；
     *   累计：没有起点（用今天作终点），环比没有「上一期」；
     *   自定义：custom = { startKey, endKey }，终点不晚于今天、起止颠倒时自动对调。
     * 不认识的范围也当累计处理。
     */
    function rangeWindow(range, todayKey, custom) {
      const end = parseDateKey(todayKey)
      if (range === 'day' && end) return { range, kind: 'day', days: 1, startKey: todayKey, endKey: todayKey }
      if (range === 'week' && end) {
        const first = startOfWeek(end)
        return { range, kind: 'week', days: daysBetween(first, end), startKey: localDateKey(first), endKey: todayKey }
      }
      if (range === 'month' && end) {
        return { range, kind: 'month', days: end.getDate(), startKey: localDateKey(new Date(end.getFullYear(), end.getMonth(), 1)), endKey: todayKey }
      }
      if (range === 'custom' && end && custom) {
        let first = parseDateKey(custom.startKey)
        let last = parseDateKey(custom.endKey)
        if (first && last) {
          if (first.getTime() > last.getTime()) [first, last] = [last, first]
          if (last.getTime() > end.getTime()) last = end
          if (first.getTime() > last.getTime()) first = last
          return { range, kind: 'custom', days: daysBetween(first, last), startKey: localDateKey(first), endKey: localDateKey(last) }
        }
      }
      return { range, days: 0, startKey: '', endKey: todayKey }
    }

    /**
     * 环比要比的两段：本期里已经过完的天（不含今天）对上一期的前同样天数。
     * 直接拿「含今天的 N 天」去比「完整的上一个 N 天」会偏低——今天还没过完，越早看越低。
     * 没有「上一期」的范围返回 null（页面据此不显示环比）：不限起点的；本日（今天还没过完）；本周一、本月 1 号（本期还没有过完的天）。
     */
    function deltaWindows(rangeWin, todayKey) {
      if (!rangeWin || !rangeWin.startKey || !(rangeWin.days >= 1)) return null
      const start = parseDateKey(rangeWin.startKey)
      const end = parseDateKey(rangeWin.endKey)
      if (!start || !end) return null
      // 终点是今天时今天还没过完，不算；自定义范围整段都在过去时每一天都已过完
      const endsToday = !todayKey || rangeWin.endKey >= todayKey
      const lastFull = endsToday ? addDays(end, -1) : end
      if (lastFull.getTime() < start.getTime()) return null
      const current = { startKey: rangeWin.startKey, endKey: localDateKey(lastFull) }
      if (rangeWin.kind === 'week') {
        // 本周：对上周从周一起的同样天数（本周一、二对上周一、二）
        const previousStart = addDays(start, -7)
        return {
          current,
          previous: { startKey: localDateKey(previousStart), endKey: localDateKey(addDays(previousStart, daysBetween(start, lastFull) - 1)) },
        }
      }
      if (rangeWin.kind === 'month') {
        // 本月：对上个月从 1 号起的同样天数（11 月 1–7 日对 10 月 1–7 日），不超过上个月的最后一天
        const finished = daysBetween(start, lastFull)
        const previousStart = new Date(start.getFullYear(), start.getMonth() - 1, 1)
        const previousMonthEnd = new Date(start.getFullYear(), start.getMonth(), 0)
        let previousEnd = addDays(previousStart, finished - 1)
        if (previousEnd.getTime() > previousMonthEnd.getTime()) previousEnd = previousMonthEnd
        return { current, previous: { startKey: localDateKey(previousStart), endKey: localDateKey(previousEnd) } }
      }
      return {
        current,
        previous: { startKey: localDateKey(addDays(start, -rangeWin.days)), endKey: localDateKey(addDays(lastFull, -rangeWin.days)) },
      }
    }

    function emptyUsage() {
      return { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }
    }

    /** 把一份四项用量加进 target（没有就新建），返回 target。 */
    function addUsage(target, usage) {
      const sum = target || emptyUsage()
      const source = usage || {}
      sum.inputTokens += toNumber(source.inputTokens)
      sum.cacheReadTokens += toNumber(source.cacheReadTokens)
      sum.cacheWriteTokens += toNumber(source.cacheWriteTokens)
      sum.outputTokens += toNumber(source.outputTokens)
      return sum
    }

    /**
     * 缓存命中率（0–100）= 缓存命中 ÷ 全部输入（未缓存输入 + 缓存命中 + 缓存写入）。
     * 缓存写入要付费、不是命中，只进分母；没有写入时就是 DeepSeek 的 命中 ÷（命中 + 未命中）。
     * 没有任何输入时返回 null（页面显示「—」，不显示 0%）。
     */
    function cacheHitRate(usage) {
      const source = usage || {}
      const read = Math.max(0, toNumber(source.cacheReadTokens))
      const all = read + Math.max(0, toNumber(source.inputTokens)) + Math.max(0, toNumber(source.cacheWriteTokens))
      return all > 0 ? (read / all) * 100 : null
    }

    function emptySummary() {
      return {
        tokens: 0,
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        byProvider: {},
        providerUsage: {},
        byModel: {},
        byProject: {},
        byProjectSubagent: {},
        days: 0,
        activeDays: 0,
      }
    }

    /** 用日明细汇总一段窗口（起止都包含，任一端为空表示不设限）。 */
    function summarizeDaily(daily, startKey, endKey) {
      const summary = emptySummary()
      for (const entry of indexDaily(daily).values()) {
        const date = entry.date
        if (startKey && date < startKey) continue
        if (endKey && date > endKey) continue
        const tokens = toNumber(entry.tokens)
        summary.days += 1
        if (tokens > 0) summary.activeDays += 1
        summary.tokens += tokens
        summary.calls += toNumber(entry.calls)
        summary.inputTokens += toNumber(entry.inputTokens)
        summary.outputTokens += toNumber(entry.outputTokens)
        // 旧版宿主的日明细只有读写合并的 cacheTokens（升级后宿主重载前会短暂遇到）
        summary.cacheReadTokens += toNumber(entry.cacheReadTokens === undefined ? entry.cacheTokens : entry.cacheReadTokens)
        summary.cacheWriteTokens += toNumber(entry.cacheWriteTokens)
        for (const [id, amount] of Object.entries(entry.byProvider || {})) {
          summary.byProvider[id] = toNumber(summary.byProvider[id]) + toNumber(amount)
        }
        for (const [id, usage] of Object.entries(entry.providerUsage || {})) {
          summary.providerUsage[id] = addUsage(summary.providerUsage[id], usage)
        }
        for (const [id, amount] of Object.entries(entry.byModel || {})) {
          summary.byModel[id] = toNumber(summary.byModel[id]) + toNumber(amount)
        }
        for (const [id, amount] of Object.entries(entry.byProject || {})) {
          summary.byProject[id] = toNumber(summary.byProject[id]) + toNumber(amount)
        }
        for (const [id, amount] of Object.entries(entry.byProjectSubagent || {})) {
          summary.byProjectSubagent[id] = toNumber(summary.byProjectSubagent[id]) + toNumber(amount)
        }
      }
      return summary
    }

    /** 汇总结果 → Cache Lens 需要的 totals 形状。 */
    function lensTotalsOf(summary) {
      return {
        tokens: summary.tokens,
        inputTokens: summary.inputTokens,
        outputTokens: summary.outputTokens,
        cacheReadTokens: summary.cacheReadTokens,
        cacheWriteTokens: summary.cacheWriteTokens,
      }
    }

    /** 日明细 → 连续日序列（缺的补 0），给指标卡的迷你趋势用。 */
    function dailySeries(daily, startKey, endKey) {
      const byDate = indexDaily(daily)
      const start = parseDateKey(startKey)
      const end = parseDateKey(endKey)
      const points = []
      if (!start || !end) return points
      for (let date = start; date.getTime() <= end.getTime(); date = addDays(date, 1)) {
        const key = localDateKey(date)
        const entry = byDate.get(key)
        points.push({ key, tokens: entry ? toNumber(entry.tokens) : 0 })
      }
      return points
    }

    /** 环比百分比；上一期为 0 时没有意义（不显示）。 */
    function deltaPercent(current, previous) {
      if (!(previous > 0)) return null
      return ((toNumber(current) - toNumber(previous)) / previous) * 100
    }

    /** 环比文案。上一期用量很少时可以到几万个百分点：四位数起不留小数、加千分位（+57,893%），免得撑宽卡片。 */
    function formatDelta(value) {
      const number = toNumber(value)
      const sign = number > 0 ? '+' : ''
      if (Math.abs(number) >= 1000) return `${sign}${Math.round(number).toLocaleString('en-US')}%`
      return `${sign}${number.toFixed(1)}%`
    }

    /* ------------------------------------------------------------ 费用 */

    /**
     * DeepSeek 官方价（元 / 百万 token），按生效时间（UTC 毫秒）排列。出处：api-docs.deepseek.com 的价格页，
     * 以及 2026-08-13、2026-09-10 两份调价公告里的价格表。空闲时段是高峰价的一半（见 isPeakHour）。
     * 2026-08-17 00:00（北京时间）之前的价格官方文档里查不到，那段用量算「未定价」，不硬编。
     * 旧模型名 deepseek-v4-flash / -vision 已由 V4.1 Flash 提供、按 Flash 价计费；中转站的 deepseek-v4-1-flash* 同属 Flash。
     * 火山方舟独有的 deepseek-v4-1-flash 经济版（-economy）单独一档，按方舟模型价格页的按量价（2026-11）：比 Flash 便宜两成。
     */
    const OFFICIAL_PRICES = [
      { family: 'flash', from: Date.UTC(2026, 7, 16, 16), peak: { hit: 0.1, miss: 3, output: 9 }, offPeak: { hit: 0.05, miss: 1.5, output: 4.5 } },
      { family: 'flash', from: Date.UTC(2026, 8, 10, 4), peak: { hit: 0.04, miss: 2, output: 8 }, offPeak: { hit: 0.02, miss: 1, output: 4 } },
      { family: 'pro', from: Date.UTC(2026, 7, 16, 16), peak: { hit: 0.3, miss: 9, output: 27 }, offPeak: { hit: 0.15, miss: 4.5, output: 13.5 } },
      { family: 'flash-economy', from: Date.UTC(2026, 7, 16, 16), peak: { hit: 0.032, miss: 1.6, output: 6.4 }, offPeak: { hit: 0.016, miss: 0.8, output: 3.2 } },
    ]

    /** 2026 年法定节假日（国务院办公厅 2025-11-04 通知）：这些天全天按空闲时段计价。周末本来就是空闲时段。 */
    const CN_HOLIDAYS = [
      ['2026-01-01', '2026-01-03'],
      ['2026-02-15', '2026-02-23'],
      ['2026-04-04', '2026-04-06'],
      ['2026-05-01', '2026-05-05'],
      ['2026-06-19', '2026-06-21'],
      ['2026-09-25', '2026-09-27'],
      ['2026-10-01', '2026-10-07'],
    ]

    /** 直连 DeepSeek 官方 API 的供应商 id：没设置计费方式时按官方价算花费；其余没设置的只显示官方价折算。 */
    const OFFICIAL_PROVIDERS = ['deepseek-official', 'deepseek-account']

    let holidayKeys = null
    function holidaySet() {
      if (holidayKeys) return holidayKeys
      holidayKeys = new Set()
      for (const [first, last] of CN_HOLIDAYS) {
        const end = parseDateKey(last)
        for (let date = parseDateKey(first); date && end && date.getTime() <= end.getTime(); date = addDays(date, 1)) holidayKeys.add(localDateKey(date))
      }
      return holidayKeys
    }

    /** 模型 → 价格系列（flash / pro）；不是 DeepSeek 模型时返回 ''（没有内置官方价）。 */
    function priceFamily(model) {
      const id = modelBaseId(model)
      if (!id.startsWith('deepseek-')) return ''
      if (/(^|-)pro(-|$)/.test(id)) return 'pro'
      if (/(^|-)flash(-|$)/.test(id)) return /(^|-)economy(-|$)/.test(id) ? 'flash-economy' : 'flash'
      return ''
    }

    /**
     * 去掉 Ollama 的「名字:标签」里的标签（宿主已经把点、下划线换成了「-」）：
     *   云端（:cloud、:671b-cloud）跑的就是官方那个模型，标签整个去掉，和官方的算同一个模型；
     *   本地的参数量（:14b、:1-5b）留成名字的一部分（deepseek-r1:14b 是蒸馏的小模型，和官方 R1 不是一个东西）；
     *   :latest、量化格式（q4-k-m、fp16）这类去掉。
     */
    function modelBaseId(model) {
      const text = String(model || '').toLowerCase()
      const colon = text.indexOf(':')
      if (colon <= 0) return text
      const name = text.slice(0, colon)
      const tag = text.slice(colon + 1)
      if (/(^|-)cloud$/.test(tag)) return name
      const size = tag.match(/^(\d+(?:-\d+)?[bm])(?:-|$)/)
      return size ? `${name}-${size[1].replace('-', '.')}` : name
    }

    /** UTC 小时序号 → 是否 DeepSeek 高峰时段：北京时间周一至周五 9–12、14–18 点，法定节假日除外。 */
    function isPeakHour(epochHour) {
      const beijing = new Date((toNumber(epochHour) + 8) * 3600000)
      const weekday = beijing.getUTCDay()
      if (weekday === 0 || weekday === 6) return false
      const hour = beijing.getUTCHours()
      if (!((hour >= 9 && hour < 12) || (hour >= 14 && hour < 18))) return false
      const key = `${beijing.getUTCFullYear()}-${String(beijing.getUTCMonth() + 1).padStart(2, '0')}-${String(beijing.getUTCDate()).padStart(2, '0')}`
      return !holidaySet().has(key)
    }

    /**
     * 某个模型在某个小时的官方单价（每百万 token）：{ currency, miss, hit, write, output, peak, timed }；没有已知价格时返回 null。
     * flat 为 true 时不分峰谷，一律按高峰时段价：只有直连 DeepSeek 官方、按官方价计费的供应商才真的分峰谷；
     * 中转站、coding plan 这些全天一个价，而中转站报的「官方价 X 折」都是拿 DeepSeek 的高峰价当基准
     * （apiranking 汇总的二十多家逐家核对过），方舟按量的 V4-Pro 一口价也等于高峰价，所以统一价用高峰价。
     *   DeepSeek 的 Flash / Pro：内置的人民币价表（按调用时间选调价、分高峰 / 空闲时段，timed = true），
     *     2026-08-17 之前没有已知价格（不退回价格表，免得用别家转售的旧价）；
     *   其他模型：宿主随快照发来的价格表（LiteLLM，美元），缓存读 / 写没有单独价格时按未缓存输入价。
     */
    function officialRate(model, epochHour, table, flat) {
      const family = priceFamily(model)
      if (family) {
        const at = toNumber(epochHour) * 3600000
        let row = null
        for (const candidate of OFFICIAL_PRICES) {
          if (candidate.family === family && candidate.from <= at && (!row || candidate.from > row.from)) row = candidate
        }
        if (!row) return null
        const peak = !flat && isPeakHour(epochHour)
        // 统一价（flat）= 高峰价；按官方价计费的按调用时间分高峰 / 空闲
        const price = flat || peak ? row.peak : row.offPeak
        return { currency: 'CNY', miss: price.miss, hit: price.hit, write: price.miss, output: price.output, peak, timed: !flat }
      }
      const listed = table && Object.prototype.hasOwnProperty.call(table, model) && Array.isArray(table[model]) ? table[model] : null
      if (!listed) return null
      const [input, output, cacheRead, cacheWrite] = listed
      if (![input, output].every((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0)) return null
      // 输入输出都是 0：四项全 0 才是官方标明的免费；[0, 0, null, null] 是还没定价的占位
      if (input === 0 && output === 0 && !(cacheRead === 0 && cacheWrite === 0)) return null
      const or = (value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : input)
      return { currency: 'USD', miss: input, hit: or(cacheRead), write: or(cacheWrite), output, peak: false, timed: false }
    }

    /** 计费方式：官方价、打折（官方价 × 倍数）、包月、不计入。 */
    const BILLING_MODES = ['official', 'multiplier', 'plan', 'free']

    /** 某个供应商的计费方式：本机设置的优先（不认识的写法当没设置）；没设置时官方直连按官方价，其余是「未设置」。 */
    function billingOf(provider, settings) {
      const entry = settings && settings[provider]
      if (entry && BILLING_MODES.includes(entry.mode)) return entry
      return OFFICIAL_PROVIDERS.includes(provider) ? { mode: 'official', auto: true } : { mode: 'unset' }
    }

    function daysInMonth(date) {
      return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
    }

    /**
     * 一段日期内的费用（人民币）。slots 是宿主按小时记的 [小时序号, 供应商, 模型, 项目键, 未缓存输入, 缓存读, 缓存写, 输出]。
     * options：{ table（价格表：模型 → [输入, 输出, 缓存读, 缓存写] 美元 / 百万），usdCny（美元兑人民币） }
     *   value     按官方价折算（所有人都有；美元价按汇率换算）。只有计费方式是「官方价」的供应商（直连 DeepSeek）分峰谷，
     *             其余（打折、包月、不计入、未设置）一律按不分峰谷的统一价（高峰时段价，中转站的「官方价」就是它）
     *   peakValue / peakBase  分峰谷计价的那部分里，高峰时段的部分 / 全部——高峰占比只看这些
     *   spend     按各家计费方式：官方 = value，打折 = value × 倍数，包月 = value（用量换算成钱；月费只用来对比，见 planCycleStart），
     *             不计入 = 0，未设置 = 不知道（不算进 spend，列在 unset 里）
     *   unpricedTokens  花费要按官方价算、却没有已知官方价的用量（官方 / 打折 / 包月）：这部分没算进 spend。
     *             不计入的用量不需要官方价，不算在里面
     *   byProject 各项目的花费；用量全部来自未设置 / 不计入的供应商的项目不出现（页面写「—」，不是 ¥0）
     */
    function computeCosts(daily, startKey, endKey, settings, todayKey, options) {
      const table = (options && options.table) || {}
      const usdCny = options && typeof options.usdCny === 'number' && options.usdCny > 0 ? options.usdCny : 1
      const toCny = (amount, currency) => (currency === 'USD' ? amount * usdCny : amount)
      const result = { spend: 0, value: 0, peakValue: 0, peakBase: 0, usdValue: 0, unpricedTokens: 0, byProvider: {}, byProject: {}, unset: [] }
      const rowOf = (id) => {
        if (!Object.prototype.hasOwnProperty.call(result.byProvider, id)) {
          const bill = billingOf(id, settings)
          result.byProvider[id] = { spend: bill.mode === 'unset' ? null : 0, value: 0, unpricedTokens: 0, mode: bill.mode, billing: bill, models: [], unpriced: [] }
        }
        return result.byProvider[id]
      }
      const addProject = (key, amount) => {
        result.byProject[key] = toNumber(result.byProject[key]) + amount
      }
      const entries = indexDaily(daily)
      for (const entry of entries.values()) {
        if ((startKey && entry.date < startKey) || (endKey && entry.date > endKey)) continue
        for (const slot of entry.slots || []) {
          const [hour, id, model, project] = slot
          const input = toNumber(slot[4])
          const read = toNumber(slot[5])
          const write = toNumber(slot[6])
          const output = toNumber(slot[7])
          const tokens = input + read + write + output
          const row = rowOf(id)
          if (!row.models.includes(model)) row.models.push(model)
          const bill = row.billing
          // 只有按官方价计费的（直连 DeepSeek）分峰谷；其余按统一价换算
          const rate = officialRate(model, hour, table, bill.mode !== 'official')
          const value = rate ? toCny((input * rate.miss + read * rate.hit + write * rate.write + output * rate.output) / 1e6, rate.currency) : null
          if (value !== null) {
            row.value += value
            result.value += value
            if (rate.currency === 'USD') result.usdValue += value
            if (rate.timed) {
              result.peakBase += value
              if (rate.peak) result.peakValue += value
            }
          }
          // 这一格的花费要不要用官方价：官方、打折、包月要；未设置的格子显示的也是官方价
          const needsList = bill.mode === 'official' || bill.mode === 'multiplier' || bill.mode === 'plan' || bill.mode === 'unset'
          if (value === null && needsList) {
            row.unpricedTokens += tokens
            if (!row.unpriced.includes(model)) row.unpriced.push(model)
            if (bill.mode !== 'unset') result.unpricedTokens += tokens
          }
          let spend = 0
          if (bill.mode === 'official') spend = value === null ? 0 : value
          else if (bill.mode === 'multiplier') spend = value === null ? 0 : value * toNumber(bill.factor)
          else if (bill.mode === 'plan') spend = value === null ? 0 : value
          if (bill.mode === 'unset' || bill.mode === 'free') continue
          row.spend += spend
          result.spend += spend
          addProject(project, spend)
        }
      }
      for (const [id, row] of Object.entries(result.byProvider)) if (row.mode === 'unset') result.unset.push(id)
      result.unset.sort()
      return result
    }

    /**
     * 包月这一个订阅月从哪天开始：开始日期是几号，每个月就从几号续费（那个月没有这一天时取月末）；
     * 没填开始日期按自然月（1 号）。开始日期在今天之后时返回开始日期（还没开始，本月已用是 0）。
     */
    function planCycleStart(since, todayKey) {
      const today = parseDateKey(todayKey)
      if (!today) return ''
      const start = validDateKey(since) ? parseDateKey(since) : null
      if (!start) return localDateKey(new Date(today.getFullYear(), today.getMonth(), 1))
      if (start.getTime() > today.getTime()) return since
      const day = start.getDate()
      const anchorIn = (year, month) => {
        const first = new Date(year, month, 1)
        return new Date(first.getFullYear(), first.getMonth(), Math.min(day, daysInMonth(first)))
      }
      let anchor = anchorIn(today.getFullYear(), today.getMonth())
      if (anchor.getTime() > today.getTime()) anchor = anchorIn(today.getFullYear(), today.getMonth() - 1)
      if (anchor.getTime() < start.getTime()) anchor = start
      return localDateKey(anchor)
    }

    /** 真实存在的日历日 YYYY-MM-DD（2026-02-31 不算），年份在 2000 ~ 2100 之间。 */
    function validDateKey(text) {
      if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false
      const year = Number(text.slice(0, 4))
      const date = parseDateKey(text)
      return year >= 2000 && year <= 2100 && Boolean(date) && localDateKey(date) === text
    }

    /**
     * 金额 → 显示片段：100 元以下两位小数（¥5.50），以上一位（¥1,234.5）；一万起写「¥1.2 万」（英文界面写 ¥12.3K）；
     * 极小的非零值写「<¥0.01」。格式按「取整之后」的值选：99.996 是 ¥100，9999.96 是 ¥1.0 万，不会出现 ¥100.00 / ¥10,000。
     */
    function moneyParts(value) {
      const number = toNumber(value)
      if (number <= 0) return [{ prefix: '¥', value: '0', unit: '' }]
      if (number < 0.005) return [{ prefix: '<¥', value: '0.01', unit: '' }]
      const cents = Math.round(number * 100) / 100
      if (cents < 100) return [{ prefix: '¥', value: cents.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), unit: '' }]
      const tenths = Math.round(number * 10) / 10
      // 100 元以上的整数（月费 199）不写「.0」
      if (tenths < 1e4) return [{ prefix: '¥', value: tenths.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).replace(/\.0$/, ''), unit: '' }]
      const big = bigNumberParts(number)
      return [{ prefix: '¥', value: big.value, unit: big.unit }]
    }

    function formatMoney(value) {
      const part = moneyParts(value)[0]
      return `${part.prefix}${part.value}${part.unit ? `${unitGap(part.unit)}${part.unit}` : ''}`
    }

    /* -------------------------------------------------------- 导出（CSV / JSON） */

    function downloadFile(name, type, text) {
      if (typeof document === 'undefined' || typeof Blob === 'undefined') return false
      const blob = new Blob([text], { type })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = name
      anchor.style.display = 'none'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      return true
    }

    /** CSV 单元格：含逗号、引号或换行时用双引号包起来，内部引号写两遍（RFC 4180）。 */
    function csvCell(value) {
      const text = String(value)
      // 不用含引号的正则字面量：test/helpers/client-source.mjs 按引号切片源码，会把它当成字符串开头
      const quoted = ['"', ',', '\r', '\n'].some((char) => text.includes(char))
      return quoted ? `"${text.split('"').join('""')}"` : text
    }

    /** 每天一行；供应商按范围内总量降序各占一列。Excel 需要 BOM 才认 UTF-8。 */
    function buildCsv(daily, summary, startKey, endKey) {
      const providers = Object.keys(summary.byProvider || {}).sort(
        (left, right) => toNumber(summary.byProvider[right]) - toNumber(summary.byProvider[left]) || (left < right ? -1 : 1),
      )
      const rows = []
      rows.push(['date', 'tokens', 'calls', 'input', 'output', 'cache_read', 'cache_write', ...providers].map(csvCell).join(','))
      for (const entry of indexDaily(daily).values()) {
        if (startKey && entry.date < startKey) continue
        if (endKey && entry.date > endKey) continue
        rows.push(
          [
            entry.date,
            toNumber(entry.tokens),
            toNumber(entry.calls),
            toNumber(entry.inputTokens),
            toNumber(entry.outputTokens),
            toNumber(entry.cacheReadTokens === undefined ? entry.cacheTokens : entry.cacheReadTokens),
            toNumber(entry.cacheWriteTokens),
            ...providers.map((id) => toNumber((entry.byProvider || {})[id])),
          ]
            .map(csvCell)
            .join(','),
        )
      }
      return `\ufeff${rows.join('\r\n')}\r\n`
    }

    function formatDate(date, options) {
      try {
        return new Intl.DateTimeFormat(currentLocaleId(), options).format(date)
      } catch {
        return localDateKey(date)
      }
    }

    /** 自定义范围的简写：今年的写「10/1–10/31」，跨年或往年带上年份。 */
    function rangeText(rangeWin, todayKey) {
      const start = parseDateKey(rangeWin && rangeWin.startKey)
      const end = parseDateKey(rangeWin && rangeWin.endKey)
      if (!start || !end) return ''
      const thisYear = (parseDateKey(todayKey) || new Date()).getFullYear()
      const options = start.getFullYear() === thisYear && end.getFullYear() === thisYear ? { month: 'numeric', day: 'numeric' } : { year: 'numeric', month: 'numeric', day: 'numeric' }
      const first = formatDate(start, options)
      return start.getTime() === end.getTime() ? first : `${first}–${formatDate(end, options)}`
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

    /** 指标卡里不跟范围走的几个数。 */
    function deriveKpis(snapshot, today) {
      const totals = (snapshot && snapshot.totals) || {}
      const byDate = indexDaily(snapshot && snapshot.daily)
      const todayKey = localDateKey(today)
      const todayEntry = byDate.get(todayKey)
      return {
        tokens: toNumber(totals.tokens),
        today: todayEntry ? toNumber(todayEntry.tokens) : 0,
        longestTurnMs: toNumber(totals.longestTurnMs),
        longestStreak: toNumber(totals.longestStreak),
        currentStreak: toNumber(totals.currentStreak),
      }
    }

    /* -------------------------------------------------------------- 数据拉取 */

    /**
     * 宿主把 slots 里的供应商 / 模型 / 项目换成了编号（对照表在 slotKeys，省掉快照的大半体积）：还原成名字，
     * 后面的计算都按名字来。旧版宿主没有 slotKeys，slots 里本来就是名字，原样返回。
     */
    function decodeSnapshot(payload) {
      if (!payload || typeof payload !== 'object' || !payload.slotKeys || typeof payload.slotKeys !== 'object' || !Array.isArray(payload.daily)) return payload
      const keys = payload.slotKeys
      const pick = (list, index) => (Array.isArray(list) && typeof list[index] === 'string' ? list[index] : '')
      const daily = payload.daily.map((entry) =>
        entry && Array.isArray(entry.slots)
          ? {
              ...entry,
              slots: entry.slots.map((slot) =>
                Array.isArray(slot) ? [slot[0], pick(keys.providers, slot[1]), pick(keys.models, slot[2]), pick(keys.projects, slot[3]), ...slot.slice(4)] : slot,
              ),
            }
          : entry,
      )
      return { ...payload, daily }
    }

    /**
     * 快照轮询。`reload()` 立刻重拉一次；`refresh()` 先请求宿主重扫，再立刻重拉——
     * 新快照带 scanning: true，于是切到 900ms 快轮询，扫描进度和新数字马上可见。
     * 宿主给快照带 ETag：浏览器自己带 If-None-Match 去问，没变时宿主回 304；ETag 和上一份一样时也不重新解析、不触发重绘。
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
        let lastTag = ''
        let lastPayload = null

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
              cache: 'no-cache',
              signal: controller ? controller.signal : undefined,
            })
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            const tag = response.headers && typeof response.headers.get === 'function' ? response.headers.get('etag') || '' : ''
            if (tag && tag === lastTag && lastPayload) {
              if (!alive || mine !== ticket) return
              setError(null)
              schedule(lastPayload.scanning ? 900 : intervalMs)
              return
            }
            const payload = decodeSnapshot(await response.json())
            if (!alive || mine !== ticket) return
            const next = payload && typeof payload === 'object' ? payload : null
            lastTag = tag
            lastPayload = next
            setSnapshot(next)
            setError(null)
            schedule(next && next.scanning ? 900 : intervalMs)
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

    function prefersReducedMotion() {
      try {
        return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      } catch {
        return false
      }
    }

    /**
     * 数值过渡：目标值变化时用 requestAnimationFrame 从当前显示值缓动到新值（三次缓出）。
     * 只影响显示，data-value 等属性始终给原始整数；没有 rAF 或用户要求减少动效时直接跳到终值。
     */
    function useTween(target, duration) {
      const [shown, setShown] = useState(target)
      const current = useRef(target)
      useEffect(() => {
        const raf = typeof window !== 'undefined' ? window.requestAnimationFrame : undefined
        const from = current.current
        if (typeof raf !== 'function' || prefersReducedMotion() || from === target) {
          current.current = target
          setShown(target)
          return undefined
        }
        let frame = 0
        let began = null
        const step = (time) => {
          if (began === null) began = time
          const progress = Math.min(1, (time - began) / duration)
          const eased = 1 - Math.pow(1 - progress, 3)
          const value = progress >= 1 ? target : from + (target - from) * eased
          current.current = value
          setShown(value)
          if (progress < 1) frame = raf(step)
        }
        frame = raf(step)
        return () => {
          if (typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(frame)
        }
      }, [target, duration])
      return shown
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
      download: 'M12 4v10m-4.5-4l4.5 4.5 4.5-4.5M5 20h14',
      alert: 'M12 8v5m0 3.5v.01M10.3 3.9L2.6 17.5A2 2 0 004.3 20.5h15.4a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
      edit: 'M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4',
      wallet: 'M4 7.5A1.5 1.5 0 015.5 6H18a2 2 0 012 2v9a2 2 0 01-2 2H6a2 2 0 01-2-2V7.5zM4 8l12-3.5V6M16 13h2',
      target: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 16.5a4.5 4.5 0 100-9 4.5 4.5 0 000 9zM12 12.6a.6.6 0 100-1.2.6.6 0 000 1.2z',
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
      const text = modelBaseId(id)
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
        // 参数量写大写：14b → 14B、1.5b → 1.5B
        if (/^\d+(\.\d+)?[bm]$/.test(piece)) {
          out.push(piece.toUpperCase())
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
      // 恰好 53 列：本周 + 之前 52 周（「今天 − 370 天再对齐到周一」会多出一列）
      const start = addDays(startOfWeek(todayStart), -(ACTIVITY_WEEKS - 1) * 7)
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
     * 每张图一个鼠标位置跟踪器：mousemove 只更新坐标并通知浮层自己挪位置，
     * 不触发整张图重渲染（活动图有 371 个格子，每移动一像素都重渲染太浪费）。
     */
    function createPointer() {
      const listeners = new Set()
      const pointer = {
        x: 0,
        y: 0,
        active: false,
        move(x, y) {
          pointer.x = x
          pointer.y = y
          pointer.active = true
          for (const listener of Array.from(listeners)) listener()
        },
        /** 鼠标离开：停止跟随。reposition = true（改用键盘时）还要让浮层立刻回到锚点，即使选中项没变、组件不重渲染。 */
        leave(reposition) {
          pointer.active = false
          if (reposition) for (const listener of Array.from(listeners)) listener()
        },
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      }
      return pointer
    }

    function usePointer() {
      const ref = useRef(null)
      if (!ref.current) ref.current = createPointer()
      return ref.current
    }

    /**
     * 悬浮浮层。先以 visibility:hidden 渲染，layout effect 里量出真实尺寸再定位：
     *   - 鼠标悬浮时显示在鼠标右下方并跟着鼠标走，右边 / 下边放不下就翻到左边 / 上边；
     *   - 键盘聚焦（没有鼠标位置）时贴着锚点（柱子 / 格子）显示，优先上方，放不下翻到下方。
     * 最后都夹在面板可视区（.dps-root 与视口的交集）以内。用 position:fixed，但会量出包含块的
     * 实际原点再修正——祖先有 transform / 容器查询时也不会错位。
     */
    function Popover(props) {
      const ref = useRef(null)
      const anchor = props.anchor
      const pointer = props.pointer || null
      const latest = useRef(null)
      latest.current = { anchor, pointer }

      const place = () => {
        const element = ref.current
        const current = latest.current
        if (!element || !current.anchor || typeof element.getBoundingClientRect !== 'function') return
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
        let left
        let top
        if (current.pointer && current.pointer.active) {
          const { x, y } = current.pointer
          left = x + 14
          if (left + width > bounds.right) left = x - 14 - width
          top = y + 18
          if (top + height > bounds.bottom) top = y - 12 - height
        } else {
          const box = current.anchor
          const gap = 10
          left = box.left + box.width / 2 - width / 2
          top = box.top - gap - height
          if (top < bounds.top) {
            const below = box.top + box.height + gap
            if (below + height <= bounds.bottom) top = below
          }
        }
        // 最后夹一次：锚点可能在可视区外（图表下半截滚出了视口），浮层也要完整可见
        left = Math.max(bounds.left, Math.min(left, bounds.right - width))
        top = Math.max(bounds.top, Math.min(top, bounds.bottom - height))
        element.style.left = `${Math.round(left - origin.left)}px`
        element.style.top = `${Math.round(top - origin.top)}px`
        element.style.visibility = 'visible'
      }

      useLayoutEffect(place)
      useEffect(() => (pointer ? pointer.subscribe(place) : undefined), [pointer])
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
      const pointer = usePointer()
      const data = useMemo(() => buildActivity(props.daily, today), [props.daily, localDateKey(today)])
      // 顶部选了时间范围时，把窗口内的格子描出来（热力图本身仍是全年视图）。
      const rangeStart = props.rangeStartKey || ''
      const rangeEnd = props.rangeEndKey || ''
      const inRange = (key) => Boolean(rangeStart) && key >= rangeStart && key <= rangeEnd
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
        pointer.move(event.clientX, event.clientY)
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
        // 键盘操作时浮层回到贴着格子 / 柱子显示（没有鼠标位置可跟）
        pointer.leave(true)
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
                'data-in-range': inRange(cell.key) ? 'true' : 'false',
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
              style: { '--i': week.col },
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
            // 这一周截到今天、只剩一天（今天是周一）：写单个日期，不写「11月9日 – 11月9日」
            title =
              week.startKey === week.endKey
                ? formatDate(startDate, { month: 'long', day: 'numeric', weekday: 'short' })
                : t('tip.weekRange', { start: formatDate(startDate, short), end: formatDate(endDate, short) })
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
            pointer,
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
        { className: 'dps-panel dps-act', 'data-dps-card': 'activity', 'data-mode': mode, 'data-window-total': data.windowTokens },
        h(
          'header',
          { className: 'dps-panel-head' },
          h('div', { className: 'dps-panel-title' }, h('h2', null, t('section.activity'))),
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
                onMouseLeave: () => {
                  pointer.leave()
                  setActive(null)
                },
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

    /**
     * 模型分布自己的时间窗，不跟顶部范围走：按日看最近 7 天、按周看最近 4 周、按月看最近 6 个月（都含今天所在的桶）；
     * 默认按周。前 6 个家族各自一段，其余合成「其他模型」。
     */
    const MODEL_GRAINS = ['day', 'week', 'month']
    const MODEL_COUNTS = { day: 7, week: 4, month: 6 }
    const MODEL_DEFAULT_GRAIN = 'week'
    const MODEL_TOP = 6
    const SERIES_COLORS = ['var(--dps-s1)', 'var(--dps-s2)', 'var(--dps-s3)', 'var(--dps-s4)', 'var(--dps-s5)', 'var(--dps-s6)']
    const OTHER_COLOR = 'var(--dps-other)'

    /** 窗口内的桶（含没有活动的桶）：key + 起止日期。周一起算；本周/本月的终点截到今天。 */
    function modelBucketFrames(granularity, today, count = MODEL_COUNTS[granularity] || MODEL_COUNTS.week) {
      const todayStart = startOfDay(today)
      const total = Math.max(1, Math.round(toNumber(count) || MODEL_COUNTS.week))
      const frames = []
      for (let offset = total - 1; offset >= 0; offset -= 1) {
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
     * count 个桶 × 模型家族。全程原始整数：桶合计、家族合计、头部总计都是同一批整数相加，
     * 纵轴按最高的那根堆叠柱取整齐刻度。桶按日历对齐（周一起算、按月从 1 号起），最后一个桶是今天所在的那一周 / 那个月。
     */
    function buildModelSeries(daily, granularity, today, count = MODEL_COUNTS[granularity]) {
      const buckets = modelBucketFrames(granularity, today, count).map((frame) => ({ ...frame, values: {}, total: 0 }))
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

    /** 饼图的几何（viewBox 280 × 240）：圆心、半径；占比不到 6% 的扇区不在圆外写百分比（挤在一起读不了，看图例和浮层）。 */
    const PIE_CX = 140
    const PIE_CY = 120
    const PIE_R = 84
    const PIE_LABEL_MIN = 0.06

    /**
     * 饼图的扇区：values 是各项用量（非负），按给定顺序从 12 点钟方向顺时针排；返回和 values 等长的
     * { fraction（占总量的比例 0–1）, start, end, mid（弧度，12 点钟 = 0，顺时针增大）}。总量为 0 时返回空数组。
     */
    function pieSlices(values) {
      const amounts = (values || []).map((value) => Math.max(0, toNumber(value)))
      const total = amounts.reduce((sum, value) => sum + value, 0)
      if (!(total > 0)) return []
      let angle = 0
      return amounts.map((value) => {
        const fraction = value / total
        const start = angle
        angle += fraction * Math.PI * 2
        return { fraction, start, end: angle, mid: (start + angle) / 2 }
      })
    }

    /** 一个扇区的 SVG 路径（圆心 cx, cy，半径 r）；一整圈（只有一个家族）画成圆。 */
    function pieArc(cx, cy, r, start, end) {
      const num = (value) => Math.round(value * 100) / 100
      if (end - start >= Math.PI * 2 - 1e-9) {
        return `M ${num(cx)} ${num(cy - r)} A ${num(r)} ${num(r)} 0 1 1 ${num(cx)} ${num(cy + r)} A ${num(r)} ${num(r)} 0 1 1 ${num(cx)} ${num(cy - r)} Z`
      }
      const x1 = cx + r * Math.sin(start)
      const y1 = cy - r * Math.cos(start)
      const x2 = cx + r * Math.sin(end)
      const y2 = cy - r * Math.cos(end)
      const large = end - start > Math.PI ? 1 : 0
      return `M ${num(cx)} ${num(cy)} L ${num(x1)} ${num(y1)} A ${num(r)} ${num(r)} 0 ${large} 1 ${num(x2)} ${num(y2)} Z`
    }

    /** 横轴刻度文案；withYear 时带上年份（跨年的范围里，年份变了的那个刻度）。 */
    function bucketTick(bucket, granularity, withYear) {
      if (granularity === 'month') return withYear ? formatDate(bucket.start, { year: 'numeric', month: 'short' }) : monthLabel(bucket.start)
      return formatDate(bucket.start, withYear ? { year: 'numeric', month: 'numeric', day: 'numeric' } : { month: 'numeric', day: 'numeric' })
    }

    /**
     * 哪些刻度显示、哪些带年份。最多 12 个刻度：
     *   按月且超过 12 个月：每 2 / 3 / 4 / 6 / 12 个月标一个，落在日历月上（1 月、7 月……），不会出现「6月 1月 8月」这种跳着走的序列；
     *   其他：从最右边（今天）往左每隔 every 个标一个，最后一个标签总在。
     * 范围跨年时，第一个刻度和年份变了的刻度带上年份。
     */
    function tickPlan(buckets, granularity) {
      const count = buckets.length
      let shown
      if (granularity === 'month' && count > 12) {
        const step = [2, 3, 4, 6, 12].find((size) => Math.ceil(count / size) <= 12) || 12 * Math.ceil(count / 144)
        shown = buckets.map((bucket) => (bucket.start.getFullYear() * 12 + bucket.start.getMonth()) % step === 0)
      } else {
        const every = Math.ceil(count / 12)
        shown = buckets.map((bucket, position) => every <= 1 || (count - 1 - position) % every === 0)
      }
      const multiYear = count > 0 && buckets[0].start.getFullYear() !== buckets[count - 1].start.getFullYear()
      let lastYear = null
      return buckets.map((bucket, position) => {
        if (!shown[position]) return { shown: false, withYear: false }
        const year = bucket.start.getFullYear()
        const withYear = multiYear && year !== lastYear
        lastYear = year
        return { shown: true, withYear }
      })
    }

    function bucketTitle(bucket, granularity) {
      if (granularity === 'month') return formatDate(bucket.start, { year: 'numeric', month: 'long' })
      // 这一周只过了一天（今天是周一）：写单个日期，不写「11月9日 – 11月9日」
      if (localDateKey(bucket.start) === localDateKey(bucket.end)) return formatDate(bucket.start, { month: 'long', day: 'numeric', weekday: 'short' })
      if (granularity === 'week' || granularity === 'month') {
        const short = { month: 'short', day: 'numeric' }
        return t('tip.weekRange', { start: formatDate(bucket.start, short), end: formatDate(bucket.end, short) })
      }
      return formatDate(bucket.start, { month: 'long', day: 'numeric', weekday: 'short' })
    }

    /* -------------------------------------------------------------- 模型分布 */

    function ModelCard(props) {
      const today = props.today
      const endDate = startOfDay(today)
      // 模型分布有自己的时间窗，不跟顶部范围走：显示什么只由卡片右上角的粒度开关决定
      const [granularity, setGranularity] = useState(MODEL_DEFAULT_GRAIN)
      const barsRef = useRef(null)
      const pointer = usePointer()
      const todayKey = localDateKey(endDate)
      const data = useMemo(() => buildModelSeries(props.daily, granularity, endDate, MODEL_COUNTS[granularity]), [props.daily, granularity, todayKey])
      const count = data.buckets.length
      const empty = data.total <= 0
      // 用量（堆叠柱，高度 = token 数）/ 占比（饼图：窗口内各模型占总量的比例）
      const [mode, setMode] = useState('tokens')
      const share = mode === 'share'
      // 悬浮 / 键盘选中的柱子（饼图里是扇区）只在同一粒度、同一视图下有效，换了就自然失效
      const scope = `${granularity}|${mode}`
      const itemCount = share ? data.series.length : count
      const sliceRefs = useRef([])
      const [activeState, setActiveState] = useState(null)
      const active = activeState && activeState.scope === scope && activeState.index < itemCount ? activeState.index : null
      const setActive = (index) => setActiveState(index === null || index === undefined ? null : { scope, index })

      const indexFromEvent = (event) => {
        const element = barsRef.current
        if (!element || typeof element.getBoundingClientRect !== 'function') return null
        const rect = element.getBoundingClientRect()
        if (!(rect.width > 0)) return null
        const position = Math.floor(((event.clientX - rect.left) / rect.width) * count)
        return position >= 0 && position < count ? position : null
      }
      const onMove = (event) => {
        pointer.move(event.clientX, event.clientY)
        const position = indexFromEvent(event)
        if (position !== active) setActive(position)
      }
      const onKeyDown = (event) => {
        pointer.leave(true)
        // 柱状图默认从最右边（今天）开始；饼图从最大的扇区开始
        const current = active === null ? (share ? 0 : itemCount - 1) : active
        let next = null
        if (event.key === 'ArrowLeft' || (share && event.key === 'ArrowUp')) next = Math.max(0, current - 1)
        else if (event.key === 'ArrowRight' || (share && event.key === 'ArrowDown')) next = Math.min(itemCount - 1, current + 1)
        else if (event.key === 'Home') next = 0
        else if (event.key === 'End') next = itemCount - 1
        else if (event.key === 'Escape') {
          setActive(null)
          return
        }
        if (next === null) return
        if (typeof event.preventDefault === 'function') event.preventDefault()
        setActive(next)
      }

      const slices = share ? pieSlices(data.series.map((item) => item.total)) : []
      const ticks = data.axis.ticks
      const axisMax = data.axis.max
      const tickText = (tick) => formatAxis(tick)

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
            { className: 'dps-mc-stack', style: { height: `${height}%`, '--i': position } },
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
      if (share) {
        // 饼图：浮层写这个家族的占比和用量，位置跟着鼠标；键盘 / 悬停图例时贴着扇区
        const item = data.series[active === null ? -1 : active]
        const node = item ? sliceRefs.current[active] : null
        if (item && node && typeof node.getBoundingClientRect === 'function') {
          const rect = node.getBoundingClientRect()
          const percent = data.total > 0 ? (item.total / data.total) * 100 : 0
          liveText = `${item.name} ${formatPercent(percent)} ${formatTokens(item.total)}`
          tip = h(
            Popover,
            { pointer, anchor: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } },
            h('div', { className: 'dps-pop-title' }, item.name),
            h(
              'div',
              { className: 'dps-pop-rows' },
              h(
                'div',
                { className: 'dps-pop-row' },
                h('i', { style: { background: item.color } }),
                h('span', { className: 'dps-pop-name' }, t('model.modeShare')),
                h('span', { className: 'dps-pop-num' }, formatPercent(percent)),
              ),
              h(
                'div',
                { className: 'dps-pop-row' },
                h('i', null),
                h('span', { className: 'dps-pop-name' }, t('model.modeTokens')),
                h('span', { className: 'dps-pop-num' }, formatTokens(item.total)),
              ),
            ),
          )
        }
      } else if (active !== null && data.buckets[active] && barsRef.current && typeof barsRef.current.getBoundingClientRect === 'function') {
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
          { pointer, anchor: { left: rect.left + active * columnWidth, top, width: columnWidth, height: 1 } },
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
            data.series.map((item, position) =>
              h(
                'li',
                {
                  key: item.key,
                  'data-series': item.key,
                  'data-value': item.total,
                  'data-share': data.total > 0 ? (item.total / data.total) * 100 : 0,
                  title: item.key === '__other' ? listJoin(item.members.map(familyLabel)) : undefined,
                  onMouseEnter: share ? () => setActive(position) : undefined,
                  onMouseLeave: share ? () => setActive(null) : undefined,
                },
                h('i', { style: { background: item.color } }),
                h('span', { className: 'dps-legend-name' }, item.name),
                h('span', { className: 'dps-legend-value' }, share ? formatPercent(data.total > 0 ? (item.total / data.total) * 100 : 0) : formatTokens(item.total)),
              ),
            ),
          )
        : null

      return h(
        'section',
        { className: 'dps-panel dps-mc', 'data-dps-card': 'model', 'data-grain': granularity, 'data-mode': mode, 'data-empty': empty ? 'true' : 'false' },
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
          h(
            'div',
            { className: 'dps-panel-tools' },
            h(Segmented, {
              control: 'model-mode',
              label: t('section.model'),
              value: mode,
              onChange: (next) => {
                setMode(next)
                setActive(null)
              },
              options: [
                { id: 'tokens', label: t('model.modeTokens') },
                { id: 'share', label: t('model.modeShare') },
              ],
            }),
            h(Segmented, {
              control: 'model-grain',
              label: t('section.model'),
              value: granularity,
              onChange: (next) => {
                setGranularity(next)
                setActive(null)
              },
              options: MODEL_GRAINS.map((id) => ({ id, label: t(`grain.${id}`) })),
            }),
          ),
        ),
        share
          ? h(
              'div',
              { className: 'dps-mc-pie' },
              h(
                'div',
                {
                  className: 'dps-pie-plot',
                  tabIndex: 0,
                  role: 'group',
                  'aria-label': t('aria.model'),
                  'data-dps-chart': 'model-pie',
                  onMouseMove: (event) => pointer.move(event.clientX, event.clientY),
                  onMouseLeave: () => {
                    pointer.leave()
                    setActive(null)
                  },
                  onKeyDown,
                  onFocus: () => {
                    if (active === null && data.series.length > 0) setActive(0)
                  },
                  onBlur: () => setActive(null),
                },
                h(
                  'svg',
                  { key: granularity, className: 'dps-pie', viewBox: '0 0 280 240', 'aria-hidden': true, focusable: 'false' },
                  h('circle', { className: 'dps-pie-track', cx: PIE_CX, cy: PIE_CY, r: PIE_R }),
                  slices.map((slice, position) => {
                    const item = data.series[position]
                    // 悬停 / 选中的扇区向外挪一点，其余变淡
                    const lift = active === position ? 5 : 0
                    return h('path', {
                      key: item.key,
                      ref: (node) => {
                        sliceRefs.current[position] = node
                      },
                      className: 'dps-pie-slice',
                      d: pieArc(PIE_CX, PIE_CY, PIE_R, slice.start, slice.end),
                      fill: item.color,
                      'data-slice': item.key,
                      'data-value': item.total,
                      'data-share': slice.fraction * 100,
                      'data-active': active === position ? 'true' : 'false',
                      'data-dim': active !== null && active !== position ? 'true' : 'false',
                      style: { transform: `translate(${(lift * Math.sin(slice.mid)).toFixed(2)}px, ${(-lift * Math.cos(slice.mid)).toFixed(2)}px)` },
                      onMouseEnter: () => setActive(position),
                    })
                  }),
                  // 只给够大的扇区写百分比（放在圆外，用文字色不用系列色）；小的看图例和浮层
                  slices.map((slice, position) =>
                    slice.fraction >= PIE_LABEL_MIN
                      ? h(
                          'text',
                          {
                            key: `label-${data.series[position].key}`,
                            className: 'dps-pie-label',
                            x: (PIE_CX + (PIE_R + 12) * Math.sin(slice.mid)).toFixed(2),
                            y: (PIE_CY - (PIE_R + 12) * Math.cos(slice.mid)).toFixed(2),
                            textAnchor: Math.sin(slice.mid) > 0.25 ? 'start' : Math.sin(slice.mid) < -0.25 ? 'end' : 'middle',
                            dominantBaseline: 'middle',
                          },
                          formatPercent(slice.fraction * 100),
                        )
                      : null,
                  ),
                ),
                empty ? h('div', { className: 'dps-mc-empty' }, t('chart.empty')) : null,
              ),
            )
          : h(
          'div',
          { className: 'dps-mc-chart', style: { '--mc-count': data.buckets.length } },
          h(
            'div',
            { className: 'dps-mc-axis', 'aria-hidden': true },
            ticks.map((tick) =>
              h('span', { key: tick, 'data-tick': tick, style: { bottom: `${(tick / axisMax) * 100}%` } }, empty && tick > 0 ? '' : tickText(tick)),
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
              onMouseLeave: () => {
                pointer.leave()
                setActive(null)
              },
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
            h('div', { ref: barsRef, className: 'dps-mc-bars', 'data-dps-chart': 'model', key: `${granularity}|${mode}` }, columns),
            empty ? h('div', { className: 'dps-mc-empty' }, t('chart.empty')) : null,
          ),
          h('span', { className: 'dps-mc-corner', 'aria-hidden': true }),
          h(
            'div',
            { className: 'dps-mc-ticks', 'aria-hidden': true },
            tickPlan(data.buckets, granularity).map((plan, position) => {
              const bucket = data.buckets[position]
              return h('span', { key: bucket.key, 'data-thin': plan.shown ? 'false' : 'true' }, plan.shown ? bucketTick(bucket, granularity, plan.withYear) : '')
            }),
          ),
        ),
        legend,
        h(LiveText, { text: liveText }),
        tip,
      )
    }

    /* ------------------------------------------------------------ Token 构成 */

    /**
     * Token 构成（Cache Lens）的派生值。DSH 的用量四项互不重叠，直接取用、不做推断：
     *   缓存命中 = cacheReadTokens    缓存写入 = cacheWriteTokens
     *   未缓存输入 = inputTokens      输出 = outputTokens
     *   总 Token = 范围内日明细的 tokens 之和（宿主按每步四项之和折叠，所以等于四项之和）
     *   缓存命中率 = cacheHitRate：命中 ÷（未缓存输入 + 命中 + 写入）
     *   未缓存输入占比 = 未缓存输入 ÷ 非命中合计（未缓存输入 + 写入 + 输出）——放大视图的分母
     * 旧实现按「inputTokens ≥ 缓存就减掉缓存」猜字段含义，真实命中率 ≤ 50% 时会算高（50% 直接跳成 100%）。
     */
    function deriveLens(totals) {
      const source = totals || {}
      const count = (value) => Math.max(0, toNumber(value))
      const total = count(source.tokens)
      const cache = count(source.cacheReadTokens)
      const write = count(source.cacheWriteTokens)
      const uncached = count(source.inputTokens)
      const output = count(source.outputTokens)
      const inputTotal = uncached + cache + write
      const uncachedTotal = uncached + write + output
      const hitRate = cacheHitRate(source)
      return {
        total,
        cache,
        write,
        uncached,
        output,
        inputTotal,
        uncachedTotal,
        partsTotal: inputTotal + output,
        // 没有输入 / 没有非命中用量时是 null：页面写「—」，不写 0%（和每日命中率、供应商的命中率一致）
        hitRate,
        uncachedShare: uncachedTotal > 0 ? (uncached / uncachedTotal) * 100 : null,
      }
    }

    const LENS_COLORS = {
      cache: 'var(--dps-accent)',
      write: 'color-mix(in srgb,var(--dps-accent) 42%,transparent)',
      input: 'var(--dsw-alias-state-warn-primary)',
      output: 'var(--dsw-alias-state-success-primary)',
    }

    /**
     * 每日缓存命中率（Token 构成卡的底部）：一天一个点，命中 ÷ 全部输入。没有输入的日子没有命中率，
     * 线直接连到下一个有数的日子（不画成 0）。纵轴从数据最低点往下取整到 5% 起、到 100%，
     * 左侧写出上下两端的刻度，否则 90% 以上的起伏看不出来。悬停显示日期与当天的命中率。
     */
    function HitTrend(props) {
      const points = props.points || []
      const count = points.length
      const hasRate = (point) => point && point.rate !== null && point.rate !== undefined
      const known = points.filter(hasRate)
      const [hover, setHover] = useState(null)
      const wrapRef = useRef(null)
      const pointer = usePointer()
      if (known.length < 2) return null
      let lowest = 100
      for (const point of known) lowest = Math.min(lowest, point.rate)
      const floor = Math.max(0, Math.min(95, Math.floor((lowest - 1) / 5) * 5))
      const width = Math.max(count * 4, 8)
      const height = 40
      const xOf = (index) => (count <= 1 ? width / 2 : (index / (count - 1)) * width)
      const yOf = (rate) => height - ((rate - floor) / (100 - floor)) * (height - 4) - 2
      const line = points
        .map((point, index) => (hasRate(point) ? `${xOf(index).toFixed(2)} ${yOf(point.rate).toFixed(2)}` : null))
        .filter(Boolean)
        .map((xy, index) => `${index === 0 ? 'M' : 'L'}${xy}`)
        .join(' ')
      let lastIndex = count - 1
      while (lastIndex >= 0 && !hasRate(points[lastIndex])) lastIndex -= 1
      const marked = hover !== null && hasRate(points[hover]) ? hover : lastIndex
      const indexAt = (clientX) => {
        const node = wrapRef.current
        if (!node || typeof node.getBoundingClientRect !== 'function') return null
        const rect = node.getBoundingClientRect()
        if (!(rect.width > 0)) return null
        return Math.max(0, Math.min(count - 1, Math.round(((clientX - rect.left) / rect.width) * (count - 1))))
      }
      let tip = null
      if (hover !== null && points[hover] && wrapRef.current && typeof wrapRef.current.getBoundingClientRect === 'function') {
        const rect = wrapRef.current.getBoundingClientRect()
        const point = points[hover]
        const date = parseDateKey(point.key)
        tip = h(
          Popover,
          { pointer, anchor: { left: rect.left + (count > 1 ? hover / (count - 1) : 0.5) * rect.width, top: rect.top, width: 0, height: rect.height } },
          h('div', { className: 'dps-pop-title' }, date ? formatDate(date, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }) : point.key),
          h('div', { className: 'dps-pop-value' }, hasRate(point) ? `${t('lens.cacheHit')} ${formatPercent(point.rate)}` : t('tip.none')),
        )
      }
      return h(
        'div',
        { className: 'dps-hit', 'data-dps-field': 'hit-trend', 'data-floor': floor },
        h('div', { className: 'dps-hit-label' }, t('lens.hitTrend')),
        h(
          'div',
          { className: 'dps-hit-body' },
          h(
            'div',
            { className: 'dps-hit-axis', 'aria-hidden': true },
            h('span', { style: { top: '0%' } }, '100%'),
            h('span', { style: { top: '100%' } }, `${floor}%`),
          ),
          h(
            'span',
            {
              ref: wrapRef,
              className: 'dps-spark-wrap dps-hit-plot',
              onMouseEnter: (event) => {
                pointer.move(event.clientX, event.clientY)
                setHover(indexAt(event.clientX))
              },
              onMouseMove: (event) => {
                pointer.move(event.clientX, event.clientY)
                const index = indexAt(event.clientX)
                if (index !== hover) setHover(index)
              },
              onMouseLeave: () => {
                pointer.leave()
                setHover(null)
              },
            },
            h(
              'svg',
              { className: 'dps-spark dps-hit-svg', viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': t('aria.hitTrend') },
              h('path', { className: 'dps-spark-line', d: line, 'data-dps-field': 'hit-line' }),
            ),
            marked >= 0
              ? h('span', {
                  className: 'dps-spark-end',
                  'aria-hidden': true,
                  style: { left: `${(xOf(marked) / width) * 100}%`, top: `${(yOf(points[marked].rate) / height) * 100}%` },
                })
              : null,
          ),
        ),
        tip,
      )
    }

    function LensCard(props) {
      const lens = useMemo(() => deriveLens(props.totals), [props.totals])
      const [zoomed, setZoomed] = useState(false)
      const [hover, setHover] = useState(null)
      const segmentRefs = useRef({})
      const pointer = usePointer()

      // 柱宽描述的是「构成本身」，分母是总量（放大视图是非缓存合计）。
      const denominator = zoomed ? lens.uncachedTotal : lens.partsTotal
      const barShare = (value) => (denominator > 0 ? (value / denominator) * 100 : 0)
      // 百分比列统一除以「全部输入」（命中 + 写入 + 未缓存输入），命中那一行的百分比就是命中率，
      // 几行加起来恰好 100%。输出不属于输入，这一列不给百分比。
      const percentBasis = zoomed ? lens.uncachedTotal : lens.inputTotal
      const share = (value) => (percentBasis > 0 ? (value / percentBasis) * 100 : 0)
      const percentCell = (row) => (zoomed || row.key !== 'output' ? (percentBasis > 0 ? formatPercent(share(row.value)) : t('unit.none')) : '')
      const percentText = (value) => (value === null ? t('unit.none') : formatPercent(value))
      // 缓存写入只在有数时出一行（DeepSeek 没有这个字段，大多数时候是 0）
      const rows = [
        { key: 'cache', label: t('lens.cache'), value: lens.cache, visible: !zoomed },
        { key: 'write', label: t('lens.cacheWrite'), value: lens.write, visible: lens.write > 0 },
        { key: 'input', label: t('lens.input'), value: lens.uncached, visible: true },
        { key: 'output', label: t('lens.output'), value: lens.output, visible: true },
      ]

      const metrics = zoomed
        ? [
            { id: 'primary', label: t('lens.uncachedTotal'), value: lens.uncachedTotal, parts: [tokenParts(lens.uncachedTotal)] },
            { id: 'secondary', label: t('lens.uncachedShare'), value: lens.uncachedShare, text: percentText(lens.uncachedShare), swatch: 'input' },
          ]
        : [
            { id: 'primary', label: t('lens.total'), value: lens.total, parts: [tokenParts(lens.total)] },
            { id: 'secondary', label: t('lens.cacheHit'), value: lens.hitRate, text: percentText(lens.hitRate), swatch: 'cache', accent: true },
          ]

      let visibleBefore = false
      const segments = rows.map((row) => {
        const shown = row.visible && row.value > 0
        const separator = shown && visibleBefore
        if (shown) visibleBefore = true
        const ratio = row.visible ? barShare(row.value) : 0
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
          onMouseEnter: (event) => {
            pointer.move(event.clientX, event.clientY)
            setHover(row.key)
          },
          onMouseMove: (event) => pointer.move(event.clientX, event.clientY),
          onMouseLeave: () => {
            pointer.leave()
            setHover(null)
          },
        })
      })

      let tip = null
      const hovered = hover ? rows.find((row) => row.key === hover && row.visible) : null
      const hoveredNode = hovered ? segmentRefs.current[hovered.key] : null
      if (hovered && hoveredNode && typeof hoveredNode.getBoundingClientRect === 'function') {
        const rect = hoveredNode.getBoundingClientRect()
        tip = h(
          Popover,
          { pointer, anchor: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } },
          h('div', { className: 'dps-pop-title' }, hovered.label),
          h('div', { className: 'dps-pop-value' }, t('tip.tokens', { value: formatTokens(hovered.value) })),
          // 和表格的百分比列一致：整体视图里输出不属于输入，不给「占输入」
          percentCell(hovered)
            ? h('div', { className: 'dps-pop-title' }, `${percentCell(hovered)} · ${zoomed ? t('lens.colShareUncached') : t('lens.colShareTotal')}`)
            : null,
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
              { key: metric.id, className: 'dps-metric', 'data-dps-metric': metric.id, 'data-value': metric.value === null ? '' : metric.value, 'data-accent': metric.accent ? 'true' : 'false' },
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
        h(
          'div',
          {
            className: 'dps-lens-bar',
            role: 'img',
            'aria-label': `${t('aria.lens')}: ${rows
              .filter((row) => row.visible)
              .map((row) => `${row.label} ${formatPercent(barShare(row.value))}`)
              .join(', ')}`,
          },
          segments,
        ),
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
                h('span', { className: 'dps-lens-share', role: 'cell' }, percentCell(row)),
              ),
            ),
        ),
        // 放大视图里也留着：卡片高度不变，命中率的走势和缓存也相关
        h(HitTrend, { points: props.hitSeries }),
        tip,
      )
    }

    /* ------------------------------------------------------------ 供应商分类 */

    /** 显示名：本机起的名字（aliases，只存在本机）→ 内置文案 → 原始 id。 */
    function providerLabel(id, aliases) {
      if (id === '__other') return t('provider.other')
      const alias = aliases && typeof aliases[id] === 'string' ? aliases[id].trim() : ''
      if (alias) return alias
      const key = `provider.${id}`
      const text = t(key)
      return text === key ? String(id) : text
    }

    /**
     * byProvider（各家 token）+ providerUsage（各家四项用量）→ 降序行；前 6 个各一行，其余合成「其他」。
     * 占比的分母是这一档的全部合计；命中率按各家自己的四项算（「其他」用合并后的四项），
     * 这样每一行都能单独和那一家的后台对账。缺四项用量（旧版宿主）时命中率为 null。
     */
    function deriveProviders(byProvider, providerUsage) {
      const usageOf = providerUsage || {}
      const entries = Object.entries(byProvider || {})
        .map(([id, tokens]) => ({ id, tokens: toNumber(tokens), usage: usageOf[id] || null }))
        .filter((row) => row.tokens > 0)
        .sort((left, right) => right.tokens - left.tokens || (left.id < right.id ? -1 : 1))
      const total = entries.reduce((sum, row) => sum + row.tokens, 0)
      const rows = entries.slice(0, 6)
      const rest = entries.slice(6)
      if (rest.length > 0) {
        const known = rest.filter((row) => row.usage)
        rows.push({
          id: '__other',
          tokens: rest.reduce((sum, row) => sum + row.tokens, 0),
          usage: known.length > 0 ? known.reduce((sum, row) => addUsage(sum, row.usage), emptyUsage()) : null,
        })
      }
      return {
        total,
        rows: rows.map((row) => ({
          id: row.id,
          tokens: row.tokens,
          share: total > 0 ? (row.tokens / total) * 100 : 0,
          hitRate: row.usage ? cacheHitRate(row.usage) : null,
        })),
      }
    }

    /** 月费的上限，和宿主一致（index.js 的 PRICE_LIMIT）：超过的宿主会拒绝，编辑器里就不让点「确定」。 */
    const BILLING_LIMIT = 100000

    /** 文本 → 非负数，只认普通的小数写法（12、0.12、.5）；1e3、0x10、Infinity、负数、超过上限都返回 null。 */
    function billingNumber(text) {
      const trimmed = String(text === undefined || text === null ? '' : text).trim()
      if (!/^(\d+(\.\d*)?|\.\d+)$/.test(trimmed)) return null
      const value = Number(trimmed)
      return Number.isFinite(value) && value >= 0 && value <= BILLING_LIMIT ? value : null
    }

    /**
     * 编辑器里的草稿 → 要保存的计费方式；不完整或超出宿主的限制时返回 null（「确定」不可点）。
     * 包月的开始日期可以不填；填了就得是真实存在的日子。
     */
    function billingDraft(mode, fields) {
      if (mode === 'official' || mode === 'free') return { mode }
      if (mode === 'multiplier') {
        const factor = billingNumber(fields.factor)
        return factor === null || factor > 100 ? null : { mode, factor }
      }
      if (mode === 'plan') {
        const monthly = billingNumber(fields.monthly)
        if (monthly === null) return null
        const since = String(fields.since || '').trim()
        if (!since) return { mode, monthly }
        return validDateKey(since) ? { mode, monthly, since } : null
      }
      return null
    }

    /**
     * 供应商卡里展开的一行：选计费方式、填数字。只有标签和输入框；按官方价折算的金额写在左下角作参照。
     */
    function BillingEditor(props) {
      const current = props.billing && BILLING_MODES.includes(props.billing.mode) ? props.billing : { mode: 'official' }
      const [mode, setMode] = useState(current.mode)
      const text = (value) => (value === undefined || value === null ? '' : String(value))
      const [fields, setFields] = useState({
        factor: text(current.factor),
        monthly: text(current.monthly),
        since: current.since || '',
      })
      const draft = billingDraft(mode, fields)
      const onKeyDown = (event) => {
        if (event.key === 'Enter' && draft) props.onSave(draft)
        else if (event.key === 'Escape') props.onClose()
      }
      const field = (name, label, attrs) =>
        h(
          'label',
          { key: name, className: 'dps-date-field' },
          h('span', null, label),
          h('input', {
            className: 'dps-date dps-bill-input',
            'data-dps-field': `billing-${name}`,
            inputMode: 'decimal',
            value: fields[name],
            onChange: (event) => setFields({ ...fields, [name]: event.target.value }),
            onKeyDown,
            ...(attrs || {}),
          }),
        )
      let inputs = null
      if (mode === 'multiplier') inputs = h('div', { className: 'dps-bill-fields' }, field('factor', t('billing.factor')))
      else if (mode === 'plan') {
        inputs = h(
          'div',
          { className: 'dps-bill-fields' },
          field('monthly', t('billing.monthly')),
          field('since', t('billing.since'), { type: 'date', inputMode: undefined, className: 'dps-date' }),
        )
      }
      return h(
        'div',
        { className: 'dps-bill', 'data-dps-control': 'billing-editor', 'data-provider': props.provider, role: 'group', 'aria-label': props.label },
        h(Segmented, {
          control: 'billing-mode',
          label: props.label,
          value: mode,
          onChange: setMode,
          options: BILLING_MODES.map((id) => ({ id, label: t(`billing.${id}`) })),
        }),
        inputs,
        h(
          'div',
          { className: 'dps-bill-foot' },
          // 已经设成包月、编辑器也停在包月：左下角写这个订阅月用了多少（换算成钱）对比月费；否则写按官方价算多少
          mode === 'plan' && current.mode === 'plan' && props.planMonth
            ? h('span', { className: 'dps-bill-meta', 'data-dps-field': 'billing-plan-month' }, planMonthText(props.planMonth))
            : h('span', { className: 'dps-bill-meta', 'data-dps-field': 'billing-list-value' }, t('billing.listValue', { value: formatMoney(props.listValue) })),
          h('button', { type: 'button', className: 'dps-btn', 'data-dps-action': 'billing-reset', onClick: () => props.onSave(null) }, t('billing.reset')),
          h('button', { type: 'button', className: 'dps-btn', 'data-dps-action': 'billing-cancel', onClick: props.onClose }, t('billing.cancel')),
          h(
            'button',
            { type: 'button', className: 'dps-btn', 'data-primary': 'true', 'data-dps-action': 'billing-save', disabled: !draft, onClick: () => draft && props.onSave(draft) },
            t('action.apply'),
          ),
        ),
      )
    }

    /**
     * 包月这一期用了多少：「10/20 起已用 ¥23.02 / 月费 ¥49」。起算日直接写出来——填了开始日期时这一期是从续费日算的，
     * 叫「本月」会被当成自然月。
     */
    function planMonthText(month) {
      const start = parseDateKey(month && month.startKey)
      return t('billing.planMonth', {
        start: start ? formatDate(start, { month: 'numeric', day: 'numeric' }) : '',
        used: formatMoney(month ? month.used : 0),
        fee: formatMoney(month ? month.monthly : 0),
      })
    }

    /** 费用格前面的小标签：打折写倍数（×0.12），包月写「包月」；官方价不写。 */
    function billingTag(bill) {
      if (!bill) return ''
      if (bill.mode === 'multiplier') return `×${Number(bill.factor)}`
      if (bill.mode === 'plan') return t('billing.tagPlan')
      return ''
    }

    /** 供应商这一行的费用格：未设置写「设置」，不计入写「不计入」，包月悬停写月费；点一下展开计费方式。 */
    function costCellText(row) {
      if (!row) return t('unit.none')
      if (row.mode === 'unset') return t('provider.setBilling')
      if (row.mode === 'free') return t('billing.excluded')
      if (row.spend === null || row.spend === undefined) return t('unit.none')
      return formatMoney(row.spend)
    }

    /**
     * 表格最右边两列的宽度：费用（量出最宽的金额）和标签（量出最宽的标签）。每一行是单独的网格，列宽不能按内容自动撑开
     * （各行会对不齐），写死又放不下「¥12.3 万」「not saved」这类。量不到（没有布局）时用 CSS 里的默认宽度。
     */
    function useCostColumn(tableRef, key) {
      const [widths, setWidths] = useState({ cost: 0, tag: 0 })
      useLayoutEffect(() => {
        const table = tableRef.current
        if (!table || typeof table.querySelectorAll !== 'function') return
        let cost = 0
        let tag = 0
        for (const node of table.querySelectorAll('.dps-prov-cost')) cost = Math.max(cost, toNumber(node.scrollWidth))
        for (const node of table.querySelectorAll('.dps-cost-tag')) tag = Math.max(tag, toNumber(node.getBoundingClientRect().width))
        const next = { cost: cost > 0 ? Math.ceil(cost) : 0, tag: tag > 0 ? Math.ceil(tag) : 0 }
        setWidths((current) => (current.cost === next.cost && current.tag === next.tag ? current : next))
      }, [key])
      if (widths.cost <= 0) return undefined
      // 有标签列时右边几列收紧一点（金额列最小 50px），给名称多留位置
      const style = { '--dps-cost-w': `${Math.max(widths.tag > 0 ? 50 : 68, widths.cost)}px` }
      if (widths.tag > 0) style['--dps-tag-w'] = `${widths.tag}px`
      return style
    }

    function ProviderCard(props) {
      // 默认跟随页面顶部的时间范围；「今日」按钮按下时只看今天（切换顶部范围会自动弹起）。
      const todayOnly = Boolean(props.todayOnly)
      const summary = (todayOnly ? props.today : props.summary) || emptySummary()
      const costs = (todayOnly ? props.todayCosts : props.costs) || null
      const data = useMemo(() => deriveProviders(summary.byProvider, summary.providerUsage), [summary])
      const aliases = props.aliases || {}
      const errors = props.billingErrors || {}
      // 正在设置计费方式的那一行；那一行不在表里了（切到「今日」后没有用量）就收起，免得切回来时自己又打开
      const [billingOpen, setBillingOpen] = useState(null)
      const shownIds = new Set(data.rows.map((row) => row.id))
      useEffect(() => {
        if (billingOpen !== null && !shownIds.has(billingOpen)) setBillingOpen(null)
      })
      const tableRef = useRef(null)
      // 「其他」那一行：没单独列出来的供应商的花费合计（未设置的不计入）
      const otherSpend = costs
        ? Object.entries(costs.byProvider).reduce((sum, [id, row]) => (shownIds.has(id) || row.spend === null ? sum : sum + row.spend), 0)
        : 0
      /** 一家的计费信息：费用、计费方式、标签（打折倍数 / 包月 / 未保存）和悬停文字。「其他」那一行和没有费用数据时是 null。 */
      const costInfo = (row) => {
        if (!costs || row.id === '__other') return null
        const cost = costs.byProvider[row.id] || null
        const bill = cost ? cost.billing : billingOf(row.id, props.billingSettings)
        // 包月：只写这个订阅月里用量换算成的钱和月费。不写「按官方价算」——包月的费用本来就等于它（费用格里那个数），
        // 而且它跟着顶部范围走、本月已用不跟，两个数挨在一起会被当成两种算法
        const month = bill && bill.mode === 'plan' && props.planMonths ? ownValue(props.planMonths, row.id) : null
        const titleParts = month
          ? [planMonthText(month)]
          : [t('billing.listValue', { value: formatMoney(cost ? cost.value : 0) })]
        if (cost && cost.unpriced.length) titleParts.push(t('billing.unpriced', { models: listJoin(cost.unpriced) }))
        // 上一次改计费方式没存上：标签换成「未保存」，悬停写原因
        const failed = errors[row.id]
        if (failed) titleParts.unshift(t('billing.saveFailed', { reason: failed }))
        return { cost, bill, failed, tag: failed ? t('billing.tagUnsaved') : billingTag(bill), title: titleParts.join(' · ') }
      }
      // 有任何一家带标签时，表格最右边多出一列专门放标签：用量 / 占比 / 命中率 / 费用整体往左收，金额照样对齐
      const hasTags = data.rows.some((row) => {
        const info = costInfo(row)
        return Boolean(info && info.tag)
      })
      const toggleBilling = (id) => setBillingOpen(billingOpen === id ? null : id)
      const tagCell = (row) => {
        const info = costInfo(row)
        return h(
          'span',
          { className: 'dps-prov-tagcell', role: 'cell' },
          // 计费方式的标签是蓝底；没存上的「未保存」是红底
          info && info.tag ? h('span', { className: 'dps-cost-tag', 'data-dps-field': 'billing-tag', 'data-error': info.failed ? 'true' : undefined, title: info.title, onClick: () => toggleBilling(row.id) }, info.tag) : null,
        )
      }
      const costCell = (row) => {
        if (!costs) return h('span', { className: 'dps-prov-cost', role: 'cell' }, t('unit.none'))
        if (row.id === '__other') return h('span', { className: 'dps-prov-cost', role: 'cell', 'data-value': otherSpend }, formatMoney(otherSpend))
        const { cost, bill, failed, title } = costInfo(row)
        return h(
          'span',
          { className: 'dps-prov-costcell', role: 'cell' },
          h(
            'button',
            {
              type: 'button',
              className: 'dps-prov-cost',
              'data-dps-action': 'billing',
              'data-mode': cost ? cost.mode : bill.mode,
              'data-spend': cost && cost.spend !== null ? cost.spend : '',
              'data-list-value': cost ? cost.value : 0,
              'data-error': failed ? 'true' : undefined,
              'aria-expanded': billingOpen === row.id ? 'true' : 'false',
              title,
              onClick: () => toggleBilling(row.id),
            },
            // 这一档里没有这家的费用明细（旧版宿主没有 slots）：未设置照样写「设置」，其余写「—」，不写 ¥0
            costCellText(cost || { mode: bill.mode, spend: null }),
          ),
        )
      }
      // 正在改名的那一行：{ id, draft }。回车 / 失焦保存，Esc 放弃；ref 防止回车后失焦再存一次
      const [editing, setEditing] = useState(null)
      const editingRef = useRef(null)
      editingRef.current = editing
      const commit = () => {
        const current = editingRef.current
        if (!current) return
        editingRef.current = null
        setEditing(null)
        const before = typeof aliases[current.id] === 'string' ? aliases[current.id].trim() : ''
        const after = current.draft.trim()
        if (after !== before && props.onRename) props.onRename(current.id, after)
      }
      const nameCell = (row) => {
        if (editing && editing.id === row.id) {
          return h(
            'span',
            { className: 'dps-prov-namecell', role: 'cell' },
            h('input', {
              className: 'dps-prov-input',
              'data-dps-field': 'provider-name-input',
              value: editing.draft,
              placeholder: row.id,
              maxLength: 40,
              autoFocus: true,
              'aria-label': t('provider.rename'),
              onChange: (event) => setEditing({ id: row.id, draft: event.target.value }),
              onKeyDown: (event) => {
                if (event.key === 'Enter') commit()
                else if (event.key === 'Escape') {
                  editingRef.current = null
                  setEditing(null)
                }
              },
              onBlur: commit,
            }),
          )
        }
        const label = providerLabel(row.id, aliases)
        const renamed = row.id !== '__other' && label !== providerLabel(row.id)
        return h(
          'span',
          { className: 'dps-prov-namecell', role: 'cell' },
          // 改过名的悬停时带上原始 id，对账时还能认出是哪个渠道
          h('span', { className: 'dps-prov-name', title: renamed ? `${label} · ${row.id}` : label }, label),
          row.id === '__other'
            ? null
            : h(
                'button',
                {
                  type: 'button',
                  className: 'dps-prov-edit',
                  'data-dps-action': 'rename',
                  'aria-label': `${t('provider.rename')} ${label}`,
                  title: t('provider.rename'),
                  onClick: () => setEditing({ id: row.id, draft: typeof aliases[row.id] === 'string' ? aliases[row.id] : '' }),
                },
                h(Icon, { name: 'edit' }),
              ),
        )
      }
      // 费用列里每一格的文字变了才重新量列宽
      const costKey = [
        currentLocaleId(),
        formatMoney(otherSpend),
        ...data.rows.map((row) => {
          const cost = costs && costs.byProvider[row.id]
          return [row.id, cost ? cost.mode : '', cost && cost.spend !== null ? formatMoney(cost.spend) : '', cost ? billingTag(cost.billing) : '', errors[row.id] || ''].join(',')
        }),
      ].join(';')
      const costColumn = useCostColumn(tableRef, costKey)
      return h(
        'section',
        { className: 'dps-panel dps-prov', 'data-dps-card': 'provider', 'data-scope': todayOnly ? 'today' : props.scope || 'all' },
        h(
          'header',
          { className: 'dps-panel-head' },
          h(
            'div',
            { className: 'dps-panel-title' },
            h('h2', null, t('section.provider')),
            h('span', { className: 'dps-panel-meta', 'data-dps-field': 'provider-total', 'data-value': data.total }, t('chart.total', { value: formatTokens(data.total) })),
          ),
          h(
            'div',
            { className: 'dps-panel-tools' },
            // 顶部范围已经是本日时，卡片跟随范围看的就是今天：按钮没有用处，不显示
            props.scope === 'day'
              ? null
              : h(
                  'button',
                  {
                    type: 'button',
                    className: 'dps-ghost dps-toggle',
                    'data-dps-control': 'provider-today',
                    'aria-pressed': todayOnly ? 'true' : 'false',
                    onClick: () => props.onTodayOnly(!todayOnly),
                  },
                  t('provider.today'),
                ),
          ),
        ),
        data.rows.length === 0
          ? h('div', { className: 'dps-prov-empty' }, t('chart.empty'))
          : h(
              'div',
              { ref: tableRef, className: 'dps-prov-table', role: 'table', style: costColumn, 'data-tags': hasTags ? 'true' : undefined },
              h(
                'div',
                { className: 'dps-prov-row dps-prov-th', role: 'row' },
                h('span', { role: 'columnheader' }, t('provider.colName')),
                h('span', { role: 'columnheader' }, t('provider.colAmount')),
                h('span', { role: 'columnheader' }, t('provider.colShare')),
                h('span', { role: 'columnheader' }, t('provider.colHit')),
                h('span', { role: 'columnheader' }, t('provider.colCost')),
                hasTags ? h('span', { role: 'columnheader', 'aria-hidden': true }) : null,
              ),
              data.rows.map((row) =>
                h(
                  'div',
                  {
                    key: row.id,
                    className: 'dps-prov-row',
                    role: 'row',
                    'data-provider': row.id,
                    'data-value': row.tokens,
                    'data-share': row.share,
                    'data-hit': row.hitRate === null ? '' : row.hitRate,
                  },
                  nameCell(row),
                  h('span', { className: 'dps-prov-value', role: 'cell' }, formatTokens(row.tokens)),
                  h('span', { className: 'dps-prov-share', role: 'cell' }, formatPercent(row.share)),
                  h('span', { className: 'dps-prov-hit', role: 'cell' }, row.hitRate === null ? t('unit.none') : formatPercent(row.hitRate)),
                  costCell(row),
                  hasTags ? tagCell(row) : null,
                  h(
                    'span',
                    { className: 'dps-prov-track', 'aria-hidden': true },
                    h('span', { className: 'dps-prov-fill', style: { width: `${row.share}%`, minWidth: row.tokens > 0 ? '3px' : '0px' } }),
                  ),
                  billingOpen === row.id && row.id !== '__other'
                    ? h(BillingEditor, {
                        key: `billing-${row.id}`,
                        provider: row.id,
                        label: providerLabel(row.id, aliases),
                        billing: (costs && costs.byProvider[row.id] && costs.byProvider[row.id].billing) || billingOf(row.id, props.billingSettings),
                        listValue: costs && costs.byProvider[row.id] ? costs.byProvider[row.id].value : 0,
                        planMonth: props.planMonths ? ownValue(props.planMonths, row.id) : null,
                        onClose: () => setBillingOpen(null),
                        onSave: (entry) => {
                          setBillingOpen(null)
                          if (props.onBilling) props.onBilling(row.id, entry)
                        },
                      })
                    : null,
                ),
              ),
            ),
      )
    }

    /* ------------------------------------------------------------ 项目 */

    const PROJECT_ROWS = 8

    /** 路径的最后 n 段（Windows / POSIX 分隔符都认）。 */
    function pathTail(path, segments) {
      const parts = String(path || '').split(/[\\/]+/).filter(Boolean)
      return parts.length ? parts.slice(-segments).join('/') : String(path || '')
    }

    /**
     * byProject（各项目 token）+ byProjectSubagent（其中子代理会话的部分）+ paths（项目键 → 完整路径）
     * → 降序行；前 8 个各一行，其余合成「其他项目（N）」。名字取文件夹名；同名时带上上一级目录区分。
     */
    function deriveProjects(byProject, byProjectSubagent, paths) {
      const sub = byProjectSubagent || {}
      const pathOf = paths || {}
      const entries = Object.entries(byProject || {})
        .map(([id, tokens]) => ({ id, tokens: toNumber(tokens), subagent: Math.min(toNumber(sub[id]), toNumber(tokens)), path: pathOf[id] || id }))
        .filter((row) => row.tokens > 0)
        .sort((left, right) => right.tokens - left.tokens || (left.id < right.id ? -1 : 1))
      const total = entries.reduce((sum, row) => sum + row.tokens, 0)
      const subagentTotal = entries.reduce((sum, row) => sum + row.subagent, 0)
      const rows = entries.slice(0, PROJECT_ROWS)
      const rest = entries.slice(PROJECT_ROWS)
      // 文件夹名重复时逐级往上加目录，直到能区分（最多 3 级）
      const names = new Map()
      for (const row of rows) {
        if (!row.id) continue
        let depth = 1
        const clash = () => rows.some((other) => other !== row && other.id && pathTail(other.path, depth) === pathTail(row.path, depth))
        while (depth < 3 && clash()) depth += 1
        names.set(row.id, pathTail(row.path, depth))
      }
      const out = rows.map((row) => ({ ...row, name: row.id ? names.get(row.id) : '', other: false }))
      if (rest.length > 0) {
        out.push({
          id: '__other',
          tokens: rest.reduce((sum, row) => sum + row.tokens, 0),
          subagent: rest.reduce((sum, row) => sum + row.subagent, 0),
          path: rest.map((row) => row.path || row.id).join('\n'),
          name: '',
          other: true,
          count: rest.length,
        })
      }
      return {
        total,
        subagentTotal,
        rows: out.map((row) => ({
          ...row,
          share: total > 0 ? (row.tokens / total) * 100 : 0,
          subagentShare: row.tokens > 0 ? (row.subagent / row.tokens) * 100 : 0,
        })),
      }
    }

    function projectLabel(row) {
      if (row.other) return t('project.others', { count: row.count })
      return row.id ? row.name : t('project.unknown')
    }

    /** 项目卡：跟随顶部范围，按工作目录拆 token；进度条里浅色那段是子代理会话的用量。 */
    function ProjectCard(props) {
      const summary = props.summary || emptySummary()
      const data = useMemo(() => deriveProjects(summary.byProject, summary.byProjectSubagent, props.paths), [summary, props.paths])
      const costs = props.costs || null
      const shownIds = new Set(data.rows.map((row) => row.id))
      // 用量全部来自未设置 / 不计入的供应商的项目不在 byProject 里：写「—」，不写 ¥0
      const projectSpend = (row) => {
        if (!costs) return null
        if (row.other) {
          const rest = Object.entries(costs.byProject).filter(([id]) => !shownIds.has(id))
          return rest.length ? rest.reduce((sum, [, amount]) => sum + amount, 0) : null
        }
        return Object.prototype.hasOwnProperty.call(costs.byProject, row.id) ? toNumber(costs.byProject[row.id]) : null
      }
      return h(
        'section',
        { className: 'dps-panel dps-prov dps-proj', 'data-dps-card': 'project' },
        h(
          'header',
          { className: 'dps-panel-head' },
          h(
            'div',
            { className: 'dps-panel-title' },
            h('h2', null, t('section.project')),
            h('span', { className: 'dps-panel-meta', 'data-dps-field': 'project-total', 'data-value': data.total }, t('chart.total', { value: formatTokens(data.total) })),
          ),
        ),
        data.rows.length === 0
          ? h('div', { className: 'dps-prov-empty' }, t('chart.empty'))
          : h(
              'div',
              { className: 'dps-prov-table', role: 'table' },
              h(
                'div',
                { className: 'dps-prov-row dps-prov-th', role: 'row' },
                h('span', { role: 'columnheader' }, t('project.colName')),
                h('span', { role: 'columnheader' }, t('provider.colAmount')),
                h('span', { role: 'columnheader' }, t('provider.colShare')),
                h('span', { role: 'columnheader' }, t('project.colSubagent')),
                h('span', { role: 'columnheader' }, t('provider.colCost')),
              ),
              data.rows.map((row) =>
                h(
                  'div',
                  {
                    key: row.id || '__unknown',
                    className: 'dps-prov-row',
                    role: 'row',
                    'data-project': row.id,
                    'data-value': row.tokens,
                    'data-share': row.share,
                    'data-subagent': row.subagent,
                  },
                  h(
                    'span',
                    { className: 'dps-prov-namecell', role: 'cell' },
                    // 悬停看完整路径（「其他项目」列出被合并的那些）
                    h('span', { className: 'dps-prov-name', title: row.id ? row.path : projectLabel(row) }, projectLabel(row)),
                  ),
                  h('span', { className: 'dps-prov-value', role: 'cell' }, formatTokens(row.tokens)),
                  h('span', { className: 'dps-prov-share', role: 'cell' }, formatPercent(row.share)),
                  h('span', { className: 'dps-prov-hit', role: 'cell' }, row.subagent > 0 ? formatPercent(row.subagentShare) : t('unit.none')),
                  h(
                    'span',
                    { className: 'dps-prov-cost dps-proj-cost', role: 'cell', 'data-value': projectSpend(row) === null ? '' : projectSpend(row) },
                    projectSpend(row) === null ? t('unit.none') : formatMoney(projectSpend(row)),
                  ),
                  h(
                    'span',
                    { className: 'dps-prov-track', 'aria-hidden': true },
                    h(
                      'span',
                      { className: 'dps-proj-bar', style: { width: `${row.share}%`, minWidth: row.tokens > 0 ? '3px' : '0px' } },
                      h('span', { className: 'dps-proj-main', style: { flexGrow: row.tokens - row.subagent } }),
                      row.subagent > 0 ? h('span', { className: 'dps-proj-sub', style: { flexGrow: row.subagent } }) : null,
                    ),
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
.dps-actions{margin-left:auto;display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:8px;flex:0 1 auto}
.dps-seg[data-dps-control="range"] button{padding:7px 10px}
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
.dps-seg-thumb{position:absolute;top:2px;bottom:2px;left:2px;width:calc((100% - 4px) / var(--count));transform:translateX(calc(var(--index) * 100%));border-radius:7px;background:var(--dps-card);box-shadow:0 0 0 1px var(--dps-line),0 1px 2px var(--dps-shadow);transition:transform .22s cubic-bezier(.3,.7,.2,1),left .22s cubic-bezier(.3,.7,.2,1),width .22s cubic-bezier(.3,.7,.2,1)}
.dps-seg[data-fit="true"]{grid-auto-columns:auto}
.dps-seg[data-fit="true"]:not([data-measured="true"]) button[aria-pressed="true"]{background:var(--dps-card);box-shadow:0 0 0 1px var(--dps-line)}
.dps-seg-text{display:inline-block;max-width:13em;overflow:hidden;text-overflow:ellipsis;vertical-align:top}
.dps-seg button{appearance:none;position:relative;border:0;background:transparent;color:var(--dps-muted);font-size:12px;line-height:1;padding:7px 12px;border-radius:7px;cursor:pointer;white-space:nowrap;transition:color .15s ease}
.dps-seg button:hover{color:var(--dps-ink)}
.dps-seg button[aria-pressed="true"]{color:var(--dps-ink);font-weight:600}
.dps-kpis{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1.15fr) repeat(4,minmax(0,1fr));gap:12px}
.dps-kpi{min-width:0;display:flex;flex-direction:column;justify-content:space-between;gap:16px;padding:16px 18px 18px;border:1px solid var(--dps-line);border-radius:var(--dps-radius);background:var(--dps-card)}
.dps-kpi[data-hero="true"]{border-color:color-mix(in srgb,var(--dps-accent) 30%,var(--dps-line));background:color-mix(in srgb,var(--dps-accent) 5%,var(--dps-card))}
.dps-kpi-label{display:flex;flex-wrap:wrap;align-items:center;gap:4px 7px;min-width:0;font-size:12.5px;color:var(--dps-muted)}
.dps-kpi-label svg{width:15px;height:15px;flex:0 0 auto}
.dps-kpi-label span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dps-kpi[data-hero="true"] .dps-kpi-label svg{color:var(--dps-accent)}
.dps-kpi-body{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;min-width:0}
.dps-kpi-main{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 10px;flex:0 0 auto;max-width:100%}
.dps-kpi-main > *{flex:0 0 auto}
.dps-kpi[data-hero="true"] .dps-kpi-main{flex:1 1 auto}
.dps-kpi[data-hero="true"] .dps-delta{margin-left:auto}
.dps-kpi-slot{display:inline-grid;justify-items:start;align-items:baseline}
.dps-kpi-slot > *{grid-area:1 / 1}
.dps-kpi-ghost{display:flex;align-items:baseline;white-space:nowrap;font-variant-numeric:tabular-nums;visibility:hidden;pointer-events:none}
.dps-kpi-ghost [data-ghost]::before{content:attr(data-ghost)}
.dps-kpi-value{display:flex;align-items:baseline;flex-wrap:nowrap;white-space:nowrap;min-width:0;font-variant-numeric:tabular-nums}
.dps-num{font-size:28px;font-weight:650;line-height:1;letter-spacing:-.02em}
.dps-num-empty{color:var(--dps-faint);font-weight:500}
.dps-unit{font-size:13px;font-weight:500;color:var(--dps-muted);margin:0 7px 0 3px}
.dps-unit:last-child{margin-right:0}
.dps-kpi[data-hero="true"] .dps-num{font-size:32px}
.dps-spark-wrap{position:relative;display:block}
.dps-spark{width:100%;height:32px;display:block}
.dps-spark-line{fill:none;stroke:var(--dps-accent);stroke-width:1.6;stroke-linejoin:round;stroke-linecap:round;vector-effect:non-scaling-stroke}
.dps-spark-end{position:absolute;width:8px;height:8px;border-radius:50%;background:var(--dps-accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--dps-accent) 5%,var(--dps-card));transform:translate(-50%,-50%);pointer-events:none}

.dps-kpi-sub{font-size:12px;color:var(--dps-muted);white-space:nowrap;font-variant-numeric:tabular-nums}
.dps-unit.dps-unit-pre{margin:0 2px 0 0}
.dps-menu .dps-range-pop{flex-direction:row;align-items:flex-end;gap:10px;padding:12px}
.dps-date-field{display:flex;flex-direction:column;gap:5px;font-size:11.5px;color:var(--dps-muted);white-space:nowrap}
.dps-date{height:30px;padding:0 8px;border:1px solid var(--dps-line);border-radius:8px;background:var(--dps-card);color:var(--dps-ink);font:inherit;font-size:12.5px;color-scheme:light}
body[data-ds-dark-theme] .dps-date{color-scheme:dark}
.dps-range-pop .dps-btn{height:30px;padding:0 14px;border-radius:8px;text-align:center;border:1px solid var(--dps-line);background:var(--dps-card)}
.dps-btn[data-primary="true"]{background:var(--dps-accent);border-color:transparent;color:var(--dps-on-accent);font-weight:600}
.dps-btn[data-primary="true"]:hover{background:var(--dps-accent);filter:brightness(1.06)}
.dps-btn:disabled{opacity:.45;cursor:default}
.dps-delta{display:inline-flex;align-items:center;gap:3px;align-self:center;padding:3px 7px 3px 5px;border-radius:999px;font-size:11.5px;font-weight:600;line-height:1;white-space:nowrap;font-variant-numeric:tabular-nums;color:var(--dps-muted);background:color-mix(in srgb,var(--dps-muted) 12%,transparent)}
.dps-delta svg{width:11px;height:11px;flex:0 0 auto}
.dps-delta[data-dir="up"]{color:var(--dsw-alias-state-error-primary)}
.dps-delta[data-dir="down"]{color:var(--dsw-alias-state-success-primary)}
.dps-delta[data-dir="up"]{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent)}
.dps-delta[data-dir="down"]{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 13%,transparent)}
.dps-menu{position:relative;display:flex}
.dps-menu-pop{position:absolute;right:0;top:calc(100% + 6px);z-index:80;min-width:156px;padding:5px;border-radius:10px;border:1px solid var(--dps-line);background:var(--dsw-alias-bg-layer-2);box-shadow:0 10px 30px var(--dps-shadow);display:flex;flex-direction:column;gap:2px}
.dps-menu-pop button{appearance:none;border:0;background:transparent;color:var(--dps-ink);font-size:12.5px;line-height:1.4;text-align:left;padding:8px 10px;border-radius:7px;cursor:pointer;white-space:nowrap}
.dps-menu-pop button:hover{background:var(--dps-hover)}
.dps-grid{display:grid;grid-template-columns:minmax(0,1.62fr) minmax(0,1fr);gap:16px;align-items:stretch}
@container dps (max-width:860px){
.dps-top{flex-wrap:wrap}
.dps-actions{flex:1 1 100%;margin-left:0;justify-content:flex-start}
}
@container dps (max-width:1040px){
.dps-kpis{grid-template-columns:repeat(3,minmax(0,1fr))}
.dps-grid[data-row="lists"]{grid-template-columns:minmax(0,1fr)}
.dps-grid{grid-template-columns:minmax(0,1fr)}
}
@container dps (max-width:720px){
.dps-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}
.dps-grid[data-row="lists"]{grid-template-columns:minmax(0,1fr)}
.dps-num{font-size:24px}
.dps-kpi[data-hero="true"] .dps-num{font-size:30px}
}
@keyframes dps-enter{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@keyframes dps-fade{from{opacity:0}to{opacity:1}}
@keyframes dps-rise{from{transform:scaleY(0)}to{transform:scaleY(1)}}
@keyframes dps-wipe{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}
.dps-page > *{animation:dps-enter .5s cubic-bezier(.2,.7,.2,1) backwards}
.dps-page > :nth-child(2){animation-delay:40ms}
.dps-page > :nth-child(3){animation-delay:80ms}
.dps-page > :nth-child(4){animation-delay:130ms}
.dps-page > :nth-child(5){animation-delay:180ms}
.dps-page > :nth-child(6){animation-delay:230ms}
.dps-act-layer{animation:dps-fade .32s ease backwards}
.dps-act-layer[data-layer="week"] .dps-act-bar{transform-box:fill-box;transform-origin:50% 100%;animation:dps-rise .5s cubic-bezier(.2,.7,.2,1) backwards;animation-delay:calc(var(--i,0) * 6ms)}
.dps-act-layer[data-layer="total"]{animation:dps-wipe .7s cubic-bezier(.3,.6,.2,1) backwards}
.dps-mc-stack{transform-origin:50% 100%;animation:dps-rise .55s cubic-bezier(.2,.7,.2,1) backwards;animation-delay:calc(var(--i,0) * 26ms);transition:height .45s cubic-bezier(.3,.7,.2,1)}
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
.dps-act-cell[data-in-range="true"]{stroke:color-mix(in srgb,var(--dps-accent) 55%,transparent);stroke-width:.9;vector-effect:non-scaling-stroke}
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
.dps-mc-bars{position:absolute;inset:0;display:grid;grid-template-columns:repeat(var(--mc-count,12),minmax(0,1fr))}
.dps-mc-col{position:relative;min-width:0;display:flex;align-items:flex-end;justify-content:center;border-radius:7px 7px 0 0;transition:opacity .15s ease,background-color .15s ease}
.dps-mc-col[data-active="true"]{background:var(--dps-hover)}
.dps-mc-col[data-dim="true"]{opacity:.45}
.dps-mc-stack{width:min(30px,58%);min-height:0;display:flex;flex-direction:column-reverse;border-radius:5px 5px 1.5px 1.5px;overflow:hidden}
.dps-mc-seg{display:block;flex:0 0 auto;width:100%}
.dps-mc-seg + .dps-mc-seg{box-shadow:inset 0 -1.5px 0 var(--dps-card)}
.dps-mc-empty{position:absolute;inset:0;display:grid;place-items:center;font-size:12.5px;color:var(--dps-faint);pointer-events:none}
.dps-mc-pie{flex:1 1 auto;min-height:250px;display:flex;align-items:center;justify-content:center;padding-left:52px}
.dps-pie-plot{position:relative;width:100%;display:grid;place-items:center;border-radius:8px}
.dps-pie-plot:focus-visible{outline-offset:4px}
.dps-pie{display:block;width:min(100%,340px);height:auto;max-height:250px;overflow:visible;animation:dps-pie-in .45s cubic-bezier(.2,.7,.2,1) backwards}
.dps-pie-track{fill:none;stroke:var(--dps-track);stroke-width:1}
.dps-pie-slice{stroke:var(--dps-card);stroke-width:2;stroke-linejoin:round;transition:opacity .15s ease,transform .18s ease}
.dps-pie-slice[data-dim="true"]{opacity:.45}
.dps-pie-label{font-size:11px;fill:var(--dps-muted);font-variant-numeric:tabular-nums}
@keyframes dps-pie-in{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:none}}
.dps-mc-ticks{display:grid;grid-template-columns:repeat(var(--mc-count,12),minmax(0,1fr));font-size:11px;color:var(--dps-faint);text-align:center;font-variant-numeric:tabular-nums}
.dps-mc-ticks span{white-space:nowrap;overflow:visible}
.dps-legend{list-style:none;margin:0;padding:2px 0 0 52px;display:flex;flex-wrap:wrap;justify-content:center;gap:8px 18px;font-size:12px}
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
.dps-panel-tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dps-proj-bar{display:flex;height:100%;border-radius:inherit;overflow:hidden;transition:width .45s cubic-bezier(.3,.7,.2,1)}
.dps-proj-main{flex:0 1 0;min-width:0;background:var(--dps-accent)}
.dps-proj-sub{flex:0 1 0;min-width:2px;background:color-mix(in srgb,var(--dps-accent) 45%,transparent)}
.dps-hit{margin-top:auto;padding-top:12px;border-top:1px solid var(--dps-hair);display:flex;flex-direction:column;gap:8px}
.dps-hit-label{font-size:11.5px;color:var(--dps-faint)}
.dps-hit-body{display:grid;grid-template-columns:34px minmax(0,1fr);column-gap:8px}
.dps-hit-axis{position:relative;font-size:10.5px;color:var(--dps-faint);font-variant-numeric:tabular-nums}
.dps-hit-axis span{position:absolute;right:0;transform:translateY(-50%);line-height:1;white-space:nowrap}
.dps-hit-plot{border-top:1px dashed var(--dps-line);border-bottom:1px solid var(--dps-line)}
.dps-hit-svg{height:44px;overflow:visible}
.dps-prov-table{display:flex;flex-direction:column;gap:14px}
.dps-prov-row{display:grid;grid-template-columns:minmax(0,1fr) 60px 44px 52px var(--dps-cost-w,68px);align-items:baseline;column-gap:10px;row-gap:7px;font-size:13px}
.dps-prov-th{margin-bottom:-6px;font-size:11.5px;color:var(--dps-faint)}
.dps-prov-th span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dps-prov-th span:nth-child(n+2),.dps-prov-value,.dps-prov-share,.dps-prov-hit,.dps-prov-costcell,.dps-prov-cost{text-align:right}
.dps-prov-cost{appearance:none;border:0;background:transparent;padding:0;font:inherit;font-size:13px;color:var(--dps-ink);font-variant-numeric:tabular-nums;white-space:nowrap}
button.dps-prov-cost{cursor:pointer;border-bottom:1px dashed transparent}
button.dps-prov-cost:hover{border-bottom-color:var(--dps-muted)}
.dps-prov-cost[data-mode="unset"]{color:var(--dps-accent);font-weight:600}
.dps-prov-cost[data-mode="free"]{color:var(--dps-muted)}
.dps-proj .dps-prov-row{grid-template-columns:minmax(0,1fr) 60px 44px 62px var(--dps-cost-w,68px)}
.dps-bill{grid-column:1 / -1;display:flex;flex-direction:column;gap:10px;margin-top:2px;padding:12px;border:1px solid var(--dps-line);border-radius:10px;background:var(--dps-hover)}
.dps-bill .dps-seg{align-self:flex-start}
.dps-bill-fields{display:flex;flex-wrap:wrap;align-items:flex-end;gap:10px}
.dps-bill-input{width:104px}
.dps-prov-table[data-tags="true"] .dps-prov-row{grid-template-columns:minmax(0,1fr) 56px 42px 52px var(--dps-cost-w,50px) var(--dps-tag-w,34px);column-gap:7px}
.dps-prov-tagcell{display:flex;align-items:center;min-width:0;margin-left:-2px}
.dps-cost-tag{display:inline-block;padding:0 4px;border-radius:4px;background:color-mix(in srgb,var(--dps-accent) 90%,var(--dps-ink));color:var(--dps-card);font-size:10.5px;font-weight:600;line-height:16px;white-space:nowrap;cursor:pointer}
body[data-ds-dark-theme] .dps-cost-tag:not([data-error="true"]){background:var(--dps-accent)}
.dps-cost-tag[data-error="true"]{background:var(--dsw-alias-state-error-primary)}
.dps-bill-foot{display:flex;align-items:center;flex-wrap:wrap;gap:8px}
.dps-bill-meta{margin-right:auto;font-size:12px;color:var(--dps-muted);font-variant-numeric:tabular-nums;white-space:nowrap}
.dps-bill .dps-btn{height:28px;padding:0 12px}
.dps-prov-namecell{position:relative;display:flex;align-items:center;min-width:0}
.dps-prov-name{min-width:0;color:var(--dps-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dps-prov-edit{appearance:none;position:absolute;right:0;top:50%;transform:translateY(-50%);box-shadow:-8px 0 8px var(--dps-card);display:grid;place-items:center;width:20px;height:20px;padding:0;border:0;border-radius:6px;background:var(--dps-card);color:var(--dps-muted);cursor:pointer;opacity:0;transition:opacity .15s ease,background-color .15s ease}
.dps-prov-edit svg{width:13px;height:13px}
.dps-prov-row:hover .dps-prov-edit,.dps-prov-edit:focus-visible{opacity:1}
.dps-prov-edit:hover{background:color-mix(in srgb,var(--dps-ink) 7%,var(--dps-card));color:var(--dps-ink)}
.dps-prov-input{width:100%;min-width:0;height:24px;margin:-3px 0;padding:0 7px;border:1px solid var(--dps-accent);border-radius:6px;background:var(--dps-card);color:var(--dps-ink);font:inherit;font-size:13px;outline:none}
.dps-root .dps-prov-input:focus-visible{outline:none}
.dps-prov-value{font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}
.dps-prov-share{color:var(--dps-muted);font-variant-numeric:tabular-nums;white-space:nowrap}
.dps-prov-hit{color:var(--dps-ink);font-variant-numeric:tabular-nums;white-space:nowrap}
.dps-toggle[aria-pressed="true"]{color:var(--dps-ink);border-color:color-mix(in srgb,var(--dps-accent) 55%,var(--dps-line));background:color-mix(in srgb,var(--dps-accent) 9%,transparent);font-weight:600}
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
    /**
     * 分段开关。默认每段等宽，滑块按序号平移；fit = true 时每段按自己的文字宽度（顶部范围开关：自定义的日期可能很长，
     * 等宽会把六段一起撑宽、挤出窗口），滑块量出按下那段的位置和宽度。量不到（没有布局）时不画滑块，按下那段自己带底色。
     */
    function Segmented(props) {
      const options = props.options
      const index = Math.max(0, options.findIndex((option) => option.id === props.value))
      const groupRef = useRef(null)
      const [thumb, setThumb] = useState(null)
      const labels = options.map((option) => String(option.title || option.label)).join('\u0000')
      useLayoutEffect(() => {
        if (!props.fit) return undefined
        const group = groupRef.current
        const measure = () => {
          const button = group && typeof group.querySelector === 'function' ? group.querySelector('button[aria-pressed="true"]') : null
          const next = button && button.offsetWidth > 0 ? { left: button.offsetLeft, width: button.offsetWidth } : null
          setThumb((current) => (current && next && current.left === next.left && current.width === next.width ? current : next))
        }
        measure()
        if (typeof ResizeObserver !== 'function' || !group) return undefined
        const observer = new ResizeObserver(measure)
        observer.observe(group)
        return () => observer.disconnect()
      }, [props.fit, props.value, labels])
      const thumbStyle = props.fit ? (thumb ? { left: `${thumb.left}px`, width: `${thumb.width}px`, transform: 'none' } : { display: 'none' }) : undefined
      return h(
        'div',
        {
          ref: groupRef,
          className: 'dps-seg',
          role: 'group',
          'aria-label': props.label,
          'data-dps-control': props.control,
          'data-fit': props.fit ? 'true' : undefined,
          'data-measured': props.fit && thumb ? 'true' : undefined,
          style: { '--index': index, '--count': options.length },
          // ←/→ 从有焦点的那一段移到相邻一段并切换，焦点跟着走。按选中值算会出错：
          // 「自定义」只打开浮层、不改选中值，再按 ← 会从选中的那段往回跳，跳过中间的选项。
          onKeyDown: (event) => {
            const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
            if (!step) return
            if (typeof event.preventDefault === 'function') event.preventDefault()
            const focused = event.target && typeof event.target.getAttribute === 'function' ? event.target.getAttribute('data-value') : null
            const from = options.findIndex((option) => option.id === focused)
            const next = options[((from >= 0 ? from : index) + step + options.length) % options.length]
            props.onChange(next.id)
            const group = event.currentTarget
            if (group && typeof group.querySelector === 'function') {
              const button = group.querySelector(`button[data-value="${next.id}"]`)
              if (button && typeof button.focus === 'function') button.focus()
            }
          },
        },
        h('span', { className: 'dps-seg-thumb', 'aria-hidden': true, style: thumbStyle }),
        options.map((option) =>
          h(
            'button',
            {
              key: option.id,
              type: 'button',
              'data-value': option.id,
              'aria-pressed': option.id === props.value ? 'true' : 'false',
              title: option.title || undefined,
              onClick: () => {
                if (option.id !== props.value) props.onChange(option.id)
                else if (props.onReselect) props.onReselect(option.id)
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
          part.prefix ? h('span', { className: 'dps-unit dps-unit-pre' }, part.prefix) : null,
          h('span', { className: 'dps-num' }, part.value),
          part.unit ? h('span', { className: 'dps-unit' }, part.unit) : null,
        ),
      )
    }

    /* ------------------------------------------------------------------ 页头 */

    /**
     * 浮层的关闭方式：点浮层外面、按 Esc。onClose(reason) 的 reason 是 'outside' 或 'escape'
     * （按 Esc 关掉时把焦点还给打开它的按钮；点外面时焦点已经在别处了，不抢）。
     */
    function useDismiss(open, wrapRef, onClose) {
      const closeRef = useRef(onClose)
      closeRef.current = onClose
      useEffect(() => {
        if (!open || typeof document === 'undefined') return undefined
        const outside = (event) => {
          if (wrapRef.current && typeof wrapRef.current.contains === 'function' && !wrapRef.current.contains(event.target)) closeRef.current('outside')
        }
        const onKey = (event) => {
          if (event.key === 'Escape') closeRef.current('escape')
        }
        document.addEventListener('mousedown', outside)
        document.addEventListener('keydown', onKey)
        return () => {
          document.removeEventListener('mousedown', outside)
          document.removeEventListener('keydown', onKey)
        }
      }, [open, wrapRef])
    }

    /** 把焦点还给浮层的开关按钮（selector 在 wrap 里找）。 */
    function focusWithin(wrapRef, selector) {
      const node = wrapRef.current
      const button = node && typeof node.querySelector === 'function' ? node.querySelector(selector) : null
      if (button && typeof button.focus === 'function') button.focus()
    }

    /** 导出按钮 + 下拉两项（CSV / JSON）。点外面或按 Esc 关闭。 */
    function ExportMenu(props) {
      const [open, setOpen] = useState(false)
      const wrapRef = useRef(null)
      useDismiss(open, wrapRef, (reason) => {
        setOpen(false)
        if (reason === 'escape') focusWithin(wrapRef, '[data-dps-action="export"]')
      })
      const pick = (format) => {
        setOpen(false)
        props.onExport(format)
      }
      return h(
        'div',
        { ref: wrapRef, className: 'dps-menu', 'data-dps-control': 'export' },
        h(
          'button',
          {
            type: 'button',
            className: 'dps-iconbtn',
            'data-dps-action': 'export',
            'aria-label': t('action.export'),
            'aria-haspopup': 'menu',
            'aria-expanded': open ? 'true' : 'false',
            title: t('action.export'),
            onClick: () => setOpen((value) => !value),
          },
          h(Icon, { name: 'download' }),
        ),
        open
          ? h(
              'div',
              { className: 'dps-menu-pop', role: 'menu' },
              h('button', { type: 'button', role: 'menuitem', 'data-dps-export': 'csv', onClick: () => pick('csv') }, t('action.exportCsv')),
              h('button', { type: 'button', role: 'menuitem', 'data-dps-export': 'json', onClick: () => pick('json') }, t('action.exportJson')),
            )
          : null,
      )
    }

    /** 自定义范围：两个原生日期框 + 确定。日期不早于有数据的第一天、不晚于今天；起止颠倒时自动对调。 */
    function RangePicker(props) {
      const [startKey, setStartKey] = useState(props.startKey || '')
      const [endKey, setEndKey] = useState(props.endKey || '')
      // 手动敲的日期能越过 max：两个都晚于今天时不能确定（否则会悄悄变成「今天」一天）
      const earliest = startKey <= endKey ? startKey : endKey
      const valid = Boolean(parseDateKey(startKey) && parseDateKey(endKey)) && (!props.maxKey || earliest <= props.maxKey)
      const apply = () => {
        if (!valid) return
        if (startKey <= endKey) props.onApply(startKey, endKey)
        else props.onApply(endKey, startKey)
      }
      const field = (label, value, setValue, name) =>
        h(
          'label',
          { className: 'dps-date-field' },
          h('span', null, label),
          h('input', {
            type: 'date',
            className: 'dps-date',
            'data-dps-field': name,
            value,
            min: props.minKey || undefined,
            max: props.maxKey || undefined,
            onChange: (event) => setValue(event.target.value),
          }),
        )
      return h(
        'div',
        {
          className: 'dps-menu-pop dps-range-pop',
          role: 'dialog',
          'aria-label': t('range.custom'),
          'data-dps-control': 'range-picker',
          onKeyDown: (event) => {
            if (event.key === 'Enter') apply()
          },
        },
        field(t('range.from'), startKey, setStartKey, 'range-start'),
        field(t('range.to'), endKey, setEndKey, 'range-end'),
        h('button', { type: 'button', className: 'dps-btn', 'data-primary': 'true', 'data-dps-action': 'range-apply', disabled: !valid, onClick: apply }, t('action.apply')),
      )
    }

    /**
     * 顶部范围开关 + 自定义日期浮层。点「自定义」高亮马上移过去、打开浮层，点「确定」才换数据；
     * 没点确定就关掉（点外面、Esc、再点一次自定义），高亮回到原来的范围。
     */
    function RangeControl(props) {
      const [picking, setPicking] = useState(false)
      const wrapRef = useRef(null)
      const focusCustom = () => focusWithin(wrapRef, 'button[data-value="custom"]')
      useDismiss(picking, wrapRef, (reason) => {
        setPicking(false)
        if (reason === 'escape') focusCustom()
      })
      const rangeWin = props.rangeWin || {}
      const isCustom = props.range === 'custom'
      const customText = isCustom ? rangeText(rangeWin, props.todayKey) : ''
      return h(
        'div',
        { ref: wrapRef, className: 'dps-menu dps-range-menu' },
        h(Segmented, {
          control: 'range',
          label: t('aria.range'),
          fit: true,
          // 浮层开着时高亮在「自定义」上（正在选日期），数据仍是原来的范围
          value: picking ? 'custom' : props.range,
          onChange: (id) => {
            if (id === 'custom') {
              setPicking(true)
              return
            }
            setPicking(false)
            props.onRange(id)
          },
          onReselect: (id) => {
            if (id === 'custom') setPicking((open) => !open)
          },
          options: RANGE_IDS.map((id) =>
            id === 'custom' && isCustom
              ? { id, label: h('span', { className: 'dps-seg-text' }, customText), title: customText }
              : { id, label: t(`range.${id}`) },
          ),
        }),
        picking
          ? h(RangePicker, {
              startKey: rangeWin.startKey || props.firstKey || props.todayKey,
              endKey: rangeWin.endKey || props.todayKey,
              minKey: props.firstKey,
              maxKey: props.todayKey,
              onApply: (startKey, endKey) => {
                setPicking(false)
                props.onCustom(startKey, endKey)
                focusCustom()
              },
            })
          : null,
      )
    }

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
          h(RangeControl, {
            range: props.range,
            rangeWin: props.rangeWin,
            firstKey: props.firstKey,
            todayKey: props.todayKey,
            onRange: props.onRange,
            onCustom: props.onCustom,
          }),
          h(ExportMenu, { onExport: props.onExport }),
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
     * 只在有事可说时出现：首次全量扫描的进度、读取失败（带重试）、没有任何会话。
     * 宿主在后台定时保鲜补扫时不提示——数字补扫完会自己更新。都是状态，不是说明文字。
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
      // 只有首次全量扫描（数字还不完整）或者还没有任何数据时才显示进度
      if (snapshot.scanning && (snapshot.firstScan || !hasData)) {
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

    function Kpi(props) {
      return h(
        'div',
        {
          className: 'dps-kpi',
          'data-dps-kpi': props.id,
          'data-value': props.raw === undefined ? '' : String(props.raw),
          'data-hero': props.hero ? 'true' : 'false',
          title: props.title || undefined,
        },
        h('div', { className: 'dps-kpi-label' }, h(Icon, { name: props.icon }), h('span', null, props.label)),
        h(
          'div',
          { className: 'dps-kpi-body' },
          h(
            'div',
            { className: 'dps-kpi-main' },
            props.reserve
              ? // 数字格按最宽的写法占位（不可见、和数字叠在同一格）：数字滚动时位数和单位在变，
                // 放不放得下、环比在哪都按最宽的数算，滚到哪一帧都不跳。占位的字由 CSS 画，不进页面文本
                h(
                  'div',
                  { className: 'dps-kpi-slot' },
                  h('div', { className: 'dps-kpi-value', 'data-dps-field': 'value' }, h(ValueParts, { parts: props.parts })),
                  h(
                    'div',
                    { className: 'dps-kpi-ghost', 'aria-hidden': true },
                    h('span', { className: 'dps-num', 'data-ghost': props.reserve.value }),
                    h('span', { className: 'dps-unit', 'data-ghost': props.reserve.unit }),
                  ),
                )
              : h('div', { className: 'dps-kpi-value', 'data-dps-field': 'value' }, h(ValueParts, { parts: props.parts })),
            props.extra || null,
          ),
        ),
      )
    }

    function KpiStrip(props) {
      const k = props.kpis
      const ready = props.ready
      const range = props.range || 'all'
      const summary = props.summary || emptySummary()
      const delta = props.delta === undefined ? null : props.delta
      // 首次拿到数据时从 0 计数到目标值，之后的变化做短过渡；未就绪时目标为 0（显示「—」）
      const shownRange = useTween(ready ? summary.tokens : 0, 900)
      const shownToday = useTween(ready ? k.today : 0, 900)
      const shownTurn = useTween(ready ? k.longestTurnMs : 0, 900)
      const shownLongest = useTween(ready ? k.longestStreak : 0, 700)
      const shownCurrent = useTween(ready ? k.currentStreak : 0, 700)
      const todayHit = props.todayHit === undefined ? null : props.todayHit
      const shownHit = useTween(ready && todayHit !== null ? todayHit : 0, 900)
      const costs = props.costs || null
      const shownCost = useTween(ready && costs ? costs.spend : 0, 900)
      // 所有有用量的供应商都没设置计费方式时，不知道花了多少：显示「—」
      const costKnown = Boolean(costs) && Object.values(costs.byProvider).some((row) => row.mode !== 'unset')
      const costHints = []
      if (costs && costs.unset.length) costHints.push(t('cost.hintUnset', { count: costs.unset.length }))
      if (costs && costs.unpricedTokens > 0) costHints.push(t('cost.hintUnpriced'))
      const tokenValue = (value) => [tokenParts(Math.round(value))]
      const dayValue = (value) => [{ value: String(Math.max(0, Math.round(toNumber(value)))), unit: t('unit.day') }]
      const percentValue = (value) => [{ value: formatPercent(value).replace('%', ''), unit: '%' }]
      const rangeName = range === 'custom' ? rangeText(props.rangeWin, props.todayKey) : t(`range.${range}`)
      const rangeLabel = range === 'all' ? t('stat.tokens') : t('stat.rangeTokens', { range: rangeName })
      const costLabel = range === 'all' ? t('stat.totalCost') : t('stat.cost', { range: rangeName })
      const deltaChip =
        delta === null
          ? null
          : h(
              'span',
              {
                className: 'dps-delta',
                'data-dps-field': 'delta',
                'data-value': delta,
                'data-dir': delta >= 0 ? 'up' : 'down',
                title: t('delta.hint'),
              },
              h(
                'svg',
                { viewBox: '0 0 12 12', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
                h('path', { d: delta >= 0 ? 'M6 10V2M2.6 5.4 6 2l3.4 3.4' : 'M6 2v8M2.6 6.6 6 10l3.4-3.4' }),
              ),
              formatDelta(delta),
            )
      return h(
        'section',
        { className: 'dps-kpis', 'data-dps-card': 'kpis', 'data-range': range },
        h(Kpi, {
          id: 'tokens',
          icon: 'tokens',
          hero: true,
          label: rangeLabel,
          raw: ready ? summary.tokens : undefined,
          parts: ready ? tokenValue(shownRange) : null,
          // 环比贴在这一行的右边，位置不随数字的位数变；最宽的写法：一亿以下是四位整数的「万」，英文是三位整数的 M
          extra: deltaChip,
          reserve: isChineseLocale() ? { value: '8888.8', unit: '万' } : { value: '888.8', unit: 'M' },
        }),
        // 所选范围的花费（按各家计费方式；未设置的不计入，悬停写出来）
        h(Kpi, {
          id: 'cost',
          icon: 'wallet',
          label: costLabel,
          raw: ready && costKnown ? costs.spend : undefined,
          parts: ready && costKnown ? moneyParts(shownCost) : null,
          title: costHints.join('\n'),
        }),
        h(Kpi, { id: 'today', icon: 'today', label: t('stat.today'), raw: ready ? k.today : undefined, parts: ready ? tokenValue(shownToday) : null }),
        h(Kpi, {
          id: 'longestTurn',
          icon: 'clock',
          label: t('stat.longestTurn'),
          raw: ready ? k.longestTurnMs : undefined,
          parts: ready ? durationParts(k.longestTurnMs > 0 ? Math.max(60000, shownTurn) : 0) : null,
        }),
        // 最长 / 当前连续天数合成一张：两个数经常相同，各占一张卡太浪费
        h(Kpi, {
          id: 'streak',
          icon: 'flame',
          label: t('stat.streak'),
          raw: ready ? k.currentStreak : undefined,
          parts: ready ? dayValue(shownCurrent) : null,
          extra: ready
            ? h('span', { className: 'dps-kpi-sub', 'data-dps-field': 'longest', 'data-value': k.longestStreak }, t('stat.best', { n: Math.round(shownLongest) }))
            : null,
        }),
        h(Kpi, {
          id: 'todayHit',
          icon: 'target',
          label: t('stat.todayHit'),
          raw: ready && todayHit !== null ? todayHit : undefined,
          parts: ready && todayHit !== null ? percentValue(shownHit) : null,
        }),
      )
    }

    /* ------------------------------------------------------------------ 页面 */

    /** 对象自己的属性（不读原型上的同名属性）；没有时是 null。 */
    function ownValue(object, key) {
      return object && Object.prototype.hasOwnProperty.call(object, key) ? object[key] : null
    }

    /** 两个 JSON 值是否相同（键的顺序不算）。 */
    function sameValue(left, right) {
      const stable = (value) => {
        if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
        if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
        return JSON.stringify(value === undefined ? null : value)
      }
      return stable(left) === stable(right)
    }

    function dropKey(object, key) {
      if (!Object.prototype.hasOwnProperty.call(object, key)) return object
      const next = { ...object }
      delete next[key]
      return next
    }

    /** 页面上的改动里，快照已经跟上的那些丢掉；都没跟上时返回原对象（不触发重绘）。 */
    function settleEdits(edits, savedOf) {
      let next = edits
      for (const [id, value] of Object.entries(edits)) if (sameValue(value === null ? null : value, savedOf(id))) next = dropKey(next, id)
      return next
    }

    /** POST 一份 JSON；宿主回 ok: false（或 HTTP 出错）时抛错，错误的 message 是宿主给的原因。 */
    async function postJson(url, body) {
      const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const result = await response.json().catch(() => null)
      if (!response.ok || !result || result.ok !== true) throw new Error((result && result.error) || `HTTP ${response.status}`)
      return result
    }

    function errorReason(error) {
      return String((error && error.message) || error || 'error')
    }

    function ProfilePage() {
      useLocaleRevision()
      const { snapshot, error, refresh, reload } = useSnapshot()
      const mounted = useMounted()
      const [refreshing, setRefreshing] = useState(false)
      // 用户亲手点的刷新：图标一直转到这次重扫结束；宿主后台的保鲜补扫不转
      const [manualScan, setManualScan] = useState(false)
      const [updating, setUpdating] = useState(false)
      // 顶部时间范围：本日、本周、本月、累计、自定义（custom 记自定义的起止日期）；默认累计
      const [range, setRange] = useState('all')
      const [custom, setCustom] = useState(null)
      // 供应商卡片的「今日」按钮；换顶部范围时弹起，卡片回到跟随范围
      const [providerToday, setProviderToday] = useState(false)
      const changeRange = useCallback((next) => {
        setRange(next)
        setProviderToday(false)
      }, [])
      const applyCustom = useCallback((startKey, endKey) => {
        setCustom({ startKey, endKey })
        setRange('custom')
        setProviderToday(false)
      }, [])
      // 供应商的本机显示名：快照里的 + 这次会话里刚改的（保存成功前先显示，失败就撤回）
      const [aliasEdits, setAliasEdits] = useState({})
      // 计费方式同理：id → 设置；null 表示刚恢复成默认
      const [billingEdits, setBillingEdits] = useState({})
      // 没存上的计费方式 / 汇率：id → 宿主给的原因（费用格的标签换成「未保存」，悬停写原因）
      const [billingErrors, setBillingErrors] = useState({})

      // 打开页面不再强制重扫：宿主在后台定时保鲜，读快照时数据旧了也会自己静默补扫。
      // 连点两下时第一下先结束：等所有这次点出来的请求都回来才停转，否则图标会在宿主还在扫的时候停下
      const refreshesRef = useRef(0)
      const runRefresh = useCallback(async () => {
        refreshesRef.current += 1
        setRefreshing(true)
        setManualScan(true)
        try {
          await refresh()
        } finally {
          refreshesRef.current -= 1
          if (mounted.current && refreshesRef.current === 0) setRefreshing(false)
        }
      }, [refresh, mounted])

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

      // —— 时间范围：汇总卡都从日明细重算，宿主算好的全局 totals 只留给连续天数等全局指标 ——
      const rangeWin = useMemo(() => rangeWindow(range, todayKey, custom), [range, todayKey, custom])
      const rangeSummary = useMemo(
        () => summarizeDaily(daily, rangeWin.startKey, rangeWin.endKey),
        [daily, rangeWin.startKey, rangeWin.endKey],
      )
      // 有数据的第一天（键已校验为定长 YYYY-MM-DD，字典序即日期序）
      const firstKey = useMemo(() => {
        let first = ''
        for (const key of indexDaily(daily).keys()) if (!first || key < first) first = key
        return first
      }, [daily])
      // 上一期必须完全落在有数据的日子里才比：只覆盖一部分时，环比会被放大成几百个百分点
      const delta = useMemo(() => {
        const windows = deltaWindows(rangeWin, todayKey)
        if (!windows || !firstKey || windows.previous.startKey < firstKey) return null
        const current = summarizeDaily(daily, windows.current.startKey, windows.current.endKey).tokens
        const previous = summarizeDaily(daily, windows.previous.startKey, windows.previous.endKey).tokens
        return deltaPercent(current, previous)
      }, [daily, rangeWin, firstKey, todayKey])
      const lensTotals = useMemo(() => lensTotalsOf(rangeSummary), [rangeSummary])
      const todaySummary = useMemo(() => summarizeDaily(daily, todayKey, todayKey), [daily, todayKey])
      const todayHit = useMemo(() => cacheHitRate(todaySummary), [todaySummary])
      const spark = useMemo(() => {
        // 命中率小趋势画范围内的每一天；累计范围只画最近 90 天，避免几百个点挤成一团
        const end = parseDateKey(rangeWin.endKey)
        const startKey = rangeWin.startKey || (end ? localDateKey(addDays(end, -89)) : rangeWin.endKey)
        const points = dailySeries(daily, startKey, rangeWin.endKey)
        return points.map((point) => ({ ...point, today: point.key === todayKey }))
      }, [daily, rangeWin.startKey, rangeWin.endKey, todayKey])
      // 每天的缓存命中率（Token 构成卡里的小趋势）
      const hitSeries = useMemo(() => {
        const byDate = indexDaily(daily)
        return spark.map((point) => ({ key: point.key, rate: byDate.has(point.key) ? cacheHitRate(byDate.get(point.key)) : null }))
      }, [daily, spark])
      const projectPaths = (snapshot && snapshot.projects) || null
      const snapshotBilling = snapshot && snapshot.billing && snapshot.billing.providers
      const snapshotAliases = snapshot && snapshot.aliases && snapshot.aliases.providers
      const snapshotRate = snapshot && snapshot.billing && typeof snapshot.billing.usdCny === 'number' ? snapshot.billing.usdCny : null
      // 页面先显示刚改的值（保存中 / 刚存上还没拉到新快照）；快照里已经是这个值了就丢掉这条改动，之后以快照为准，
      // 否则别的窗口、手改的 billing.json 在这一页上永远看不到
      const latest = useRef({ billing: null, aliases: null })
      latest.current = { billing: snapshotBilling || {}, aliases: snapshotAliases || {} }
      useEffect(() => {
        setBillingEdits((current) => settleEdits(current, (id) => ownValue(snapshotBilling, id)))
      }, [snapshotBilling])
      useEffect(() => {
        setAliasEdits((current) => settleEdits(current, (id) => ownValue(snapshotAliases, id) || ''))
      }, [snapshotAliases])
      const billingSettings = useMemo(() => {
        const merged = { ...(snapshotBilling || {}) }
        for (const [id, entry] of Object.entries(billingEdits)) {
          if (entry) merged[id] = entry
          else delete merged[id]
        }
        return merged
      }, [snapshotBilling, billingEdits])
      // 价格表（宿主只带用到的模型，美元）与汇率：本机 billing.json 里写了 usdCny 就用它，否则用宿主给的默认值（页面上不显示、不改）
      const priceTable = (snapshot && snapshot.prices && snapshot.prices.models) || null
      const defaultRate = snapshot && snapshot.prices && typeof snapshot.prices.defaultUsdCny === 'number' ? snapshot.prices.defaultUsdCny : 7
      const usdCny = snapshotRate !== null ? snapshotRate : defaultRate
      const priceOptions = useMemo(() => ({ table: priceTable, usdCny }), [priceTable, usdCny])
      const costs = useMemo(
        () => computeCosts(daily, rangeWin.startKey, rangeWin.endKey, billingSettings, todayKey, priceOptions),
        [daily, rangeWin.startKey, rangeWin.endKey, billingSettings, todayKey, priceOptions],
      )
      const todayCosts = useMemo(() => computeCosts(daily, todayKey, todayKey, billingSettings, todayKey, priceOptions), [daily, billingSettings, todayKey, priceOptions])
      // 包月：这一个订阅月（开始日期的几号续费；没填按自然月）里用量换算成的钱，不跟顶部范围走
      const planMonths = useMemo(() => {
        const months = {}
        for (const [id, entry] of Object.entries(billingSettings)) {
          if (!entry || entry.mode !== 'plan') continue
          const startKey = planCycleStart(entry.since, todayKey)
          const cost = computeCosts(daily, startKey, todayKey, { [id]: entry }, todayKey, priceOptions).byProvider[id]
          months[id] = { startKey, used: cost && cost.spend !== null ? cost.spend : 0, monthly: toNumber(entry.monthly) }
        }
        return months
      }, [daily, billingSettings, todayKey, priceOptions])
      const saveBilling = useCallback(
        async (id, entry) => {
          setBillingEdits((current) => ({ ...current, [id]: entry }))
          setBillingErrors((current) => dropKey(current, id))
          try {
            const result = await postJson(BILLING_URL, { provider: id, billing: entry })
            // 宿主会整理写法（去掉多余字段、补上缓存写入价）：换成它存下的那份，快照跟上之后丢掉
            const saved = ownValue(result.billing && result.billing.providers, id)
            if (mounted.current) {
              setBillingEdits((current) => (sameValue(saved, ownValue(latest.current.billing, id)) ? dropKey(current, id) : { ...current, [id]: saved }))
            }
            reload()
          } catch (error) {
            console.warn('[dsh-profile-stats] 保存计费方式失败：', error && error.message ? error.message : error)
            if (mounted.current) {
              setBillingEdits((current) => dropKey(current, id))
              setBillingErrors((current) => ({ ...current, [id]: errorReason(error) }))
            }
          }
        },
        [reload, mounted],
      )
      const aliases = useMemo(() => ({ ...(snapshotAliases || {}), ...aliasEdits }), [snapshotAliases, aliasEdits])
      const saveAlias = useCallback(
        async (id, name) => {
          // 和宿主一样按字符截断，不把 emoji 切成半个
          const clean = Array.from(String(name || '').trim()).slice(0, 40).join('')
          setAliasEdits((current) => ({ ...current, [id]: clean }))
          try {
            const result = await postJson(ALIAS_URL, { provider: id, name: clean })
            const saved = ownValue(result.aliases && result.aliases.providers, id) || ''
            if (mounted.current) {
              setAliasEdits((current) => (saved === (ownValue(latest.current.aliases, id) || '') ? dropKey(current, id) : { ...current, [id]: saved }))
            }
            reload()
          } catch (error) {
            console.warn('[dsh-profile-stats] 保存供应商名称失败：', error && error.message ? error.message : error)
            if (mounted.current) setAliasEdits((current) => dropKey(current, id))
          }
        },
        [reload, mounted],
      )
      // 导出文件名带上范围：自定义写起止日期，本月写年月
      const exportName =
        range === 'custom'
          ? `dsh-profile-stats-${rangeWin.startKey}_${rangeWin.endKey}`
          : range === 'month'
            ? `dsh-profile-stats-month-${rangeWin.startKey.slice(0, 7)}-${todayKey}`
            : `dsh-profile-stats-${range}-${todayKey}`
      const handleExport = (format) => {
        if (format === 'csv') {
          downloadFile(`${exportName}.csv`, 'text/csv;charset=utf-8', buildCsv(daily, rangeSummary, rangeWin.startKey, rangeWin.endKey))
          return
        }
        const rows = indexDaily(daily)
        const entries = []
        for (const [date, entry] of rows) {
          if (rangeWin.startKey && date < rangeWin.startKey) continue
          if (date > rangeWin.endKey) continue
          entries.push(entry)
        }
        entries.sort((left, right) => (left.date < right.date ? -1 : 1))
        const payload = {
          exportedAt: new Date().toISOString(),
          range,
          window: { start: rangeWin.startKey || null, end: rangeWin.endKey },
          totals: {
            tokens: rangeSummary.tokens,
            calls: rangeSummary.calls,
            inputTokens: rangeSummary.inputTokens,
            outputTokens: rangeSummary.outputTokens,
            cacheReadTokens: rangeSummary.cacheReadTokens,
            cacheWriteTokens: rangeSummary.cacheWriteTokens,
            cacheHitRate: cacheHitRate(rangeSummary),
          },
          byProvider: rangeSummary.byProvider,
          providerUsage: rangeSummary.providerUsage,
          byModel: rangeSummary.byModel,
          // 上游 totalTokens 和四项之和对不上的步数（全部时间，正常应为 0）
          diagnostics: { usageMismatchCalls: toNumber(totals.usageMismatchCalls) },
          // 费用（人民币）：spend 按各家计费方式，officialValue 按官方价折算；未设置计费方式的供应商不计入 spend
          cost: {
            currency: 'CNY',
            spend: costs.spend,
            officialValue: costs.value,
            peakShare: costs.peakBase > 0 ? costs.peakValue / costs.peakBase : null,
            usdCny,
            priceTableDate: (snapshot && snapshot.prices && snapshot.prices.fetchedAt) || null,
            unpricedTokens: costs.unpricedTokens,
            unsetProviders: costs.unset,
            byProvider: Object.fromEntries(Object.entries(costs.byProvider).map(([id, row]) => [id, { mode: row.mode, spend: row.spend, officialValue: row.value }])),
            byProject: costs.byProject,
          },
          daily: entries,
        }
        downloadFile(`${exportName}.json`, 'application/json', JSON.stringify(payload, null, 2))
      }

      useEffect(() => {
        if (manualScan && !refreshing && snapshot && !snapshot.scanning) setManualScan(false)
      }, [manualScan, refreshing, snapshot])

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
            busy: refreshing || (manualScan && scanning),
            onRefresh: runRefresh,
            range,
            rangeWin,
            firstKey,
            todayKey,
            onRange: changeRange,
            onCustom: applyCustom,
            onExport: handleExport,
          }),
          h(StatusBar, { snapshot, error, hasData, onRetry: reload }),
          h(KpiStrip, { kpis, ready, range, rangeWin, todayKey, summary: rangeSummary, delta, todayHit, costs }),
          h(ActivityCard, { daily, today, rangeStartKey: rangeWin.startKey, rangeEndKey: rangeWin.endKey }),
          h(
            'div',
            { className: 'dps-grid', 'data-row': 'charts' },
            // 模型分布不跟顶部范围走
            h(ModelCard, { daily, today }),
            h(LensCard, { totals: lensTotals, hitSeries }),
          ),
          h(
            'div',
            { className: 'dps-grid', 'data-row': 'lists' },
            h(ProjectCard, { summary: rangeSummary, paths: projectPaths, costs }),
            h(ProviderCard, {
              summary: rangeSummary,
              today: todaySummary,
              scope: range,
              todayOnly: providerToday,
              onTodayOnly: setProviderToday,
              aliases,
              onRename: saveAlias,
              costs,
              todayCosts,
              billingSettings,
              billingErrors,
              planMonths,
              onBilling: saveBilling,
            }),
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
