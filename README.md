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

<img src="https://cdn.jsdelivr.net/gh/Lovenndme/dsh-profile-stats@main/docs/preview-2026-11-10.png" alt="The profile page in the DSH sidebar" width="900">

</div>

## Install

In DSH open **Plugins → Add plugin** and paste the package name:

```text
dsh-profile-stats
```

## What you get

| | Section | What it shows |
|---|---|---|
| 📊 | **Five headline numbers** | Tokens in the selected range (with a small trend beside it — the last 7 days as bars for today, the last 4 weeks for this week, a daily line for this month — and the change against the previous period above the trend), its spend, longest task, the active-day streak with your best, today's cache hit rate |
| 🗓️ | **Token activity** | A 12-month day grid, switchable between daily, weekly and running-total views |
| 🧩 | **Model distribution** | Stacked columns by model family (version + tier, so `v4-flash` and `v4.1-flash` stay apart) by day (last 7 days), week (last 4 weeks) or month (last 6 months) — independent of the header range — as stacked columns of token amounts, or as a pie of each model's share of the window |
| 🎯 | **Token stats** | Where the tokens went, as a ring chart with the total in the centre: system prompt, tool definitions, user messages, injected context, skill injections, tool calls, reasoning and answers, each with its share and an estimated amount |
| 💳 | **Provider split** | Tokens and cache hit rate per billing route in the selected range, or today only; give a route a display name that stays on your machine |
| 📁 | **Projects** | Tokens per working directory in the selected range, with the part used by subagent sessions |
| 💰 | **Spend** | The selected range's spend, plus a spend column per provider and project. Usage is priced at the list price (peak and off-peak hours only for DeepSeek direct; relays and coding plans at the flat peak price, which is what relays discount from); each provider can be set to list price, a discount, a monthly plan (usage converted to money, with the usage since the latest renewal day against the fee) or not counted, stored only on your machine |

A range switch in the header — today, this week, this month, all time or custom dates — drives the first number, the token stats, the projects and the provider split (the model distribution has its own switch); the selected range can be exported as CSV (one row per day) or JSON.

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
