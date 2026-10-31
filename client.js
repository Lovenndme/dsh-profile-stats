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
    const CELL_PITCH = 16

    /* -------------------------------------------------------------- 文案字典 */

    const EN = {
      'panel.title': 'Profile',
      'stat.tokens': 'Total tokens',
      'stat.peak': 'Peak daily tokens',
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
      'stat.peak': 'Token 使用峰值',
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
.dps-root{
--dps-fs-title:24px;--dps-fs-section:16px;--dps-fs-kpi:30px;--dps-fs-body:14px;--dps-fs-small:12px;
--dps-gap:12px;--dps-pad:24px;--dps-section:56px;--dps-card:8px;--dps-control:6px;
height:100%;min-height:0;overflow-y:auto;box-sizing:border-box;
background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);
font-size:var(--dps-fs-body);line-height:1.5;
}
.dps-page{max-width:1120px;margin:0 auto;padding:40px 24px 72px;display:flex;flex-direction:column;gap:var(--dps-section)}
.dps-identity{display:flex;align-items:center;gap:16px}
.dps-avatar{width:56px;height:56px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:600;flex:0 0 auto;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dps-id-text{display:flex;flex-direction:column;gap:2px;min-width:0}
.dps-name{font-size:var(--dps-fs-title);font-weight:600;line-height:1.2;letter-spacing:-.01em}
.dps-handle{font-size:var(--dps-fs-small);color:var(--dsw-alias-label-secondary)}
.dps-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:var(--dps-gap);background:var(--dsw-alias-bg-layer-1);border-radius:var(--dps-card);padding:var(--dps-pad)}
.dps-stat{display:flex;flex-direction:column;gap:4px;min-width:0}
.dps-stat-value{font-size:var(--dps-fs-kpi);font-weight:500;line-height:1.1;letter-spacing:-.02em;font-variant-numeric:tabular-nums;white-space:nowrap}
.dps-stat-label{font-size:var(--dps-fs-small);color:var(--dsw-alias-label-secondary)}
.dps-stat-sub{font-size:var(--dps-fs-small);color:var(--dsw-alias-label-secondary);opacity:.78}
.dps-section{display:flex;flex-direction:column;gap:16px}
.dps-section-head{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
.dps-section-title{font-size:var(--dps-fs-section);font-weight:600;letter-spacing:-.005em}
.dps-section-note{font-size:var(--dps-fs-small);color:var(--dsw-alias-label-secondary)}
.dps-card{background:var(--dsw-alias-bg-layer-1);border-radius:var(--dps-card);padding:var(--dps-pad)}
.dps-heat{display:flex;flex-direction:column;gap:16px;overflow-x:auto}
.dps-heat-grid{display:grid;grid-auto-flow:column;grid-template-rows:repeat(7,13px);grid-auto-columns:13px;gap:3px}
.dps-cell{width:13px;height:13px;border-radius:3px;background:var(--dsw-alias-bg-layer-2)}
.dps-cell[data-future="true"]{opacity:.3}
.dps-months{position:relative;height:16px;font-size:var(--dps-fs-small);color:var(--dsw-alias-label-secondary)}
.dps-month{position:absolute;top:0;white-space:nowrap}
.dps-mix{display:flex;align-items:center;gap:32px;flex-wrap:wrap}
.dps-mix-chart{flex:0 0 auto;line-height:0}
.dps-mix-legend{flex:1 1 260px;display:grid;grid-template-columns:1fr auto auto;gap:10px 16px;align-items:baseline;font-size:var(--dps-fs-body)}
.dps-mix-row{display:contents}
.dps-mix-label{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-primary)}
.dps-mix-value{font-variant-numeric:tabular-nums;text-align:right}
.dps-mix-share{font-size:var(--dps-fs-small);color:var(--dsw-alias-label-secondary);text-align:right;min-width:44px}
.dps-dot{width:8px;height:8px;border-radius:2px;flex:0 0 auto}
.dps-prov-card{display:flex;flex-direction:column;gap:16px}
.dps-prov{display:flex;flex-direction:column;gap:10px}
.dps-prov-head{display:flex;align-items:center;justify-content:flex-end;gap:12px}
.dps-prov-row{display:grid;grid-template-columns:minmax(120px,180px) 1fr auto auto;gap:8px 16px;align-items:center;font-size:var(--dps-fs-body)}
.dps-prov-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dps-prov-bar{height:4px;border-radius:2px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;display:block}
.dps-prov-bar > span{display:block;height:100%;border-radius:2px}
.dps-prov-value{font-variant-numeric:tabular-nums;text-align:right}
.dps-prov-share{font-size:var(--dps-fs-small);color:var(--dsw-alias-label-secondary);text-align:right;min-width:44px}
.dps-switch{display:inline-flex;gap:2px;background:var(--dsw-alias-bg-layer-2);border-radius:var(--dps-control);padding:2px}
.dps-switch button{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font-size:var(--dps-fs-small);font-family:inherit;padding:5px 10px;border-radius:4px;cursor:pointer}
.dps-switch button[data-active="true"]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-weight:500}
.dps-button{appearance:none;border:0;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:var(--dps-fs-small);font-family:inherit;font-weight:500;height:32px;padding:0 14px;border-radius:var(--dps-control);cursor:pointer}
.dps-button:hover{background:var(--dsw-alias-bg-layer-1)}
.dps-button-primary{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-base)}
.dps-tip{position:fixed;z-index:9999;pointer-events:none;transform:translate(-50%,-100%);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);border-radius:var(--dps-control);padding:8px 12px;white-space:nowrap;/* taste-skill-ignore shadow: tooltip is a real overlay */box-shadow:0 8px 24px rgba(0,0,0,.24)}
.dps-tip-date{color:var(--dsw-alias-label-secondary)}
.dps-tip-value{font-size:var(--dps-fs-body);font-weight:500;font-variant-numeric:tabular-nums}
.dps-footer{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;font-size:var(--dps-fs-small);color:var(--dsw-alias-label-secondary)}
.dps-placeholder{color:var(--dsw-alias-label-secondary)}
.dps-error{display:flex;flex-direction:column;gap:8px;font-size:var(--dps-fs-body);color:var(--dsw-alias-state-error-primary)}
.dps-error-title{font-weight:600}
@keyframes dps-rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.dps-page > *{animation:dps-rise .28s ease-out both}
.dps-page > *:nth-child(2){animation-delay:.04s}
.dps-page > *:nth-child(3){animation-delay:.08s}
.dps-page > *:nth-child(4){animation-delay:.12s}
.dps-page > *:nth-child(5){animation-delay:.16s}
@media (prefers-reduced-motion:reduce){.dps-page > *{animation:none}}
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
        { key: 'input', label: t('breakdown.input'), value: toNumber(totals.inputTokens), color: 'var(--dsw-alias-label-primary)' },
        { key: 'output', label: t('breakdown.output'), value: toNumber(totals.outputTokens), color: 'var(--dsw-alias-label-secondary)' },
        {
          key: 'cache',
          label: t('breakdown.cache'),
          value: toNumber(totals.cacheReadTokens) + toNumber(totals.cacheWriteTokens),
          color: 'var(--dsw-alias-brand-primary)',
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
        h('div', { className: 'dps-mix-chart' }, h(DonutChart, { segments, size: 124, thickness: 18, label: t('section.breakdown') })),
        h(
          'div',
          { className: 'dps-mix-legend' },
          rows,
        ),
      )
    }

    // 发牌要求「整屏只有一束色相」：供应商条只用一个品牌色，用明度分档表达排名。
    const PROVIDER_COLORS = [
      'var(--dsw-alias-brand-primary)',
      'color-mix(in srgb, var(--dsw-alias-brand-primary) 74%, var(--dsw-alias-bg-layer-1))',
      'color-mix(in srgb, var(--dsw-alias-brand-primary) 56%, var(--dsw-alias-bg-layer-1))',
      'color-mix(in srgb, var(--dsw-alias-brand-primary) 42%, var(--dsw-alias-bg-layer-1))',
      'color-mix(in srgb, var(--dsw-alias-brand-primary) 30%, var(--dsw-alias-bg-layer-1))',
      'color-mix(in srgb, var(--dsw-alias-brand-primary) 20%, var(--dsw-alias-bg-layer-1))',
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
      const todayEntry = daily.length > 0 ? daily[daily.length - 1] : null
      const providerHasRows = Boolean(
        (todayEntry && todayEntry.byProvider && Object.keys(todayEntry.byProvider).length > 0) ||
          (totals && totals.byProvider && Object.keys(totals.byProvider).length > 0),
      )
      const peakSub = totals && totals.peakDay && totals.peakDay.date ? totals.peakDay.date : undefined

      const stats = h(
        'div',
        { className: 'dps-stats' },
        h(StatCard, { label: t('stat.tokens'), value: hasAnySession ? formatTokens(totals.tokens) : '' }),
        h(StatCard, {
          label: t('stat.peak'),
          value: hasAnySession ? formatTokens(totals.peakDay ? totals.peakDay.tokens : 0) : '',
          sub: hasAnySession ? peakSub : undefined,
        }),
        h(StatCard, {
          label: t('stat.longestTurn'),
          value: hasAnySession ? formatDuration(totals.longestTurnMs) : '',
        }),
        h(StatCard, { label: t('stat.longestStreak'), value: hasAnySession ? formatDays(totals.longestStreak) : '' }),
        h(StatCard, { label: t('stat.currentStreak'), value: hasAnySession ? formatDays(totals.currentStreak) : '' }),
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
            h(
              'div',
              { className: 'dps-id-text' },
              h('div', { className: 'dps-name' }, identity.name || 'DSH'),
              h('div', { className: 'dps-handle' }, identity.handle || '@local'),
            ),
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
                      className: 'dps-button dps-button-primary',
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