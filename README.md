<div align="center">

<h1>dsh-profile-stats</h1>

<p><b>A personal usage profile page in the DSH sidebar.</b><br>
How many tokens you have burned, when, on which model, through which billing route, and what it cost —<br>
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

## Why

Each DSH session tells you what that one session used. After a while the questions you actually have are
different: how much did I use this month? Which model do I lean on? How much went through each relay versus
the official API? Did the tokens go to system prompts, tool calls or reasoning? And what did all of that cost?

dsh-profile-stats adds a profile page to the sidebar that answers those questions from every session log on
this machine.

- **Works out of the box**: no API key, no setup. The first open scans this machine's session logs; after
  that the host tops up silently in the background every five minutes.
- **Numbers you can trace**: token counts are the providers' own figures as logged, and every section is
  summed from the same daily entries, so they agree with each other.
- **Stays on your machine**: logs are read only through DSH's `ctx.sessionQuery`; the one outbound request
  is a check of this package's latest version on npm.
- **Zero dependencies**: no runtime dependencies and no other plugins required.

## Install

In DSH open **Plugins → Add plugin** and paste the package name:

```text
dsh-profile-stats
```

A person icon appears in the sidebar. The first open shows scan progress and can take a while on a machine
with many sessions; the result is cached, so later opens only read sessions that are still running or new.

## What's on the page

### Header: range, export, refresh

- **Range**: today, this week (Monday to today), this month (the 1st to today), all time (the default) or
  custom dates. It sets the period for the token and spend numbers, the token stats, the projects and the
  provider split; the activity grid keeps showing the whole year but outlines the days in range. Token by
  model has its own switch.
- **Export**: the selected range as CSV (one row per day: input, output, cache read, cache write, then a
  column per provider) or JSON (the full snapshot).
- **Refresh**: rescan now. When a newer release exists, an `Update to x.y.z` button shows up here
  (registry installs only).

### Five headline numbers

| Card | Meaning |
|---|---|
| **Tokens** | Tokens in the selected range. The small trend on the right is the last 7 days as bars for today, the last 4 weeks as bars for this week, a daily line for this month and the 7-day average over the last 90 days for all time; above it is the change against the same days of the previous period (red up, green down) |
| **Spend** | Spend in the selected range — see [How spend is worked out](#how-spend-is-worked-out) |
| **Longest task** | The longest span from a turn's start to its end, over all history |
| **Active streak** | Consecutive days with usage up to today, with your best beside it |
| **Cache hit today** | Today's hit rate across all providers: cache read ÷ (uncached input + cache read + cache write) |

### Token activity

A day grid of the last 12 months (53 weeks, starting on Monday) with three views:

- **Daily**: each day coloured by the quartile of non-zero days;
- **Weekly**: one bar per week;
- **Cumulative**: the running total, whose last point is your total usage.

Hover or focus any cell with the keyboard to see its date and usage.

### Token by model

- Its own granularity switch: daily (last 7 days), weekly (last 4 weeks, the default) or monthly
  (last 6 months).
- **Tokens** draws stacked columns; **Share** draws a pie.
- Different spellings of one model collapse into a family: `deepseek-v4-1-flash-261017` and
  `deepseek-v4.1-flash` are both DeepSeek V4.1 Flash, while version and tier stay apart, so `v4-flash` and
  `v4.1-flash` never mix. Other vendors keep their own family names, e.g. `gemini-2-5-pro` → Gemini 2.5 Pro.
- The top six families get their own colour; the rest are merged into "Other models (N)".

### Token stats

Where the tokens went: a ring chart with the total in the centre and eight content categories beside it —
system prompt, tool definitions, user messages, injected context, skill injections, tool calls, reasoning and
answers — each with its share and an estimated amount.

Providers report four usage numbers per step (uncached input, cache read, cache write, output), not what the
content was. The plugin replays each session log, estimates from content sizes how the step's context was
made up, and splits the step's real usage in that proportion. **The totals are exact; the split is an
estimate**, so amounts carry a `≈`. The method follows the [dsh-context](https://github.com/bowenliang123/dsh-context)
plugin.

### Projects

Tokens, share and spend per working directory. The subagent column is the part used by subagent sessions —
the lighter segment of each bar. The top eight projects get a row and the rest are merged into
"Other projects (N)"; hover a name for the full path.

### Provider split

Tokens, share, that provider's own cache hit rate and spend per billing route (the provider id in the logs).

- **Today** shows today only and lets go when you change the header range;
- **Rename** with the pencil beside a name: the display name stays on your machine, and hovering shows the
  original id;
- **Billing method**: click the spend cell — see the next section.

## How spend is worked out

Spend takes two steps: every call is first valued at the list price, then each provider's billing method
turns that value into what you actually paid.

**Step 1: value at list price.** Each call is priced at the list price in force when it was made.

- **DeepSeek**: built-in CNY list prices, including the 2026-08-17 prices and the 2026-09-10 Flash cut. Only
  providers billed at **List price** (DeepSeek direct) pay peak rates — Beijing weekdays 9–12 and 14–18, double
  the off-peak price; weekends and the 2026 statutory holidays are off-peak.
- **Every other billing method** is valued at the flat peak price at any hour: relays and coding plans charge
  one price all day, and relays quote their discounts against the peak price.
- **Other vendors' models**: a bundled [LiteLLM](https://github.com/BerriAI/litellm) price table (models sold
  directly by their vendors only), converted from USD to CNY.
- **Unpriced**: usage before 2026-08-17 and models without a known list price. The spend card's hover says
  when there is any.

**Step 2: apply the billing method.** Settings are stored only on your machine.

| Billing method | Spend | Typical use |
|---|---|---|
| **List price** | The list-price value | Direct official API; `deepseek-official` and `deepseek-account` default to this |
| **Discount** | List-price value × your multiplier | Relays that bill a fraction of the list price |
| **Monthly** | Usage converted at list price; the hover shows usage since the renewal day against the fee | Coding plans and other subscriptions |
| **Not mine** | Left out of spend | Paid by your company, free quotas |
| *Not set* | Left out of spend; the cell reads "Set" | Every other provider until you set one |

The USD → CNY rate defaults to 6.7168; write `usdCny` at the top level of `billing.json` to change it.

## FAQ

<details>
<summary><b>Why don't the numbers match my provider's console?</b></summary>

Three usual reasons:

1. **Scope**: only this machine's DSH sessions are counted; other devices or tools using the same key are not.
2. **Double-counted cache**: many relay consoles show `input + cache hit + output` as the total, but their
   input already includes the cache hits, so the cache is counted twice.
3. **Day boundaries**: days here are cut in this machine's time zone; a console may use another.

Compare one billing route at a time using its row in the provider split, and compare token counts before
percentages. Measured numbers and the full checklist are in [docs/INTERNALS.md](docs/INTERNALS.md).
</details>

<details>
<summary><b>How is the cache hit rate calculated?</b></summary>

Cache read ÷ (uncached input + cache read + cache write). A cache write is billed and is not a hit, so it is
in the denominator only; without writes this equals DeepSeek's hit ÷ (hit + miss). None of DeepSeek, OpenAI,
Anthropic or Volcengine Ark defines a hit-rate formula in its API documentation; this one follows Langfuse.
</details>

<details>
<summary><b>Can I change the name and avatar on the page?</b></summary>

By default the page shows your operating-system account name. To use something else, create
`$DSH_HOME/dsh-profile-stats/profile.json`:

```json
{ "name": "Your Name", "handle": "@your-handle", "avatar": "Y" }
```

`handle` gets a leading `@` if you leave it out, and `avatar` defaults to the first letter of `name`. Refresh
the page to see it; no restart needed.
</details>

<details>
<summary><b>Why do the numbers keep moving a little?</b></summary>

Sessions that are still running keep adding usage; two scans a few minutes apart usually differ by less than
1%. A session log that cannot be read is skipped and counted, never filled in by a guess.
</details>

<details>
<summary><b>The panel disappeared after a failed update. What now?</b></summary>

Reopen **Plugins** and install `dsh-profile-stats` again. The cache and your settings live in `$DSH_HOME`,
outside the package, so nothing is lost.
</details>

## Privacy and local files

> [!NOTE]
> Everything is read from your own session logs through `ctx.sessionQuery`. Token counts are the
> providers' own figures as logged; only the token-stats categories (split by content size) and the
> spend (priced at list prices and your billing settings) are estimates. The only outbound request
> is a six-hourly read of this package's own version from the npm registry, used by the in-panel
> update button. No telemetry, no credentials, nothing uploaded.

The plugin writes only these files, all outside the package:

| File (default folder `~/.dsh/dsh-profile-stats/`) | Contents |
|---|---|
| `cache.json` | Scan cache, so later opens don't rescan every log |
| `billing.json` | The billing method you set for each provider |
| `aliases.json` | The names you gave providers |
| `profile.json` | Optional: your own display name and avatar |
| `update.json` | The last in-panel update result |
| `timing.log` | Scan timings; rotated to `timing.log.1` past 256 KB |

## Requirements

| Requirement | Value |
|---|---|
| dsh | `>= 0.2.1-rc.5 < 0.3.0` (verified on `0.2.1-rc.5`) |
| Other plugins | none |
| Runtime dependencies | none |

## Uninstall

Disable or remove the bundle in **Plugins**. To remove its data as well, delete the
`$DSH_HOME/dsh-profile-stats/` folder.

## Development

- **Local preview**: `node tools/preview.mjs`, or double-click `preview/index.html`. It renders the repo's own
  `client.js` against built-in sample data, with switches for light / dark theme, window width, language and
  the empty, scanning and error states.
- **Tests**: `npm test`. No dependencies, about a second; CI runs it under UTC, Asia/Shanghai and
  America/Los_Angeles.
- **Releases** are batched by GitHub Actions every four hours; never bump the version by hand.

More in [CONTRIBUTING.md](CONTRIBUTING.md); metric definitions, the data flow, snapshot fields and
troubleshooting are in [docs/INTERNALS.md](docs/INTERNALS.md).

## License

MIT © 2026 Lovenndme. The bundled price table comes from LiteLLM (MIT) and the token-stats estimate follows
dsh-context; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
