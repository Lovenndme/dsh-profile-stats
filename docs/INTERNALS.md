# Internals, numbers and troubleshooting

Back to the [README](../README.md) · [中文 README](../README.zh.md)

## What each number means

| Card | Definition |
|---|---|
| Cumulative tokens | Per `assistant/message` step: `max(totalTokens, input + output)`, summed over all sessions. The provider's `totalTokens` already equals input + output + cache, so cache is counted once. |
| Today's tokens | The same per-step sum restricted to today's local calendar day. |
| Longest task | Longest span between a `turn/start` and its `turn/end`. Turns interrupted without a `turn/end` are not counted. |
| Streaks | An active day has at least one token. The current streak ends today, or yesterday when today has no activity yet. |
| Token activity | Last 53 weeks (this week plus 52), weeks start on Monday. *Daily* colours each day by the quartile of non-zero days; *Weekly* draws one bar per week total; *Cumulative* is the running total including usage older than the window, so its last point equals the cumulative tokens. |
| Time range | Header switch: last 7 / 30 / 90 days (today included) or all time. The first number, the model distribution, Token mix and the provider split are summed from daily entries inside the range, so they always agree; today's tokens, longest task and the streaks stay all-time. The delta chip compares the finished days of the current period (today excluded) with the same number of days at the start of the previous period, and is hidden when the previous period starts before the first day with data. Export writes the selected range as CSV (one row per day, a column per provider) or JSON. |
| Token mix (Cache Lens) | cache = `cacheTokens` (read + write), output = `outputTokens`; **uncached input is taken from `inputTokens`**: when `inputTokens ≥ cache` it is treated as including cache hits and the cache is subtracted, otherwise it is used as is; without `inputTokens` it falls back to total − cache − output. Cache hit rate = cache ÷ (cache + uncached input). The bar spans the three parts' own sum; the percentage column is over input (cache + uncached input), output has none; the zoomed view's denominator is the uncached total (uncached input + output), which its column header says. |
| Model split | Calendar buckets (days, Monday weeks or months) covering the selected range, including empty ones; a bucket that starts before the range counts only days inside it and is labelled with the dates it really holds. Granularity options are fixed per range: 7 days → day; 30 days → day / week; 90 days → week / month; all time → day / week up to a month of data, week / month up to two years, month beyond. DeepSeek ids are grouped by version and tier (`deepseek-v4-1-flash-261017`, `deepseek-v4.1-flash` → DeepSeek V4.1 Flash; the unversioned official `deepseek-flash` alias → V4.1 Flash). Other vendors keep their own family (`gemini-2-5-pro` → Gemini 2.5 Pro). The top six families get their own colour; the rest are merged into "Other models (N)". |
| Provider breakdown | Per-step `data.message.source.provider`, e.g. `deepseek-official`, `deepseek-account`. Shares are of the selected range's total; unknown ids are shown as they are. |
| Number format | ≥ 1 亿 → 亿, ≥ 1 万 → 万, one decimal; every sum and share is computed on raw integers and formatted only when drawn. Shares below 0.05% read "<0.1%". |

### Why the provider breakdown exists

Gateway consoles often show `input + cache-hit + output` as one "total tokens" figure. Because cache-hit is
a **subset of** input, that sum counts the cache twice. On a measured machine (2026-10-30) a gateway card
said 340.15M for one route while `input + output` was 173.02M; this plugin's own number for the same route
was 172.21M (0.5% apart, explained by the scan being a few minutes older). Compare one billing route at a
time and the totals line up.

## Data flow and network surface

Host half (`index.js`):

- `GET  /api/dsh-profile-stats/snapshot` — current snapshot; `scanning: true` carries `progress`, and
  `firstScan: true` marks the first full scan (empty cache, or resuming an interrupted first scan)
- `POST /api/dsh-profile-stats/refresh` — force an immediate rescan (the refresh button)
- `POST /api/dsh-profile-stats/update` — request the in-panel update (registry installs only)
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
top:     ok, generatedAt, scanning, firstScan, progress {done, total}, identity, failedSessions
totals:  tokens, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, calls,
         sessions, activeDays, firstDay, lastDay,
         peakDay {date, tokens}, peakStepTokens, peakSessionTokens, longestTurnMs,
         longestStreak, currentStreak, byProvider {}, byModel {}
daily[]: date, tokens, calls, inputTokens, outputTokens, cacheTokens, byProvider {}, byModel {}
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

## Uninstall

Disable or remove the bundle in **Plugins**. The plugin writes only these, all outside the package:

```
$DSH_HOME/dsh-profile-stats/cache.json      # default: ~/.dsh/dsh-profile-stats/cache.json
$DSH_HOME/dsh-profile-stats/profile.json    # optional display-name override
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
  monthly view, the zoomed Cache Lens, empty / first-scan / failed-request states, language and the update button.
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
