/**
 * dsh-profile-stats — 浏览器半区。
 *
 * 在左侧图标栏加一个「个人主页」入口，主区渲染个人用量页：
 * 头像 + 账号 + 五张指标卡（累计 Token / 单日峰值 / 最长任务用时 / 最长连续天数
 * / 当前连续天数）+ Token 构成条 + GitHub 贡献图口径的 Token 活动热力图。
 *
 * 所有数字都来自宿主侧 `/api/dsh-profile-stats/snapshot`（那边从会话日志折叠），
 * 浏览器半区只负责画，不重算任何统计。
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

    const NS = 'dsh-profile-stats'
    const SNAPSHOT_URL = '/api/dsh-profile-stats/snapshot'
    const REFRESH_URL = '/api/dsh-profile-stats/refresh'
    const UPDATE_URL = '/api/dsh-profile-stats/update'
    const PANEL_ID = 'profile'
    const DAY_MS = 86400000
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
      'section.breakdown': 'Token mix',
      'note.range': 'last 12 months',
      'note.total': '{value} in total',
      'breakdown.input': 'Input',
      'breakdown.output': 'Output',
      'breakdown.cache': 'Cache hit',
      'tip.none': 'No activity',
      'tip.tokens': '{value} tokens',
      'tip.week': 'Week of {date}',
      'tip.cumulative': 'Cumulative through the week of {date}',
      'mode.day': 'Daily',
      'mode.week': 'Weekly',
      'mode.total': 'Cumulative',
      'status.loading': 'Scanning local session logs…',
      'status.updated': 'Updated {time}',
      'action.refresh': 'Refresh',
      'action.retry': 'Retry',
      'action.update': 'Update to {version}',
      'action.updating': 'Updating…',
      'error.title': 'Failed to load usage stats',
      'error.hint': 'The host route /api/dsh-profile-stats/snapshot did not answer.',
      'empty.title': 'No sessions yet',
      'empty.hint': 'Start a conversation, then come back.',
      'unit.days': '{count} d',
      'unit.hour': '{count} h',
      'unit.minute': '{count} m',
      'unit.none': '—',
      'value.tokensTooltip': '{date} · {value} tokens',
      'section.provider': 'Provider breakdown',
      'section.model': 'Token by model',
      'range.recent': 'Last 14 days',
      'range.all': 'All time',
      'toggle.today': 'Today',
      'toggle.all': 'All time',
      'provider.wincode': 'WinCode relay',
      'provider.arkcli-coding-plan': 'Ark Coding Plan',
      'provider.myapi': 'MyAPI',
      'provider.deepseek-account': 'DeepSeek account',
      'provider.deepseek-official': 'DeepSeek official',
      'provider.deepseek-modlens': 'DeepSeek ModLens',
      'provider.unknown': 'Unknown',
      'provider.other': 'Other',
    }

    const ZH = {
      'panel.title': '个人主页',
      'stat.tokens': '累计 Token 数',
      'stat.today': '今日 Token 用量',
      'stat.longestTurn': '最长任务用时',
      'stat.longestStreak': '最长连续天数',
      'stat.currentStreak': '当前连续天数',
      'section.activity': 'Token 活动',
      'section.breakdown': 'Token 构成',
      'note.range': '近 12 个月',
      'note.total': '共 {value}',
      'breakdown.input': '输入',
      'breakdown.output': '输出',
      'breakdown.cache': '缓存命中',
      'tip.none': '无活动',
      'tip.tokens': '{value} tokens',
      'tip.week': '{date} 起的一周',
      'tip.cumulative': '累计至 {date} 起的一周',
      'mode.day': '每天',
      'mode.week': '每周',
      'mode.total': '累计总量',
      'status.loading': '正在统计本地会话日志…',
      'status.updated': '更新于 {time}',
      'action.refresh': '刷新',
      'action.retry': '重试',
      'action.update': '更新到 {version}',
      'action.updating': '更新中…',
      'error.title': '读取用量统计失败',
      'error.hint': '宿主路由 /api/dsh-profile-stats/snapshot 没有响应。',
      'empty.title': '还没有可统计的会话',
      'empty.hint': '跑一次对话后再回来看看。',
      'unit.days': '{count} 天',
      'unit.hour': '{count} 小时',
      'unit.minute': '{count} 分',
      'unit.none': '—',
      'value.tokensTooltip': '{date} · {value} tokens',
      'section.provider': '供应商拆分',
      'section.model': '模型分布',
      'range.recent': '近 14 天',
      'range.all': '全部',
      'toggle.today': '今日',
      'toggle.all': '累计',
      'provider.wincode': '卫宁中转 WinCode',
      'provider.arkcli-coding-plan': '火山 Coding Plan',
      'provider.myapi': 'MyAPI',
      'provider.deepseek-account': 'DeepSeek 账号',
      'provider.deepseek-official': 'DeepSeek 官方',
      'provider.deepseek-modlens': 'DeepSeek ModLens',
      'provider.unknown': '未知来源',
      'provider.other': '其他',
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
      return ZH[key] || EN[key] || key
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

    function formatTokens(value) {
      const number = toNumber(value)
      if (number <= 0) return '0'
      if (number >= 1e8) return `${(number / 1e8).toFixed(1)} 亿`
      if (number >= 1e4) return `${(number / 1e4).toFixed(1)} 万`
      return number.toLocaleString(currentLocaleId())
    }

    function formatDuration(ms) {
      const value = toNumber(ms)
      if (value <= 0) return t('unit.none')
      const totalMinutes = Math.round(value / 60000)
      const hours = Math.floor(totalMinutes / 60)
      const minutes = totalMinutes % 60
      if (hours <= 0) return t('unit.minute', { count: Math.max(minutes, 1) })
      if (minutes === 0) return t('unit.hour', { count: hours })
      return `${t('unit.hour', { count: hours })} ${t('unit.minute', { count: minutes })}`
    }

    function formatDays(value) {
      const count = toNumber(value)
      if (count <= 0) return t('unit.none')
      return t('unit.days', { count })
    }

    function formatClock(date) {
      try {
        return new Intl.DateTimeFormat(currentLocaleId(), {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }).format(date)
      } catch {
        return date.toLocaleTimeString()
      }
    }

    function startOfDay(date) {
      const copy = new Date(date.getTime())
      copy.setHours(0, 0, 0, 0)
      return copy
    }

    /** 'YYYY-MM-DD' → 本地化的完整日期（总是带年份），周/累计档的悬浮提示用。 */
    function formatCellDateFull(key) {
      const parts = String(key || '').split('-')
      if (parts.length !== 3) return String(key || '')
      const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
      if (Number.isNaN(date.getTime())) return String(key)
      try {
        return new Intl.DateTimeFormat(currentLocaleId(), { year: 'numeric', month: 'long', day: 'numeric' }).format(date)
      } catch {
        return String(key)
      }
    }

    /** 'YYYY-MM-DD' → 本地化的「月日」（跨年时带年份），热力图悬浮提示用。 */
    function formatCellDate(key) {
      const parts = String(key || '').split('-')
      if (parts.length !== 3) return String(key || '')
      const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
      if (Number.isNaN(date.getTime())) return String(key)
      const sameYear = date.getFullYear() === new Date().getFullYear()
      try {
        return new Intl.DateTimeFormat(
          currentLocaleId(),
          sameYear ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' },
        ).format(date)
      } catch {
        return String(key)
      }
    }

    /** 周一为一周起点的当地日期。 */
    function startOfWeek(date) {
      const copy = startOfDay(date)
      const weekday = (copy.getDay() + 6) % 7
      copy.setDate(copy.getDate() - weekday)
      return copy
    }

    function localDateKey(date) {
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      return `${year}-${month}-${day}`
    }

    function monthLabel(date) {
      try {
        return new Intl.DateTimeFormat(currentLocaleId(), { month: 'short' }).format(date)
      } catch {
        return `${date.getMonth() + 1}`
      }
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
      const start = startOfDay(new Date(today.getTime() - (HEAT_WEEKS * 7 - 1) * DAY_MS))
      start.setDate(start.getDate() - start.getDay())

      const cells = []
      const weeks = []
      const months = []
      const cursor = new Date(start.getTime())
      let column = 0
      let previousMonth = -1
      let cumulative = 0

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

    /* -------------------------------------------------------------- 数据拉取 */

    function useSnapshot(intervalMs = 45000) {
      const [snapshot, setSnapshot] = useState(null)
      const [error, setError] = useState(null)

      useEffect(() => {
        let alive = true
        let timer = null

        const load = async () => {
          try {
            const response = await fetch(SNAPSHOT_URL, {
              headers: { accept: 'application/json' },
              cache: 'no-store',
            })
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            const payload = await response.json()
            if (!alive) return
            setSnapshot(payload)
            setError(null)
            timer = setTimeout(load, payload && payload.scanning ? 900 : intervalMs)
          } catch (failure) {
            if (!alive) return
            setError(failure)
            timer = setTimeout(load, 4000)
          }
        }

        load()
        return () => {
          alive = false
          if (timer) clearTimeout(timer)
        }
      }, [intervalMs])

      const refresh = useCallback(() => {
        fetch(REFRESH_URL, { method: 'POST' }).catch(() => {})
      }, [])

      return { snapshot, error, refresh }
    }

    /* ------------------------------------------------------------------- 样式 */

    const STYLE_ID = 'dsh-profile-stats-style'
    const CSS = `
.dps-root{height:100%;min-height:0;overflow-y:auto;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);box-sizing:border-box}
.dps-page{max-width:880px;margin:0 auto;padding:56px 28px 80px;display:flex;flex-direction:column;gap:30px;box-sizing:border-box}
.dps-identity{display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center}
.dps-avatar{width:84px;height:84px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:34px;font-weight:600;color:#fff;background:linear-gradient(140deg,var(--dsw-alias-brand-primary),color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,#101418));box-shadow:0 8px 24px color-mix(in srgb,var(--dsw-alias-brand-primary) 24%,transparent)}
.dps-name{font-size:24px;font-weight:600;line-height:1.2}
.dps-handle{font-size:13px;color:var(--dsw-alias-label-secondary)}
.dps-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));border:1px solid var(--dsw-alias-border-l1);border-radius:14px;overflow:hidden;background:var(--dsw-alias-bg-layer-1)}
.dps-stat{padding:16px 10px;display:flex;flex-direction:column;gap:6px;align-items:center;justify-content:center;border-right:1px solid var(--dsw-alias-border-l1);min-height:72px}
.dps-stat:last-child{border-right:none}
.dps-stat-value{font-size:20px;font-weight:600;white-space:nowrap;font-variant-numeric:tabular-nums}
.dps-stat-label{font-size:12px;color:var(--dsw-alias-label-secondary)}
.dps-stat-sub{font-size:11px;color:var(--dsw-alias-label-secondary);opacity:.85}
.dps-section{display:flex;flex-direction:column;gap:14px}
.dps-section-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap}
.dps-section-title{font-size:14px;font-weight:600}
.dps-section-note{font-size:12px;color:var(--dsw-alias-label-secondary)}
.dps-card{padding:18px 16px;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1)}
.dps-heat{display:flex;flex-direction:column;gap:12px;overflow-x:auto}
.dps-heat-grid{display:grid;grid-auto-flow:column;grid-template-rows:repeat(7,11px);grid-auto-columns:11px;gap:3px}
.dps-cell{width:11px;height:11px;border-radius:2.5px;background:var(--dsw-alias-bg-layer-2);box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l1)}
.dps-cell[data-future="true"]{opacity:.35}
.dps-months{position:relative;height:14px;font-size:10px;color:var(--dsw-alias-label-secondary)}
.dps-tip{position:fixed;z-index:9999;pointer-events:none;transform:translate(-50%,-100%);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 10px;box-shadow:0 10px 28px rgba(0,0,0,.28);white-space:nowrap;text-align:left}
.dps-tip-date{font-size:10px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.dps-tip-value{font-size:12px;line-height:1.5;font-weight:600;font-variant-numeric:tabular-nums}
.dps-prov-card{display:flex;flex-direction:column;gap:12px}
.dps-prov-head{display:flex;align-items:center;justify-content:flex-end;gap:12px;flex-wrap:wrap}
.dps-prov{display:flex;flex-direction:column;gap:9px}
.dps-prov-row{display:grid;grid-template-columns:132px minmax(60px,1fr) auto 48px;gap:10px;align-items:center;font-size:12px}
.dps-prov-name{color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dps-prov-bar{height:6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;display:block}
.dps-prov-bar > span{display:block;height:100%;border-radius:999px}
.dps-prov-value{font-variant-numeric:tabular-nums;font-weight:600;white-space:nowrap}
.dps-prov-share{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary);text-align:right}
.dps-chart{display:flex;flex-direction:column;gap:18px}
.dps-chart-head{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
.dps-chart-legend{display:flex;align-items:center;gap:18px;flex-wrap:wrap;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dps-chart-legend-item{display:inline-flex;align-items:center;gap:6px}
.dps-chart-legend-total{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}
.dps-chart-plot{position:relative;height:220px;min-width:0;padding-bottom:18px}
.dps-chart-ticks{position:absolute;left:64px;right:0;top:0;bottom:16px;pointer-events:none}
.dps-chart-tick{position:absolute;left:0;right:0;border-top:1px dashed var(--dsw-alias-border-l2)}
.dps-chart-tick > span{position:absolute;left:-64px;top:-7px;width:60px;text-align:right;font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;padding-right:6px;background:var(--dsw-alias-bg-layer-1)}
.dps-chart-scroll{position:absolute;left:64px;right:0;top:0;bottom:0;overflow-x:auto;overflow-y:hidden}
.dps-chart-bars{position:relative;height:100%;display:flex;align-items:flex-end;gap:2px}
.dps-chart-bucket{flex:1 1 0;min-width:0;height:100%;display:flex;flex-direction:column}
.dps-chart-pair{display:flex;align-items:flex-end;justify-content:center;gap:2px;width:100%;flex:1 1 auto;min-height:0}
.dps-chart-bar{width:45%;max-width:10px;min-width:2px;border-radius:2px 2px 0 0;transition:opacity .12s ease-out}
.dps-chart-bucket:hover .dps-chart-bar{opacity:.8}
.dps-chart-label{height:16px;line-height:16px;text-align:center;font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden}
.dps-tip-row{display:flex;align-items:center;gap:6px;font-size:12px;white-space:nowrap}
.dps-tip-row .dps-dot{width:8px;height:8px;border-radius:2px;flex:0 0 auto}
.dps-tip-row .dps-tip-value{margin-left:auto;padding-left:12px}
.dps-switch{display:inline-flex;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;overflow:hidden}
.dps-switch button{appearance:none;border:none;background:transparent;color:var(--dsw-alias-label-secondary);font-size:11px;padding:4px 10px;cursor:pointer;font-family:inherit}
.dps-switch button[data-active="true"]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dps-month{position:absolute;top:0;white-space:nowrap}
.dps-mix{display:flex;align-items:center;justify-content:center;gap:36px;flex-wrap:wrap}
.dps-mix-chart{flex:0 0 auto;line-height:0}
.dps-mix-legend{flex:0 0 auto;display:flex;flex-direction:column;gap:10px;font-size:13px}
.dps-mix-row{display:grid;grid-template-columns:8px 72px 88px 44px;gap:10px;align-items:baseline;justify-content:start}
.dps-mix-label{color:var(--dsw-alias-label-secondary)}
.dps-mix-value{font-weight:600;font-variant-numeric:tabular-nums;text-align:right}
.dps-mix-share{color:var(--dsw-alias-label-secondary);text-align:right;font-variant-numeric:tabular-nums}
.dps-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:7px;vertical-align:1px}
.dps-value{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}
.dps-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dps-button{appearance:none;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;padding:6px 14px;border-radius:8px;cursor:pointer;font-family:inherit}
.dps-button:hover{border-color:var(--dsw-alias-border-l2)}
.dps-button:active{transform:translateY(1px)}
.dps-placeholder{font-size:13px;color:var(--dsw-alias-label-secondary);line-height:1.7}
.dps-error{border:1px solid var(--dsw-alias-state-error-primary);border-radius:12px;padding:14px 16px;font-size:13px;display:flex;flex-direction:column;gap:6px}
.dps-error-title{color:var(--dsw-alias-state-error-primary);font-weight:600}
.dps-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
`

    /* ------------------------------------------------------------------ 组件 */

    function StyleTag() {
      useEffect(() => {
        if (document.getElementById(STYLE_ID)) return undefined
        const element = document.createElement('style')
        element.id = STYLE_ID
        element.textContent = CSS
        document.head.appendChild(element)
        return () => {
          const current = document.getElementById(STYLE_ID)
          if (current && current.parentNode) current.parentNode.removeChild(current)
        }
      }, [])
      return null
    }

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

    function StatCard(props) {
      return h(
        'div',
        { className: 'dps-stat' },
        h('div', { className: 'dps-stat-value', title: props.title || undefined }, props.value),
        h('div', { className: 'dps-stat-label' }, props.label),
        props.sub ? h('div', { className: 'dps-stat-sub' }, props.sub) : null,
      )
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
        const level = cell.future
          ? 0
          : mode === 'week'
            ? heat.levels.week(weekOf(cell).weekTokens)
            : mode === 'total'
              ? heat.levels.total(weekOf(cell).cumulativeTokens)
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
          { key: `${month.column}-${month.label}`, className: 'dps-month', style: { left: `${month.column * CELL_PITCH}px` } },
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

    /** 环形图：用 stroke-dasharray 画弧，三段（输入/输出/缓存）各自成扇形。 */
    function DonutChart(props) {
      const segments = props.segments || []
      const size = props.size || 120
      const thickness = props.thickness || 16
      const total = segments.reduce((sum, segment) => sum + toNumber(segment.value), 0)
      const radius = (size - thickness) / 2
      const circumference = 2 * Math.PI * radius
      const center = size / 2
      let offset = 0
      const arcs = []
      for (const segment of segments) {
        const value = toNumber(segment.value)
        if (!(value > 0) || total <= 0) continue
        const length = (value / total) * circumference
        arcs.push(
          h('circle', {
            key: segment.key,
            cx: center,
            cy: center,
            r: radius,
            fill: 'none',
            stroke: segment.color,
            strokeWidth: thickness,
            strokeLinecap: 'butt',
            strokeDasharray: `${Math.max(length - 1, 0.5)} ${circumference}`,
            strokeDashoffset: -offset,
            transform: `rotate(-90 ${center} ${center})`,
          }),
        )
        offset += length
      }
      return h(
        'svg',
        { width: size, height: size, viewBox: `0 0 ${size} ${size}`, role: 'img', 'aria-label': props.label || '' },
        h('circle', {
          cx: center,
          cy: center,
          r: radius,
          fill: 'none',
          stroke: 'var(--dsw-alias-bg-layer-2)',
          strokeWidth: thickness,
        }),
        arcs,
      )
    }

    function Breakdown(props) {
      const totals = props.totals
      const segments = [
        { key: 'input', label: t('breakdown.input'), value: toNumber(totals.inputTokens), color: 'var(--dsw-alias-brand-primary)' },
        { key: 'output', label: t('breakdown.output'), value: toNumber(totals.outputTokens), color: 'var(--dsw-alias-state-success-primary)' },
        {
          key: 'cache',
          label: t('breakdown.cache'),
          value: toNumber(totals.cacheReadTokens) + toNumber(totals.cacheWriteTokens),
          color: 'var(--dsw-alias-state-warn-primary)',
        },
      ]
      const sum = segments.reduce((total, segment) => total + segment.value, 0)

      const rows = segments.map((segment) =>
        h(
          'div',
          { className: 'dps-mix-row', key: segment.key },
          h('span', { className: 'dps-dot', style: { background: segment.color } }),
          h('span', { className: 'dps-mix-label' }, segment.label),
          h('span', { className: 'dps-mix-value' }, formatTokens(segment.value)),
          h('span', { className: 'dps-mix-share' }, `${sum > 0 ? ((segment.value / sum) * 100).toFixed(1) : '0.0'}%`),
        ),
      )

      return h(
        'div',
        { className: 'dps-card dps-mix' },
        h('div', { className: 'dps-mix-chart' }, h(DonutChart, { segments, size: 148, thickness: 20, label: t('section.breakdown') })),
        h(
          'div',
          { className: 'dps-mix-legend' },
          rows,
        ),
      )
    }

    const PROVIDER_COLORS = [
      'var(--dsw-alias-brand-primary)',
      'var(--dsw-alias-state-success-primary)',
      'var(--dsw-alias-state-warn-primary)',
      'var(--dsw-alias-state-error-primary)',
      'var(--dsw-alias-state-idle-primary)',
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
      if (rows.length === 0) return null

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
            { className: 'dps-prov-row', key: row.id },
            h('span', { className: 'dps-prov-name', title: providerLabel(row.id) }, providerLabel(row.id)),
            h(
              'span',
              { className: 'dps-prov-bar' },
              h('span', {
                style: {
                  width: `${sum > 0 ? Math.max((row.tokens / sum) * 100, 1.5) : 0}%`,
                  background: PROVIDER_COLORS[index % PROVIDER_COLORS.length],
                },
              }),
            ),
            h('span', { className: 'dps-prov-value' }, formatTokens(row.tokens)),
            h('span', { className: 'dps-prov-share' }, `${sum > 0 ? ((row.tokens / sum) * 100).toFixed(1) : '0.0'}%`),
          ),
        ),
      )

      return h(
        'div',
        { className: 'dps-card dps-prov-card' },
        h('div', { className: 'dps-prov-head' }, toggle),
        list,
      )
    }

    /** 模型名（用户指定的具体名称）+ 分类键。 */
    const MODEL_SERIES = [
      { key: 'flash', name: 'Deepseek-V4.1-Flash-1017', color: 'var(--dsw-alias-brand-primary)' },
      { key: 'pro', name: 'Deepseek-V4-Pro', color: 'var(--dsw-alias-state-success-primary)' },
    ]

    /**
     * 按时间的竖向柱状图：时间轴连续（没有数据的日期也占位），
     * 近 14 天按天分桶、全部按周汇总，避免柱子互相挤压。
     * 图例合计只统计当前范围内可见的桶；范围内为 0 的模型不出现。
     */
    function ModelChart(props) {
      const [range, setRange] = useState('recent')
      const [tip, setTip] = useState(null)
      const daily = props.daily || []

      const byDate = new Map()
      for (const entry of daily) {
        if (entry && typeof entry.date === 'string') byDate.set(entry.date, entry)
      }

      const today = startOfDay(new Date())
      const todayKey = localDateKey(today)
      const dayMs = DAY_MS
      const dateFromKey = (key) =>
        new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)))

      // 起点：近 14 天固定回溯 13 天；全部则回到最早有数据的那天。
      const keys = [...byDate.keys()].sort()
      const firstDataKey = keys.length > 0 ? keys[0] : todayKey
      const startKey =
        range === 'recent' ? localDateKey(new Date(today.getTime() - 13 * dayMs)) : firstDataKey
      if (dateFromKey(startKey).getTime() > today.getTime()) return null

      // 先铺满连续的「天」，再按范围决定是否折叠成「周」。
      const days = []
      const cursor = dateFromKey(startKey)
      for (let guard = 0; guard < 800; guard += 1) {
        const key = localDateKey(cursor)
        const entry = byDate.get(key)
        days.push({ key, entry })
        if (cursor.getTime() >= today.getTime()) break
        cursor.setDate(cursor.getDate() + 1)
      }

      const bucketsMap = new Map()
      for (const day of days) {
        const bucketKey =
          range === 'recent'
            ? day.key
            : localDateKey(startOfWeek(dateFromKey(day.key)))
        const bucket = bucketsMap.get(bucketKey) || { key: bucketKey, values: MODEL_SERIES.map(() => 0) }
        MODEL_SERIES.forEach((series, index) => {
          const value = toNumber(day.entry && day.entry.byModel && day.entry.byModel[series.key])
          if (value > 0) bucket.values[index] += value
        })
        bucketsMap.set(bucketKey, bucket)
      }
      const buckets = [...bucketsMap.values()].sort((left, right) => (left.key < right.key ? -1 : 1))

      // 图例合计只算当前范围，且只保留有量的模型。
      const totalsInRange = MODEL_SERIES.map((_, index) =>
        buckets.reduce((sum, bucket) => sum + bucket.values[index], 0),
      )
      const series = MODEL_SERIES.filter((_, index) => totalsInRange[index] > 0)
      if (series.length === 0) return null

      let max = 0
      for (const bucket of buckets) {
        for (const value of bucket.values) if (value > max) max = value
      }
      if (max <= 0) return null

      const stride = Math.max(1, Math.ceil(buckets.length / 8))
      const labelOf = (key) => key.slice(5).replace('-', '/')

      const showTip = (bucket) => (event) => {
        const target = event && event.currentTarget
        if (!target || typeof target.getBoundingClientRect !== 'function') return
        const rect = target.getBoundingClientRect()
        const halfWidth = 120
        const centerX = rect.left + rect.width / 2
        const viewportWidth = typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : 1200
        setTip({
          bucket,
          x: Math.min(Math.max(centerX, halfWidth), Math.max(halfWidth, viewportWidth - halfWidth)),
          y: rect.top - 8,
        })
      }

      const toggle = h(
        'div',
        { className: 'dps-switch' },
        [
          { id: 'recent', label: t('range.recent') },
          { id: 'all', label: t('range.all') },
        ].map((option) =>
          h(
            'button',
            {
              key: option.id,
              type: 'button',
              'data-active': range === option.id ? 'true' : 'false',
              onClick: () => setRange(option.id),
            },
            option.label,
          ),
        ),
      )

      const legend = h(
        'div',
        { className: 'dps-chart-legend' },
        series.map((item, index) =>
          h(
            'span',
            { className: 'dps-chart-legend-item', key: item.key },
            h('span', { className: 'dps-dot', style: { background: item.color } }),
            item.name,
            h('span', { className: 'dps-chart-legend-total' }, formatTokens(totalsInRange[MODEL_SERIES.indexOf(item)])),
          ),
        ),
      )

      const ticks = [1, 0.75, 0.5, 0.25]
      const plot = h(
        'div',
        { className: 'dps-chart-plot' },
        h(
          'div',
          { className: 'dps-chart-ticks' },
          ticks.map((ratio) =>
            h(
              'div',
              { className: 'dps-chart-tick', key: ratio, style: { bottom: `${ratio * 100}%` } },
              h('span', null, formatTokens(max * ratio)),
            ),
          ),
        ),
        h(
          'div',
          { className: 'dps-chart-scroll' },
          h(
            'div',
            { className: 'dps-chart-bars', style: { minWidth: `${buckets.length * 14}px` } },
            buckets.map((bucket, index) =>
              h(
                'div',
                {
                  className: 'dps-chart-bucket',
                  key: bucket.key,
                  onMouseEnter: showTip(bucket),
                  onMouseLeave: () => setTip(null),
                },
                h(
                  'div',
                  { className: 'dps-chart-pair' },
                  series.map((item) =>
                    h('div', {
                      key: item.key,
                      className: 'dps-chart-bar',
                      style: {
                        height: `${max > 0 ? (bucket.values[MODEL_SERIES.indexOf(item)] / max) * 100 : 0}%`,
                        background: item.color,
                      },
                    }),
                  ),
                ),
                index % stride === 0 ? h('div', { className: 'dps-chart-label' }, labelOf(bucket.key)) : null,
              ),
            ),
          ),
        ),
      )

      const tooltip = tip
        ? h(
            'div',
            { className: 'dps-tip', style: { left: `${tip.x}px`, top: `${tip.y}px`, transform: 'translate(-50%, -100%)' } },
            h('div', { className: 'dps-tip-date' }, range === 'recent' ? tip.bucket.key : `${tip.bucket.key} 起的一周`),
            series.map((item) => {
              const value = tip.bucket.values[MODEL_SERIES.indexOf(item)]
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

      return h('div', { className: 'dps-card dps-chart' }, h('div', { className: 'dps-chart-head' }, legend, toggle), plot, tooltip)
    }
    function ProfilePage() {
      useLocaleRevision()
      const { snapshot, error, refresh } = useSnapshot()
      const [updating, setUpdating] = useState(false)

      useEffect(() => {
        // 打开页面就请求一次后台补扫：页面先画旧快照，数字随后自动刷新。
        refresh()
      }, [refresh])

      const [activityMode, setActivityMode] = useState('day')

      const totals = snapshot && snapshot.totals ? snapshot.totals : null
      const heat = useMemo(() => buildHeatmap(snapshot && snapshot.daily ? snapshot.daily : []), [snapshot && snapshot.daily])
      const identity = snapshot && snapshot.identity ? snapshot.identity : { name: 'DSH', handle: '@local' }
      const scanning = Boolean(snapshot && snapshot.scanning)
      const progress = snapshot && snapshot.progress ? snapshot.progress : { done: 0, total: 0 }
      const generatedAt = snapshot && snapshot.generatedAt ? new Date(snapshot.generatedAt) : null

      const initial = String(identity.avatar || identity.name || 'D').trim().charAt(0).toUpperCase() || 'D'

      const updateInfo = snapshot && snapshot.update ? snapshot.update : null
      const updateReady = Boolean(
        updateInfo && updateInfo.available && updateInfo.latest && updateInfo.latest !== updateInfo.installed,
      )

      const hasAnySession = Boolean(totals && totals.calls > 0)
      const daily = snapshot && Array.isArray(snapshot.daily) ? snapshot.daily : []
      const todayKey = localDateKey(startOfDay(new Date()))
      const todayEntry = daily.find((entry) => entry && entry.date === todayKey) || null
      const providerHasRows = Boolean(
        (todayEntry && todayEntry.byProvider && Object.keys(todayEntry.byProvider).length > 0) ||
          (totals && totals.byProvider && Object.keys(totals.byProvider).length > 0),
      )

      const stats = h(
        'div',
        { className: 'dps-stats' },
        h(StatCard, { label: t('stat.tokens'), value: hasAnySession ? formatTokens(totals.tokens) : '—' }),
        h(StatCard, {
          label: t('stat.today'),
          value: hasAnySession ? formatTokens(todayEntry ? todayEntry.tokens : 0) : '—',
        }),
        h(StatCard, {
          label: t('stat.longestTurn'),
          value: hasAnySession ? formatDuration(totals.longestTurnMs) : '—',
        }),
        h(StatCard, { label: t('stat.longestStreak'), value: hasAnySession ? formatDays(totals.longestStreak) : '—' }),
        h(StatCard, { label: t('stat.currentStreak'), value: hasAnySession ? formatDays(totals.currentStreak) : '—' }),
      )

      useEffect(() => {
        if (!updating || !updateInfo) return
        if (updateInfo.installed && updateInfo.installed === updateInfo.latest) setUpdating(false)
      }, [updating, updateInfo && updateInfo.installed, updateInfo && updateInfo.latest])

      // 首次统计期间卡片显示「—」而不是一堆 0，并在下方给出进度，避免看起来像没数据。
      const scanningHint =
        scanning && !hasAnySession
          ? h(
              'div',
              { className: 'dps-section-note', style: { marginTop: '-16px', textAlign: 'center' } },
              progress.total > 0 ? `${t('status.loading')} ${progress.done}/${progress.total}` : t('status.loading'),
            )
          : null

      let statusLine
      if (scanning) {
        statusLine = progress.total > 0 ? `${t('status.loading')} ${progress.done}/${progress.total}` : t('status.loading')
      } else if (generatedAt) {
        statusLine = t('status.updated', { time: formatClock(generatedAt) })
      } else {
        statusLine = t('status.loading')
      }

      const errorBlock = error
        ? h(
            'div',
            { className: 'dps-error' },
            h('div', { className: 'dps-error-title' }, t('error.title')),
            h('div', null, t('error.hint')),
            h(
              'div',
              null,
              h(
                'button',
                {
                  type: 'button',
                  className: 'dps-button',
                  onClick: () => {
                    refresh()
                    window.location.reload()
                  },
                },
                t('action.retry'),
              ),
            ),
          )
        : null

      const emptyBlock =
        !error && snapshot && !hasAnySession && !scanning
          ? h(
              'div',
              { className: 'dps-card dps-placeholder' },
              h('div', { style: { fontWeight: 600, color: 'var(--dsw-alias-label-primary)', marginBottom: '4px' } }, t('empty.title')),
              h('div', null, t('empty.hint')),
            )
          : null

      return h(
        'div',
        { className: 'dps-root' },
        h(StyleTag, null),
        h(
          'div',
          { className: 'dps-page' },
          h(
            'div',
            { className: 'dps-identity' },
            h('div', { className: 'dps-avatar', 'aria-hidden': true }, initial),
            h('div', { className: 'dps-name' }, identity.name || 'DSH'),
            h('div', { className: 'dps-handle' }, identity.handle || '@local'),
          ),
          stats,
          scanningHint,
          errorBlock,
          emptyBlock,
          h(
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
            // key 绑定模式：切换时重挂载 Heatmap，顺带清掉上一次的悬浮浮层。
            h(Heatmap, { heat, mode: activityMode, key: `heat-${activityMode}` }),
          ),
          totals && hasAnySession
            ? h(
                'div',
                { className: 'dps-section' },
                h('div', { className: 'dps-section-head' }, h('span', { className: 'dps-section-title' }, t('section.breakdown'))),
                h(Breakdown, { totals }),
              )
            : null,
          totals && hasAnySession && providerHasRows
            ? h(
                'div',
                { className: 'dps-section' },
                h('div', { className: 'dps-section-head' }, h('span', { className: 'dps-section-title' }, t('section.model'))),
                h(ModelChart, { daily, totals }),
                h('div', { className: 'dps-section-head' }, h('span', { className: 'dps-section-title' }, t('section.provider'))),
                h(ProviderBreakdown, { today: todayEntry, totals }),
              )
            : null,
          h(
            'div',
            { className: 'dps-footer' },
            h('span', null, statusLine),
            h(
              'span',
              { style: { display: 'inline-flex', alignItems: 'center', gap: '8px' } },
              updateReady
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: 'dps-button',
                      onClick: async () => {
                        const target = updateInfo.latest
                        setUpdating(true)
                        await fetch(UPDATE_URL, { method: 'POST' }).catch(() => {})
                        for (let attempt = 0; attempt < 40; attempt += 1) {
                          await new Promise((resolve) => setTimeout(resolve, 1500))
                          try {
                            const response = await fetch(SNAPSHOT_URL, { cache: 'no-store' })
                            const payload = await response.json()
                            if (payload && payload.update && payload.update.installed === target) {
                              window.location.reload()
                              return
                            }
                          } catch {
                            /* 重装期间路由会短暂消失，继续等 */
                          }
                        }
                        setUpdating(false)
                      },
                    },
                    t('action.update', { version: updateInfo.latest }),
                  )
                : updating
                  ? h('span', { className: 'dps-section-note' }, t('action.updating'))
                  : null,
              h(
                'button',
                {
                  type: 'button',
                  className: 'dps-button',
                  onClick: () => {
                    refresh()
                  },
                },
                t('action.refresh'),
              ),
            ),
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