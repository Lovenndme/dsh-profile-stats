# dsh-profile-stats

A personal usage profile page for the **DeepSeek Harness Web UI** (dsh). It adds one entry to the
left sidebar — *Profile / 个人主页* — with the numbers people actually ask about:

- **Cumulative tokens** with an input / output / cache-hit split
- **Peak day** (plus peak step and peak session)
- **Longest task** (longest `turn/start` → `turn/end` span)
- **Longest streak / current streak** of active days
- **Token activity heatmap** for the last 12 months (GitHub-contribution style, quartile buckets,
  hover shows the day's tokens, the exact number and the day's request count)
- **Provider breakdown** (today / all time) — which billing route each token went through

Everything is folded from **this machine's own session logs**. No network calls, no telemetry,
no credentials, no upload.

## What each number means

| Card | Definition |
|---|---|
| Cumulative tokens | Per `assistant/message` step: `max(totalTokens, input + output)` summed over all sessions. `totalTokens` from the provider already equals input + output + cache, so cache is counted once. |
| Peak day | Highest single-day total. Peak step / peak session are recorded too and are available in the snapshot. |
| Longest task | Longest span between a `turn/start` and its `turn/end` (turns interrupted without `turn/end` are not counted). |
| Streaks | Active day = a local calendar day with at least one token. Current streak ends today (or yesterday, if today has no activity yet). |
| Token mix | Input / output / cache-hit totals over the selected scope. |
| Provider breakdown | Per-step `data.message.source.provider`, e.g. `wincode`, `arkcli-coding-plan`, `myapi`, `deepseek-account`. |

### Why provider breakdown matters

Gateway consoles often show `input + cache-hit + output` as a single “total tokens” figure. Since
`cache-hit` is a **subset of** `input`, that sum counts the cache twice. On a real machine (measured
2026-10-30) the gateway card said 340.15M for one token while `input + output` was 173.02M — and this
plugin's number for that same provider was 172.21M (0.5% apart, explained by the scan being a few
minutes older). Use the provider breakdown to compare one billing route at a time.

## Requirements

- DeepSeek Harness with the Web UI (desktop app or `dsh web`), **dsh >= 0.2.1-rc.5 < 0.3.0**.
- No other plugin is required. Light/dark themes both supported (theme tokens only).

## Install

Three equivalent ways — use whichever your setup allows:

**1. From this repository** (works today, no npm account or marketplace entry needed):

```
plugin_manager(action: "install_bundle", target: "github:Lovenndme/dsh-profile-stats")
```

which is the same as `dsh plugin add github:Lovenndme/dsh-profile-stats`. pnpm fetches the repo and
installs the packed files; there is no build step and no dependency to approve.

**2. From npm**, once published:

```
plugin_manager(action: "install_bundle", target: "dsh-profile-stats")
```

**3. From the marketplace**: **Plugins → Discover**, search `dsh-profile-stats`, install.

After installing, a **Profile** row appears in the left sidebar (person icon). Click it; the page
renders immediately from a cached snapshot and rescans in the background.

## Who is shown (name / handle / avatar)

Nothing is hardcoded and nothing is read from an account: **a fresh install shows your own operating-system
account name**. For example, a user whose OS account is `alice` sees `alice` and `@alice`. Precedence:

1. **`$DSH_HOME/dsh-profile-stats/profile.json`** — optional, written by you only if you want something
   other than the OS account name:

   ```json
   { "name": "Your Name", "handle": "@your-handle", "avatar": "Y" }
   ```

   `handle` gets a leading `@` if you omit it, `avatar` is optional (defaults to the first letter of
   `name`). The file is re-read on every snapshot request, so editing it needs no restart. This file lives
   in your `$DSH_HOME`, is never shipped inside the package and never appears in this repository.
2. **The operating-system account name** (`os.userInfo().username`), handle `@<lowercased name>` — the
   default for everyone who installs the plugin.
3. Fallback text `DSH 用户` / `@local` when the account name is unavailable.

The snapshot reports `identity.source` (`file` or `os`) and `identity.file` (the exact path), so you can
always tell which rule applied.

## Uninstall

Disable or remove the bundle in **Plugins**. The plugin only writes two files; delete them if you want a
clean slate:

```
$DSH_HOME/dsh-profile-stats/cache.json      # default: ~/.dsh/dsh-profile-stats/cache.json
$DSH_HOME/dsh-profile-stats/profile.json    # optional display-name override
```

## Data flow

Host half (`index.js`):

- `GET  /api/dsh-profile-stats/snapshot` — current snapshot; `scanning: true` carries `progress`
- `POST /api/dsh-profile-stats/refresh` — request a background rescan
- Reads sessions through `ctx.sessionQuery` (`listSessions`, `readSession`), folds them per session and
  caches the fold. Only sessions that are **still running** or **never folded** get re-read; finished
  sessions reuse the cache.
- Fork/seed sessions copy their source events into the log header (`inheritedEventCount`). Those copies
  are excluded — unless the source session is gone from this machine, in which case the copies are the
  only record and are counted.

Client half (`client.js`): registers into `sidebar.panellist` (id `profile`) and the `main` slot
(key `profile`), styles with theme tokens, and routes all visible text through the locale service
(`en`, `zh`).

Snapshot fields:

```
totals:  tokens, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, calls,
         sessions, activeDays, firstDay, lastDay,
         peakDay {date, tokens}, peakStepTokens, peakSessionTokens, longestTurnMs,
         longestStreak, currentStreak, byProvider {}
daily[]: date, tokens, calls, inputTokens, outputTokens, cacheTokens, byProvider {}
```

## Limitations

- Local machine only: usage from other devices or other tools never enters these logs.
- Numbers move while a session is active (the log has no fixed end); expect sub-1% drift between two
  scans a few minutes apart.
- A day is bucketed by the host's local timezone; moving machines shifts historical buckets.
- A session whose log cannot be read is counted in `failedSessions` and skipped, never guessed.

## Development

- Host changes need a fresh module generation: toggle `include:dsh-profile-stats` off and on via
  `plugin_manager`, or restart Harness.
- Client changes only need a page refresh.
- `index.js` exports `apply` / `inject` only; `client.js` registers through `window.__ModuleLoader__`.

## License

MIT © 2026 Lovenndme

---

# 中文说明

给 DeepSeek Harness Web UI 加一个**个人主页**面板：左侧图标栏多一个「个人主页」入口，主区显示

- **累计 Token 数**（输入 / 输出 / 缓存命中拆分）
- **单日峰值**（另记单次调用峰值、单会话峰值）
- **最长任务用时**（同一 turn 内 `turn/start` → `turn/end` 的最大跨度）
- **最长连续天数 / 当前连续天数**（活跃日按本机时区）
- **Token 活动热力图**（近 12 个月，按当日用量四分位分档；悬浮显示日期、当天用量、精确数字、当天请求数）
- **供应商拆分**（今日 / 累计），按每一步的 `data.message.source.provider` 分组

**数据全部来自本机会话日志**：不联网、不上报、不碰任何凭据。删掉缓存文件只会让下次重扫，数字不会和日志不一致。

### 为什么需要「供应商拆分」

很多网关面板的「总 Token」是 `输入 + 缓存命中 + 输出` 三列相加，而「缓存命中」本身就包含在「输入」里，等于把缓存算了两次。
实测（2026-10-30）某网关对单个令牌显示 3.4 亿，而 `输入 + 输出` 只有 1.73 亿；本插件对同一 provider 的统计是 1.72 亿（差 0.5%，来自扫描时刻不同）。
所以对账时请按 provider 逐家比较，不要直接和「总 Token」相减。

### 安装

在 Harness 里打开 **插件 → 发现**，搜索 `dsh-profile-stats` 安装；或用 `plugin_manager(action: "install_bundle", target: "dsh-profile-stats")`。
装好后左侧出现「个人主页」一行，点开即用（先出缓存快照，再后台补扫）。

### 要求

DeepSeek Harness Web UI，**dsh >= 0.2.1-rc.5 < 0.3.0**。无其它插件依赖，明暗主题均支持（只用主题 token）。

### 已知边界

- 只统计本机日志：其它设备、其它工具的用量不在这里。
- 会话进行中数字会动，两次扫描间隔几分钟通常有 1% 内的差异。
- 按主机本地时区分日，换时区会让历史分档平移。
- 日志读不出来的会话会计入 `failedSessions` 并跳过，不会瞎猜。
