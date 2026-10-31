# dsh-profile-stats

A personal usage profile page in the DSH sidebar: cumulative tokens, today's usage, an activity heatmap,
a split by model, and a split by billing route — all folded from this machine's own session logs.

**English** · [简体中文](README.zh.md)

![The profile page](https://cdn.jsdelivr.net/gh/Lovenndme/dsh-profile-stats@main/docs/overview.png)

## What you get

- Cumulative tokens, drawn as an input / output / cache-hit donut
- Today's tokens, longest task time, and active-day streaks
- A 12-month activity heatmap (daily, weekly, running total)
- Tokens by model over time (Flash / Pro)
- Tokens by provider (today or all time), for reconciling gateway billing

## Install

From the marketplace: **Plugins → Discover**, search `dsh-profile-stats`.

Or directly:

```
plugin_manager(action: "install_bundle", target: "dsh-profile-stats")
```

Requirements: dsh `>= 0.2.1-rc.5 < 0.3.0`. No other plugin, no dependencies.

## License

MIT © 2026 Lovenndme

---

Metric definitions, the data flow, what leaves the machine, update mechanics and troubleshooting live in
[docs/INTERNALS.md](https://github.com/Lovenndme/dsh-profile-stats/blob/main/docs/INTERNALS.md).
