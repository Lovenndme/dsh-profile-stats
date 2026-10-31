# Add Lovenndme/dsh-profile-stats

Adds `Lovenndme/dsh-profile-stats` to `data/plugins/Lovenndme__dsh-profile-stats.yml`.

- Repo: https://github.com/Lovenndme/dsh-profile-stats (topic `dsh-plugin`)
- npm: `dsh-profile-stats@1.9.4` (published; `repository` points back at the repo above)
- Category: `usage`
- Bundle: `package.json` declares `dsh.bundle.patch` (`./cordis.patch.yml`) and `dsh.client` (web),
  both halves ship in the package (`index.js` host, `client.js` client).
- Verified on `@deepseek-ai/dsh-desktop 0.2.1-rc.5`; `engines.dsh` is `>=0.2.1-rc.5 <0.3.0-0`.

## What it does

A sidebar entry (`profile`, person icon) opens a personal usage page built from this machine's own
session logs:

- cumulative tokens as an input / output / cache-hit donut
- today's token usage
- longest task time (longest `turn/start` → `turn/end` span)
- longest / current streak of active days
- 12-month activity heatmap with three scopes (daily / weekly / running total); hovering a cell shows
  the bucket's date and its token usage
- a time-based bar chart that splits tokens by model (Flash / Pro, from `message.source.model`),
  bucketed per day for the last 14 days and per week for all time
- provider breakdown (today / all time) keyed by `data.message.source.provider`, for reconciling with
  each gateway's billing
- an in-panel update button: when the package was installed from the registry, the host reads its own
  `latest` version from npm and offers a one-click reinstall

Network surface: the only outbound request is that six-hourly version read on
`registry.npmjs.org/<package>/latest`. No telemetry, no credentials, nothing uploaded. Fork/seed
sessions copy source events into their log header; those copies are excluded unless the source session
is gone from the machine.

## Honesty notes

- Numbers come from `ctx.sessionQuery` (`listSessions` / `readSession`), so they describe this machine
  only — other devices and other tools are not included.
- Totals drift sub-1% between scans while a session is active.
- Model classes are substring matches on the model id: names containing `pro` count as Pro, names
  containing `flash` as Flash, anything else as Other. A row labelled with the current model name
  therefore aggregates older variants of the same family.
- The README documents the gateway double-counting issue with measured numbers; it is an explanation
  of the arithmetic, not a claim about any specific vendor's correctness policy.
