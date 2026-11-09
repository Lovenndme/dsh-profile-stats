# Internals, numbers and troubleshooting

Back to the [README](../README.md) · [中文 README](../README.zh.md)

## What each number means

| Card | Definition |
|---|---|
| Cumulative tokens | Per `assistant/message` step: uncached input + cache read + cache write + output, summed over all sessions. DSH logs the four parts disjointly (`inputTokens` is only the uncached part), so nothing is counted twice. `totalTokens` is used only when all four parts are missing; a step whose `totalTokens` disagrees with the sum is counted in `usageMismatchCalls` and never used to adjust a number. Some steps in older DSH logs (Aug–Sep 2026) have no `totalTokens`; the earlier `max(totalTokens, input + output)` dropped their cache. |
| Today's tokens | The same per-step sum restricted to today's local calendar day. |
| Longest task | Longest span between a `turn/start` and its `turn/end`. Turns interrupted without a `turn/end` are not counted. |
| Streaks | An active day has at least one token. The current streak ends today, or yesterday when today has no activity yet. One card shows the current streak with the longest beside it. |
| Cache hit today | Today's cache read ÷ (uncached input + cache read + cache write); "—" until today has input. |
| Token activity | Last 53 weeks (this week plus 52), weeks start on Monday. *Daily* colours each day by the quartile of non-zero days; *Weekly* draws one bar per week total; *Cumulative* is the running total including usage older than the window, so its last point equals the cumulative tokens. |
| Time range | Header switch: today, this week (Monday to today), this month (the 1st to today), all time (the default), or custom dates (two date fields; reversed dates are swapped, the end is capped at today, and the window may lie entirely in the past, in which case the charts and the delta end at its last day). The first number, Token mix and the provider split are summed from daily entries inside the range, so they always agree (the model distribution does not follow the range, see below); today's tokens, longest task and the streaks stay all-time. The first card's trend uses one bar per day (today highlighted) whenever the window is 31 days or shorter, and the 7-day moving average for all time (which draws the last 90 days) and longer custom windows; a single day (today) draws no trend. Hovering shows the day and its value. The delta chip compares the finished days of the current period (today excluded) with the same number of days at the start of the previous period — for this week, the same days (Monday on) of last week; for this month, the same days of last month, capped at its last day; for a custom window, the window of equal length before it — and is hidden when the previous period starts before the first day with data. Export writes the selected range as CSV (one row per day: `input`, `output`, `cache_read`, `cache_write`, then a column per provider) or JSON (adds each provider's four parts and `usageMismatchCalls`). |
| Token mix (Cache Lens) | The four parts as logged, nothing inferred: cache hit = `cacheReadTokens`, cache write = `cacheWriteTokens` (a row only when non-zero), uncached input = `inputTokens`, output = `outputTokens`; they add up to the total. **Cache hit rate = cache hit ÷ (uncached input + cache hit + cache write)**: a write is billed and is not a hit, so it is in the denominator only. Without writes this is DeepSeek's hit ÷ (hit + miss). The percentage column is over all input (so the cache-hit row equals the hit rate), output has none; the zoomed view's denominator is everything except hits (uncached input + cache write + output), which its column header says. Underneath, the daily cache hit rate over the same days as the first card's trend; days without input have no rate and the line joins across them; the axis runs from the lowest value rounded down to 5% up to 100%. |
| Model split | Independent of the header range: its own switch picks the granularity (default weekly) and each granularity has a fixed window of calendar buckets ending with the one that holds today, empty buckets included — daily: the last 7 days; weekly: the last 4 Monday-based weeks; monthly: the last 6 months. The last week / month bucket is partial (up to today). The header total is the sum of that window, so it differs from the first card unless the ranges coincide. DeepSeek ids are grouped by version and tier (`deepseek-v4-1-flash-261017`, `deepseek-v4.1-flash` → DeepSeek V4.1 Flash; the unversioned official `deepseek-flash` alias → V4.1 Flash). Other vendors keep their own family (`gemini-2-5-pro` → Gemini 2.5 Pro). The top six families get their own colour; the rest are merged into "Other models (N)". The **Share** switch swaps the columns for a pie of the same window: one slice per family (clockwise from 12 o'clock, largest first, "Other" last), a percent label outside the circle for slices of 6% or more, 2 px surface gaps between slices; the legend then lists percentages (hovering a legend entry highlights its slice) and the hover / keyboard tooltip gives the share and the token amount. The header total stays in tokens. |
| Provider breakdown | Per-step `data.message.source.provider`, e.g. `deepseek-official`, `deepseek-account`. Shares are of the selected range's total; unknown ids are shown as they are. Each row has its own cache hit rate from that provider's four parts (the "Other" row uses their combined parts). The **Today** button shows today only; switching the header range releases it. The pencil beside a name renames that provider on this machine only (see *Provider names* below). |
| Projects | Each session's working directory (`cwd` in the session header). Windows paths are matched case-insensitively. A session whose header has `origin: subagent` (or `delegationDepth > 0`) counts as a subagent session; its tokens go to its own working directory, which on a measured machine was always its parent's. Rows show the folder name (with the parent folder when two share a name), the share of the range, and the subagent share of that project; the full path is in the hover title. The top eight projects get a row; the rest are merged into "Other projects (N)". |
| Spend | Every call is priced at the list price for its time from hourly usage (`slots`): DeepSeek's CNY prices from 2026-08-17 00:00 Beijing time, with the 2026-09-10 Flash cut, and peak hours on Beijing weekdays 9–12 and 14–18 (weekends and the 2026 statutory holidays are off-peak, at half price). Usage before that date, or of models without a known list price, is unpriced. Each provider's billing method then turns that list-price value into spend: list price, a discount multiplier, a monthly plan spread over the days (from its start date, or the first day it was used), or not counted. `deepseek-official` and `deepseek-account` default to list price; other providers are left out of the spend until set, and the card's hover says how many. A plan's fee is shared out to projects by that day's list-price value. The peak share is the peak part of the list-price value. |
| Number format | ≥ 1 亿 → 亿, ≥ 1 万 → 万, one decimal; every sum and share is computed on raw integers and formatted only when drawn. Shares below 0.05% read "<0.1%". |

### Why the provider breakdown exists

Gateway consoles often show `input + cache-hit + output` as one "total tokens" figure. Because the gateway's
input already **includes** the cache hits, that sum counts the cache twice. On a measured machine (2026-10-30) a gateway card
said 340.15M for one route while `input + output` was 173.02M; this plugin's own number for the same route
was 172.21M (0.5% apart, explained by the scan being a few minutes older). Compare one billing route at a
time and the totals line up.

### Comparing the cache hit rate with a provider console

The Token mix figure combines every provider in the range, so it will not equal any single console. To compare:

1. Use the provider card's row for that provider, not the combined figure.
2. Compare token counts before percentages. If this machine's counts are lower, the console also includes
   requests from other clients or machines on the same key; that is a scope difference, not a formula one.
3. Line up the dates: ranges here are rolling and end today in local time; consoles usually use calendar days
   or months. DeepSeek's documentation does not state the console's day boundary.

None of DeepSeek, OpenAI, Anthropic or Volcengine Ark defines a hit-rate formula in its API documentation.
The formula here follows Langfuse (cache read ÷ all input, writes in the denominator); the comparison of
open-source projects behind that choice is in [FINDINGS](../FINDINGS.md) under the cache hit rate design reference.

## Data flow and network surface

Host half (`index.js`):

- `GET  /api/dsh-profile-stats/snapshot` — current snapshot; `scanning: true` carries `progress`, and
  `firstScan: true` marks the first full scan (empty cache, or resuming an interrupted first scan)
- `POST /api/dsh-profile-stats/refresh` — force an immediate rescan (the refresh button)
- `POST /api/dsh-profile-stats/update` — request the in-panel update (registry installs only)
- `POST /api/dsh-profile-stats/alias` — `{ provider, name }` sets a provider's display name; an empty name removes it
- `POST /api/dsh-profile-stats/billing` — `{ provider, billing }` sets a provider's billing method; `null` returns it to the default
- Reads sessions through `ctx.sessionQuery` (`listSessions`, `readSession`), folds each session and caches
  the fold; only sessions that are still running or were never folded get re-read.
- Freshness does not depend on the page being open: the host checks every minute and rescans silently once
  the snapshot is older than 5 minutes; reading the snapshot rescans silently when it is older than 60 seconds
  (the old snapshot is answered first and the page picks up the new numbers on its next poll). The page only
  shows scan progress for the first full scan; background top-ups are silent.
- Fork/seed sessions copy their source events into the log header (`inheritedEventCount`). Those copies are
  excluded — unless the source session is gone from this machine, in which case the copies are the only
  record and are counted.

Client half (`client.js`) registers into `sidebar.panellist` (id `profile`) and the `main` slot (key
`profile`), styles with theme tokens, and routes all visible text through the locale service (`en`, `zh`).

**The only outbound request** is `GET https://registry.npmjs.org/dsh-profile-stats/latest`, made at most
once every six hours by the host to know whether a newer release exists. It sends no identifiers and no
usage data, and a failure is silent. No telemetry, no credentials, nothing uploaded. Session logs never
leave the machine.

Snapshot fields:

```
top:     ok, generatedAt, scanning, firstScan, progress {done, total}, identity, failedSessions,
         aliases {providers {id: name}}, projects {key: path}, billing {providers {id: {mode, ...}}}
totals:  tokens, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, calls,
         sessions, activeDays, firstDay, lastDay,
         peakDay {date, tokens}, peakStepTokens, peakSessionTokens, longestTurnMs,
         longestStreak, currentStreak, usageMismatchCalls, byProvider {}, byModel {}
daily[]: date, tokens, calls, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens,
         byProvider {id: tokens}, providerUsage {id: {inputTokens, cacheReadTokens, cacheWriteTokens, outputTokens}},
         byModel {}, byProject {key: tokens}, byProjectSubagent {key: tokens},
         slots [[utcHour, provider, model, projectKey, input, cacheRead, cacheWrite, output]]
update:  installed, latest, available, canUpdate, running, lastResult
```

## Updating

**In-panel button.** When the package was installed from the registry, the panel reads its own `latest`
version from npm once every six hours and shows an `Update to x.y.z` button in the header. Clicking it asks
the host to remove and reinstall the bundle; the page reloads by itself once the new version is in place.

**Third-party updaters.** An install from the registry can also be followed by a plugin such as
`@sueleven/dsh-auto-update`, which lists outdated enabled packages on launch and updates them after you
confirm.

Two deliberate limits:

- Installations from a git, tarball, or `link:` spec never show the button, and registry updaters skip them
  too — a self-update there would rewrite how you installed it.
- On the **desktop** profile the `dsh plugin` CLI is refused (`profile "desktop" is managed exclusively by
  the Electron application`), so CLI-driven updaters cannot work there; the in-panel button can.

**If an update fails** after the old copy was removed, the panel disappears with the bundle: reopen
**Plugins** and install `dsh-profile-stats` again. Your data is untouched — the cache and `profile.json`
live in `$DSH_HOME`, outside the package.

## Who is shown (name / handle / avatar)

Nothing is hardcoded and nothing is read from an account: **a fresh install shows your own operating-system
account name**. Precedence:

1. **`$DSH_HOME/dsh-profile-stats/profile.json`** — optional, written by you only if you want something
   other than the OS account name:

   ```json
   { "name": "Your Name", "handle": "@your-handle", "avatar": "Y" }
   ```

   `handle` gets a leading `@` if you omit it; `avatar` defaults to the first letter of `name`. The file is
   re-read on every snapshot request, so editing it needs no restart. It lives in your `$DSH_HOME`, is never
   shipped inside the package, and never appears in this repository.
2. **The operating-system account name** (`os.userInfo().username`), handle `@<lowercased name>`.
3. Fallback text `DSH 用户` / `@local` when the account name is unavailable.

The snapshot reports `identity.source` (`file` or `os`) and `identity.file` (the exact path).

## Provider names

The code ships no provider names beyond the host's built-in ids, so other routes show their raw id. Rename one
with the pencil on the provider card; the name is saved to `$DSH_HOME/dsh-profile-stats/aliases.json`
(`{ "providers": { "<id>": "<name>" } }`, up to 40 characters each) and is never part of the package or this
repository. Hovering a renamed row shows the original id. Clear the name to go back to the id.

## Uninstall

Disable or remove the bundle in **Plugins**. The plugin writes only these, all outside the package:

```
$DSH_HOME/dsh-profile-stats/cache.json      # default: ~/.dsh/dsh-profile-stats/cache.json
$DSH_HOME/dsh-profile-stats/profile.json    # optional display-name override
$DSH_HOME/dsh-profile-stats/aliases.json    # provider names you set on the provider card
$DSH_HOME/dsh-profile-stats/billing.json    # billing methods you set on the provider card
$DSH_HOME/dsh-profile-stats/update.json     # last in-panel update result
```

## Limitations

- Local machine only: usage from other devices or other tools never enters these logs.
- Numbers move while a session is active; expect sub-1% drift between two scans a few minutes apart.
- A day is bucketed by the host's local timezone; moving machines shifts historical buckets.
- A session whose log cannot be read is counted in `failedSessions` and skipped, never guessed.
- A model family label describes a family (version + tier for DeepSeek), not a single model id.

## Development and release

- **Local preview:** `node tools/preview.mjs` (or double-click `preview/index.html`) renders the real `client.js`
  against built-in data, with switches for light / dark theme, window width (1280 / 900 / 760), the model chart's
  monthly view, the zoomed Cache Lens, a provider that reports cache writes, empty / first-scan / failed-request
  states, language and the update button.
  Nothing leaves the page. The page state is kept in the URL hash.
- **Tests:** `npm test` (`node --test`) runs the in-repo suite in `test/` — no dependencies, about a second.
  It covers the host fold/aggregate maths (`index.js` exports its pure functions for this), cache-file
  robustness, the three routes and the update flow against a fake registry, plus the browser half's pure
  maths (read out of `client.js` by source slicing, so renaming a helper shows up as a failing test).
  `.github/workflows/test.yml` re-runs everything under UTC, Asia/Shanghai and America/Los_Angeles, and the
  publish workflow refuses to release while the suite is red. A red run keeps each timezone's full output as
  a `test-output-*` artifact (14 days) and opens an issue labelled `ci-failure`, assigned to the repo owner,
  carrying the run link and the tail of the log; the older out-of-tree harness in `../profile-stats-verify/`
  is kept for full-render smoke checks.

- Host changes need a fresh module generation: toggle `include:dsh-profile-stats` off and on via
  `plugin_manager`, or restart Harness. Client changes only need a page refresh.
- `index.js` exports `apply` / `inject` for the host, plus its pure functions and `createController` so a test
  can drive one scan without a host; `client.js` registers through `window.__ModuleLoader__`.
- Releases are **batched** and happen only in GitHub Actions: every 4 hours
  `.github/workflows/publish-pending.yml` looks for commits after the last `v*` tag, runs the test suite, then
  bumps the patch version, appends the CHANGELOG section from the commit subjects, publishes to npm, tags the
  commit and publishes a GitHub Release. Do not bump `version` or edit `CHANGELOG.md` by hand, and keep
  `package.json` BOM-free — a BOM makes DSH drop the whole bundle silently. The local publish scripts are
  intentionally disabled.
