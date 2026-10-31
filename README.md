# dsh-profile-stats

A personal usage profile page for the **DeepSeek Harness Web UI** (dsh). It adds one entry to the left
sidebar — *Profile* — with the numbers people actually ask about.

**English** · [简体中文](README.zh.md)

![The profile page](https://cdn.jsdelivr.net/gh/Lovenndme/dsh-profile-stats@main/docs/overview.png)

## What it shows

- **Cumulative tokens** as an input / output / cache-hit donut
- **Today's tokens**
- **Longest task** (longest `turn/start` → `turn/end` span)
- **Longest / current streak** of active days
- **Activity heatmap** for the last 12 months in three scopes — daily, weekly, and the running total —
  with the date and the bucket's usage on hover
- **Tokens by model** over time (last 14 days per day, all time per week), split into the Flash and Pro
  families from each step's `message.source.model`
- **Provider breakdown** (today / all time) — which billing route each token went through

Everything is folded from **this machine's own session logs**.

## What each number means

| Card | Definition |
|---|---|
| Cumulative tokens | Per `assistant/message` step: `max(totalTokens, input + output)`, summed over all sessions. The provider's `totalTokens` already equals input + output + cache, so cache is counted once. |
| Today's tokens | The same per-step sum restricted to today's local calendar day. |
| Longest task | Longest span between a `turn/start` and its `turn/end`. Turns interrupted without a `turn/end` are not counted. |
| Streaks | An active day has at least one token. The current streak ends today, or yesterday when today has no activity yet. |
| Token mix | Input / output / cache-hit totals. **Input counts only uncached prompt tokens**; cache hits are separate, so input + cache-hit is the full prompt. |
| Model split | Model class is a substring match on the model id: names containing `pro` count as Pro, names containing `flash` as Flash, everything else as Other. A bar labelled with the current model name therefore aggregates older variants of that family. |
| Provider breakdown | Per-step `data.message.source.provider`, e.g. `wincode`, `arkcli-coding-plan`, `myapi`, `deepseek-account`. |

### Why the provider breakdown exists

Gateway consoles often show `input + cache-hit + output` as one "total tokens" figure. Because cache-hit
is a **subset of** input, that sum counts the cache twice. On a measured machine (2026-10-30) a gateway
card said 340.15M for one route while `input + output` was 173.02M; this plugin's own number for the same
route was 172.21M (0.5% apart, explained by the scan being a few minutes older). Compare one billing route
at a time and the totals line up.

## Requirements

- DeepSeek Harness with the Web UI (desktop app or `dsh web`), **dsh >= 0.2.1-rc.5 < 0.3.0**.
- No other plugin required. Light and dark themes are both supported (theme tokens only).

## Install

Three ways; use whichever your setup allows.

**1. From npm** (the one to pick if you want automatic or in-panel updates):

```
plugin_manager(action: "install_bundle", target: "dsh-profile-stats")
```

which is the same as `dsh plugin add dsh-profile-stats`.

**2. From this repository** (no npm release needed):

```
plugin_manager(action: "install_bundle", target: "github:Lovenndme/dsh-profile-stats")
```

**3. From the marketplace**: **Plugins → Discover**, search `dsh-profile-stats`, install.

After installing, a **Profile** row appears in the left sidebar (person icon). The page renders
immediately from a cached snapshot and rescans in the background. The first scan of a large log corpus
takes a couple of seconds; the cards show `—` and a `done/total` counter while it runs.

## Updating

**In-panel button.** When the package was installed from the registry, the panel reads its own `latest`
version from npm once every six hours and shows an `Update to x.y.z` button in the footer. Clicking it asks
the host to remove and reinstall the bundle; the page reloads by itself once the new version is in place.

**Third-party updaters.** An install from the registry can also be followed by a plugin such as
`@sueleven/dsh-auto-update`, which lists outdated enabled packages on launch and updates them after you
confirm. Both paths need a restart on the desktop profile.

Two deliberate limits:

- Installations from a git, tarball, or `link:` spec never show the button, and registry updaters skip
  them too — a self-update there would rewrite how you installed it. Install from npm if you want
  automatic updates.
- On the **desktop** profile the `dsh plugin` CLI is refused (`profile "desktop" is managed exclusively by
  the Electron application`), so CLI-driven updaters cannot work there; the in-panel button can.

**If an update fails** after the old copy was removed, the panel disappears with the bundle: reopen
**Plugins** and install `dsh-profile-stats` again. Your data is untouched — the cache and `profile.json`
live in `$DSH_HOME`, outside the package.

## Who is shown (name / handle / avatar)

Nothing is hardcoded and nothing is read from an account: **a fresh install shows your own
operating-system account name**. Precedence:

1. **`$DSH_HOME/dsh-profile-stats/profile.json`** — optional, written by you only if you want something
   other than the OS account name:

   ```json
   { "name": "Your Name", "handle": "@your-handle", "avatar": "Y" }
   ```

   `handle` gets a leading `@` if you omit it; `avatar` defaults to the first letter of `name`. The file is
   re-read on every snapshot request, so editing it needs no restart. It lives in your `$DSH_HOME`, is
   never shipped inside the package, and never appears in this repository.
2. **The operating-system account name** (`os.userInfo().username`), handle `@<lowercased name>`.
3. Fallback text `DSH 用户` / `@local` when the account name is unavailable.

The snapshot reports `identity.source` (`file` or `os`) and `identity.file` (the exact path), so you can
always tell which rule applied.

## Data flow and network surface

Host half (`index.js`):

- `GET  /api/dsh-profile-stats/snapshot` — current snapshot; `scanning: true` carries `progress`
- `POST /api/dsh-profile-stats/refresh` — request a background rescan
- `POST /api/dsh-profile-stats/update` — request the in-panel update (registry installs only)
- Reads sessions through `ctx.sessionQuery` (`listSessions`, `readSession`), folds each session and caches
  the fold; only sessions that are still running or were never folded get re-read.
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
totals:  tokens, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, calls,
         sessions, activeDays, firstDay, lastDay,
         peakDay {date, tokens}, peakStepTokens, peakSessionTokens, longestTurnMs,
         longestStreak, currentStreak, byProvider {}, byModel {}
daily[]: date, tokens, calls, inputTokens, outputTokens, cacheTokens, byProvider {}, byModel {}
update:  installed, latest, available, canUpdate, running, lastResult
```

## Uninstall

Disable or remove the bundle in **Plugins**. The plugin writes only these, both outside the package:

```
$DSH_HOME/dsh-profile-stats/cache.json      # default: ~/.dsh/dsh-profile-stats/cache.json
$DSH_HOME/dsh-profile-stats/profile.json    # optional display-name override
$DSH_HOME/dsh-profile-stats/update.json     # last in-panel update result
```

## Limitations

- Local machine only: usage from other devices or other tools never enters these logs.
- Numbers move while a session is active (the log has no fixed end); expect sub-1% drift between two scans
  a few minutes apart.
- A day is bucketed by the host's local timezone; moving machines shifts historical buckets.
- A session whose log cannot be read is counted in `failedSessions` and skipped, never guessed.
- Model classes are substring matches, so a Pro/Flash label describes a family, not a single model id.

## Development

- Host changes need a fresh module generation: toggle `include:dsh-profile-stats` off and on via
  `plugin_manager`, or restart Harness.
- Client changes only need a page refresh.
- `index.js` exports `apply` / `inject` only; `client.js` registers through `window.__ModuleLoader__`.

## Release (maintainer)

```
pwsh tools/release.ps1            # patch bump -> test -> commit -> push -> publish -> verify
pwsh tools/release.ps1 minor      # or: minor / major / an explicit version / none
```

The script never stores credentials in the repository: it reads a granular npm token (bypass 2FA,
read/write on this package) from `$env:NPM_TOKEN` or `$HOME/.dsh/.npm-publish-token`.

## License

MIT © 2026 Lovenndme
