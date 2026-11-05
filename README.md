# dsh-profile-stats

A personal usage profile page in the DSH sidebar: how many tokens you have burned, when, on which
model, and through which billing route — all folded from this machine's own session logs.

**English** · [简体中文](README.zh.md)

![The profile page](https://cdn.jsdelivr.net/gh/Lovenndme/dsh-profile-stats@main/docs/overview.png?v=2)

## What you get

- **Five headline numbers**: cumulative tokens (with a recent-days sparkline), today's tokens,
  longest task, longest and current active-day streaks
- **Token activity**: a 12-month day grid, switchable between daily, weekly and running-total views
- **Model distribution**: stacked columns by model family (version + tier, so `v4-flash` and
  `v4.1-flash` stay apart), over the last 12 days, 12 weeks or 12 months — its own switch
- **Cache Lens**: total tokens plus the cache hit rate, and the cache-hit / uncached-input / output
  split as a segmented bar, with a zoom into the uncached part
- **Provider split**: tokens per billing route, for today or all time

![Cache Lens](https://cdn.jsdelivr.net/gh/Lovenndme/dsh-profile-stats@main/docs/mix.png?v=2)

Everything is read from your own session logs through `ctx.sessionQuery`; nothing is re-derived from
guesses. The only outbound request is a six-hourly read of this package's own version from the npm
registry, used by the in-panel update button. No telemetry, no credentials, nothing uploaded.

## Install

In DSH: **Plugins → Add plugin**, and paste the package name:

```
dsh-profile-stats
```

If you are in mainland China without a proxy, set the install source to **中国大陆镜像源** (the
mirror at `registry.npmmirror.com`) before installing — the Discover tab itself loads from GitHub
Pages and may not open without a proxy. Afterwards the plugin works fully offline.

Requirements: dsh `>= 0.2.1-rc.5 < 0.3.0`. No other plugin, no runtime dependencies.

## License

MIT © 2026 Lovenndme

---

Metric definitions, the data flow, what leaves the machine, update mechanics and troubleshooting
live in [docs/INTERNALS.md](https://github.com/Lovenndme/dsh-profile-stats/blob/main/docs/INTERNALS.md).
