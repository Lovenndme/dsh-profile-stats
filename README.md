<div align="center">

<h1>dsh-profile-stats</h1>

<p><b>A personal usage profile page in the DSH sidebar.</b><br>
How many tokens you have burned, when, on which model, and through which billing route —<br>
all folded from this machine's own session logs.</p>

<p>
<a href="https://www.npmjs.com/package/dsh-profile-stats"><img src="https://img.shields.io/npm/v/dsh-profile-stats?style=flat-square&labelColor=1F2328&color=2DA44E&logo=npm&logoColor=white" alt="npm version"></a>
<a href="https://www.npmjs.com/package/dsh-profile-stats"><img src="https://img.shields.io/npm/dm/dsh-profile-stats?style=flat-square&labelColor=1F2328&logo=npm&logoColor=white" alt="npm downloads"></a>
<a href="https://github.com/Lovenndme/dsh-profile-stats/actions/workflows/publish-pending.yml"><img src="https://img.shields.io/github/actions/workflow/status/Lovenndme/dsh-profile-stats/publish-pending.yml?branch=main&style=flat-square&label=release&labelColor=1F2328" alt="release status"></a>
<a href="./LICENSE"><img src="https://img.shields.io/npm/l/dsh-profile-stats?style=flat-square&labelColor=1F2328&color=blue" alt="MIT license"></a>
<img src="https://img.shields.io/badge/dsh-%3E%3D0.2.1--rc.5%20%3C0.3.0-38BDF8?style=flat-square&labelColor=1F2328" alt="dsh >=0.2.1-rc.5 <0.3.0">
<a href="https://github.com/Lovenndme/awesome-dsh-plugin"><img src="https://img.shields.io/badge/dsh%20plugin-listed-EA4AAA?style=flat-square&labelColor=1F2328" alt="listed in awesome-dsh-plugin"></a>
</p>

<p><b>English</b> · <a href="README.zh.md">简体中文</a></p>

<img src="https://cdn.jsdelivr.net/gh/Lovenndme/dsh-profile-stats@main/docs/panel-v2.png" alt="The profile page in the DSH sidebar" width="900">

</div>

## Install

In DSH open **Plugins → Add plugin** and paste the package name:

```text
dsh-profile-stats
```

If you are in mainland China without a proxy, set the install source to **中国大陆镜像源** (the
mirror at `registry.npmmirror.com`) before installing — the Discover tab itself loads from GitHub
Pages and may not open without a proxy. Afterwards the plugin works fully offline.

## Screenshots

<p align="center">
  <img src="https://cdn.jsdelivr.net/gh/Lovenndme/dsh-profile-stats@main/docs/heatmap.png?v=2" alt="Token activity heatmap" width="760"><br>
  <sub><b>Token activity</b> — 12 months, daily / weekly / cumulative total</sub>
</p>

<p align="center">
  <img src="https://cdn.jsdelivr.net/gh/Lovenndme/dsh-profile-stats@main/docs/model-chart-v2.png" alt="Model distribution" width="600"><br>
  <sub><b>Model distribution</b> — stacked by model family and tier</sub>
</p>

<p align="center">
  <img src="https://cdn.jsdelivr.net/gh/Lovenndme/dsh-profile-stats@main/docs/mix.png?v=2" alt="Token mix (Cache Lens)" width="440"><br>
  <sub><b>Cache Lens</b> — cache hit / uncached input / output</sub>
</p>

## What you get

| | Section | What it shows |
|---|---|---|
| 📊 | **Five headline numbers** | Cumulative tokens with a recent-days sparkline, today's tokens, longest task, longest and current active-day streaks |
| 🗓️ | **Token activity** | A 12-month day grid, switchable between daily, weekly and running-total views |
| 🧩 | **Model distribution** | Stacked columns by model family (version + tier, so `v4-flash` and `v4.1-flash` stay apart) — its own switch for 12 days / 12 weeks / 12 months, independent of the other blocks |
| 🎯 | **Cache Lens** | Total tokens plus the cache hit rate, and the cache-hit / uncached-input / output split as a segmented bar, with a zoom into the uncached part |
| 💳 | **Provider split** | Tokens per billing route, for today or all time |

A page-level range — all / today / 7 days / 30 days — drives the token figures.

## Privacy

> [!NOTE]
> Everything is read from your own session logs through `ctx.sessionQuery`; nothing is re-derived
> from guesses. The only outbound request is a six-hourly read of this package's own version from
> the npm registry, used by the in-panel update button. No telemetry, no credentials, nothing
> uploaded.

## Requirements

| Requirement | Value |
|---|---|
| dsh | `>= 0.2.1-rc.5 < 0.3.0` (verified on `0.2.1-rc.5`) |
| Other plugins | none |
| Runtime dependencies | none |

## License

MIT © 2026 Lovenndme

---

Metric definitions, the data flow, what leaves the machine, update mechanics and troubleshooting
live in [docs/INTERNALS.md](docs/INTERNALS.md).
