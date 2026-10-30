# Add Lovenndme/dsh-profile-stats

Adds `Lovenndme/dsh-profile-stats` to `data/plugins/Lovenndme__dsh-profile-stats.yml`.

- Repo: https://github.com/Lovenndme/dsh-profile-stats (topic `dsh-plugin`)
- npm: `dsh-profile-stats@1.0.0` (published; `repository` points back at the repo above)
- Category: `usage`
- Bundle: `package.json` declares `dsh.bundle.patch` (`./cordis.patch.yml`) and `dsh.client` (web),
  both halves ship in the package (`index.js` host, `client.js` client).
- Verified on `@deepseek-ai/dsh-desktop 0.2.1-rc.5`; `engines.dsh` is `>=0.2.1-rc.5 <0.3.0-0`.

## What it does

A sidebar entry (`profile`, person icon) opens a personal usage page built from this machine's own
session logs:

- cumulative tokens with input / output / cache-hit split
- peak day (plus peak step and peak session in the snapshot)
- longest task time (longest `turn/start` → `turn/end` span)
- longest / current streak of active days
- 12-month token-activity heatmap; hovering a cell shows the date, the day's tokens, the exact number
  and the day's request count
- provider breakdown (today / all time) keyed by `data.message.source.provider`, for reconciling with
  each gateway's billing

No network calls, no telemetry, no credentials. Fork/seed sessions copy source events into their log
header; those copies are excluded unless the source session is gone from the machine.

## Honesty notes

- Numbers come from `ctx.sessionQuery` (`listSessions` / `readSession`), so they describe this machine
  only — other devices and other tools are not included.
- Totals drift sub-1% between scans while a session is active.
- The README documents the gateway double-counting issue with measured numbers; it is an explanation
  of the arithmetic, not a claim about any specific vendor's correctness policy.
