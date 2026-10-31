# Internals, numbers and troubleshooting

Back to the [README](../README.md) · [中文 README](../README.zh.md)

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

Gateway consoles often show `input + cache-hit + output` as one "total tokens" figure. Because cache-hit is
a **subset of** input, that sum counts the cache twice. On a measured machine (2026-10-30) a gateway card
said 340.15M for one route while `input + output` was 173.02M; this plugin's own number for the same route
was 172.21M (0.5% apart, explained by the scan being a few minutes older). Compare one billing route at a
time and the totals line up.

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

## Updating

**In-panel button.** When the package was installed from the registry, the panel reads its own `latest`
version from npm once every six hours and shows an `Update to x.y.z` button in the footer. Clicking it asks
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
- Model classes are substring matches, so a Pro/Flash label describes a family, not a single model id.

## Development and release

- Host changes need a fresh module generation: toggle `include:dsh-profile-stats` off and on via
  `plugin_manager`, or restart Harness. Client changes only need a page refresh.
- `index.js` exports `apply` / `inject` only; `client.js` registers through `window.__ModuleLoader__`.
- Release: `pwsh tools/release.ps1` (patch bump → test → commit → push → publish → verify). The script reads
  a granular npm token from `$env:NPM_TOKEN` or `$HOME/.dsh/.npm-publish-token`; no credential is stored in
  the repository.
