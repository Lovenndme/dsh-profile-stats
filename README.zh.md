<div align="center">

<h1>dsh-profile-stats</h1>

<p><b>DSH 侧栏里的个人用量主页。</b><br>
用了多少 Token、什么时候用的、用的哪个模型、走的哪条计费通道、花了多少钱——<br>
全部由本机会话日志折叠而来。</p>

<p>
<a href="https://www.npmjs.com/package/dsh-profile-stats"><img src="https://img.shields.io/npm/v/dsh-profile-stats?style=flat-square&labelColor=1F2328&color=2DA44E&logo=npm&logoColor=white" alt="npm 版本"></a>
<a href="https://www.npmjs.com/package/dsh-profile-stats"><img src="https://img.shields.io/npm/dm/dsh-profile-stats?style=flat-square&labelColor=1F2328&logo=npm&logoColor=white" alt="npm 下载量"></a>
<a href="https://github.com/Lovenndme/dsh-profile-stats/actions/workflows/publish-pending.yml"><img src="https://img.shields.io/github/actions/workflow/status/Lovenndme/dsh-profile-stats/publish-pending.yml?branch=main&style=flat-square&label=release&labelColor=1F2328" alt="发布状态"></a>
<a href="./LICENSE"><img src="https://img.shields.io/npm/l/dsh-profile-stats?style=flat-square&labelColor=1F2328&color=blue" alt="MIT 许可"></a>
<img src="https://img.shields.io/badge/dsh-%3E%3D0.2.1--rc.5%20%3C0.3.0-38BDF8?style=flat-square&labelColor=1F2328" alt="dsh >=0.2.1-rc.5 <0.3.0">
<a href="https://github.com/Lovenndme/awesome-dsh-plugin"><img src="https://img.shields.io/badge/dsh%20plugin-listed-EA4AAA?style=flat-square&labelColor=1F2328" alt="已收录于 awesome-dsh-plugin"></a>
</p>

<p><a href="README.md">English</a> · <b>简体中文</b></p>

<img src="https://cdn.jsdelivr.net/gh/Lovenndme/dsh-profile-stats@main/docs/preview-2026-11-10c.png" alt="DSH 侧栏里的个人用量主页" width="900">

</div>

## 为什么需要它

DSH 的每个会话只告诉你这一次用了多少。用久了，真正想知道的是另一类问题：这个月一共用了多少？哪个模型用得最多？
各家中转站、官方直连各走了多少？Token 主要花在了系统提示、工具调用还是模型思考上？折合下来花了多少钱？

dsh-profile-stats 在左侧图标栏加一个「个人主页」，把本机所有会话日志汇总到一页里回答这些问题。

- **装上就能用**：不用填 API Key、不用任何配置。第一次打开扫描一遍本机会话日志，之后每 5 分钟在后台静默补扫。
- **数字有出处**：用量照搬日志里供应商报的数，各区块的合计都由同一份日明细求和，彼此对得上。
- **数据不出本机**：只通过 DSH 的 `ctx.sessionQuery` 读本机日志；唯一的外发请求是查本包在 npm 上的最新版本号。
- **零依赖**：没有运行时依赖，也不依赖其他插件。

## 安装

在 DSH 里打开 **插件 → 添加插件**，粘贴包名：

```text
dsh-profile-stats
```

装好后左侧图标栏会多一个人像图标。第一次打开会显示扫描进度，会话日志多时需要等一会儿；扫描结果会缓存下来，之后打开只补读还在进行或新出现的会话。

## 页面一览

### 页头：时间范围、导出、刷新

- **时间范围**：本日、本周（周一到今天）、本月（1 号到今天）、累计（默认）、自定义日期。它决定用量和花费两个数字、Token 统计、项目和供应商分类显示哪段时间；热力图仍显示全年，但会把范围内的格子描出来。模型分布有自己的开关，不跟它走。
- **导出**：把所选范围导出为 CSV（每天一行：输入、输出、缓存读、缓存写，再按供应商各一列）或 JSON（完整快照）。
- **刷新**：立刻重扫一次。有新版本时，这里会出现「更新到 x.y.z」按钮（仅限从 npm 安装的情况）。

### 五个核心数字

| 卡片 | 含义 |
|---|---|
| **用量** | 所选范围内的 Token 总数。右侧是小趋势：本日画最近 7 天的柱、本周画最近 4 周的柱、本月画每天的折线、累计画最近 90 天的 7 日均线；趋势上方是与上一周期同期的对比（红色上涨、绿色下降） |
| **花费** | 所选范围内的花费，算法见下文「[花费怎么算](#花费怎么算)」 |
| **最长任务用时** | 一轮任务从开始到结束的最长时长，统计全部历史 |
| **连续天数** | 到今天为止连续有用量的天数，旁边是历史最长纪录 |
| **今日缓存命中率** | 今天所有供应商合计的命中率，写到小数点后两位：缓存读 ÷（未缓存输入 + 缓存读 + 缓存写） |

### Token 活动

近 12 个月（53 周，周一起算）的日格热力图，三种视图：

- **每天**：按非零日用量的四分位着色；
- **每周**：每周一根柱；
- **累计总量**：逐日累加的曲线，最后一点就是你的总用量。

悬停或用键盘聚焦任意格子，可以看到日期和当天用量。

### 模型分布

- 自带粒度开关：按日（最近 7 天）、按周（最近 4 周，默认）、按月（最近 6 个月）。
- **用量**视图是堆叠柱，**占比**视图是饼图。
- 同一模型的不同写法会归并到一个家族：`deepseek-v4-1-flash-261017` 和 `deepseek-v4.1-flash` 都算作 DeepSeek V4.1 Flash；版本和档位分开，`v4-flash` 与 `v4.1-flash` 不会混在一起。其他厂商保留各自的家族名，如 `gemini-2-5-pro` 显示为 Gemini 2.5 Pro。
- 用量前 6 的家族各有颜色，其余合并为「其他模型 (N)」。

### Token 统计

Token 花在了哪里：环形图中间是总用量，旁边列出八类内容的占比与估算用量——系统提示词、工具定义、用户消息、注入内容、技能注入、工具调用、模型思考、模型回复。

供应商每一步只报四个用量数字（未缓存输入、缓存读、缓存写、输出），并不区分内容。插件会回放每个会话日志，按内容长度估算这一步上下文里各类内容的比例，再把这一步的真实用量按比例分下去。所以**总数是精确的，分类是估算的**，用量前面会标「≈」。方法参考了 [dsh-context](https://github.com/bowenliang123/dsh-context) 插件。

### 项目

按会话的工作目录拆分用量、占比和花费。「子代理」一列是其中子代理会话的占比，也就是进度条里颜色较浅的那一段。用量前 8 的项目各占一行，其余合并为「其他项目 (N)」；悬停可以看到完整路径。

### 供应商分类

按计费通道（日志里的供应商 id）拆分页头所选范围的用量、占比、各家自己的缓存命中率和花费，每家单独一行。

卡片本身只读。右上角的按钮进入**供应商设置**页，按累计用量列出所有用过的供应商：

- **显示名**：给渠道起一个只存在本机的名字（卡片上悬停改过名的一行可看原始 id）；
- **计费方式**：倍率、包月以及这一期已用多少都写在这里，卡片上不显示；点一下修改，见下一节；
- **删除**：不再用的渠道整页都不算，就像没用过一样（总量、花费、活动、模型、Token 统计、项目都不算它），
  页面会重新扫描一次，几秒钟；删掉的列在设置页最下面，可以恢复。

## 花费怎么算

花费分两步：先把每次调用按官方价折算成钱，再按你给每家供应商设置的计费方式换算。

**第一步：按官方价折算。** 每次调用都按调用时刻的官方价计算。

- **DeepSeek**：内置人民币官方价，包括 2026-08-17 的新价格和 2026-09-10 的 Flash 降价。只有计费方式为「官方价」的供应商（即直连 DeepSeek）区分峰谷：北京时间工作日 9–12 点和 14–18 点为高峰，价格是空闲时段的两倍；周末和 2026 年法定节假日按空闲价。
- **其他计费方式**：全天按高峰价折算。中转站和 coding plan 全天一个价，中转站报的折扣也是以高峰价为基准。
- **其他厂商的模型**：使用内置的 [LiteLLM](https://github.com/BerriAI/litellm) 价格表（仅含厂商官方直售的模型），美元价按汇率换算成人民币。
- **不计价**：2026-08-17 之前的用量，以及没有已知官方价的模型。花费卡悬停时会提示有这部分用量。

**第二步：按计费方式换算。** 设置只保存在本机。

| 计费方式 | 花费怎么算 | 适用场景 |
|---|---|---|
| **官方价** | 等于官方价折算 | 直连官方；`deepseek-official`、`deepseek-account` 默认就是这一档 |
| **倍率** | 官方价折算 × 你填的倍数 | 中转站，例如按官方价的几折结算 |
| **包月** | 用量按官方价换算成钱；设置页里显示从续费日起已用多少、月费多少 | coding plan 等包月套餐 |
| **不计入** | 不算进花费 | 公司付费、免费额度 |
| *未设置* | 不算进花费，费用格显示「—」 | 其余供应商的默认状态 |

美元兑人民币汇率默认是 6.7168，可以在 `billing.json` 顶层手写 `usdCny` 修改。

## 常见问题

<details>
<summary><b>为什么和供应商控制台的数字对不上？</b></summary>

常见原因有三个：

1. **范围不同**：这里只统计本机 DSH 的会话，其他设备、其他工具用同一个 Key 的用量不会出现。
2. **缓存被重复计算**：很多中转站控制台把「输入 + 缓存命中 + 输出」当作总量，但它们的「输入」本身已经包含缓存命中，相当于把缓存算了两遍。
3. **日界不同**：这里按本机时区切分日期，控制台可能用别的时区。

对账时请用「供应商分类」里对应的那一行，并先比较 Token 数，再比较百分比。实测数据和详细的对账步骤见 [docs/INTERNALS.md](docs/INTERNALS.md)。
</details>

<details>
<summary><b>缓存命中率是怎么算的？</b></summary>

缓存读 ÷（未缓存输入 + 缓存读 + 缓存写）。缓存写要计费，不算命中，所以只计入分母。没有缓存写时，结果就等于 DeepSeek 的 命中 ÷（命中 + 未命中）。DeepSeek、OpenAI、Anthropic、火山方舟的 API 文档都没有给出命中率公式，这里参考 Langfuse 的做法。
</details>

<details>
<summary><b>页面上显示的名字和头像能改吗？</b></summary>

默认显示操作系统的账户名。想换的话，新建 `$DSH_HOME/dsh-profile-stats/profile.json`：

```json
{ "name": "你的名字", "handle": "@your-handle", "avatar": "Y" }
```

`handle` 不带 `@` 会自动补上，`avatar` 默认取名字的第一个字。改完刷新页面即可生效，不用重启。
</details>

<details>
<summary><b>为什么数字一直在小幅变化？</b></summary>

会话还在进行时用量会继续增加，相隔几分钟的两次扫描之间通常有不到 1% 的差异。读不了的会话日志会被跳过并计数，不会被估算补上。
</details>

<details>
<summary><b>更新失败后面板不见了怎么办？</b></summary>

重新打开 **插件**，再安装一次 `dsh-profile-stats` 即可。缓存和设置都保存在 `$DSH_HOME` 里，不在包内，不受影响。
</details>

## 隐私与本机文件

> [!NOTE]
> 所有数字都来自你自己机器上的会话日志（经 `ctx.sessionQuery` 读取）。Token 用量照搬日志里供应商报的数，不猜不估；只有 Token 统计的分类（按内容长短拆分）和花费（按官方价与你的计费设置折算）是估算。唯一的外发请求是每 6 小时读一次本包在 npm 上的版本号，供面板内的更新按钮使用；不上报数据、不碰凭据。

插件只会写下面这些文件，都在包外：

| 文件（默认在 `~/.dsh/dsh-profile-stats/`） | 内容 |
|---|---|
| `cache.json` | 扫描缓存，让之后的打开不用重扫全部日志 |
| `billing.json` | 你给各供应商设置的计费方式 |
| `aliases.json` | 你给各供应商起的名字，以及删掉的供应商 |
| `profile.json` | 可选：你手写的显示名、头像 |
| `update.json` | 上一次面板内更新的结果 |
| `timing.log` | 每次扫描的耗时，超过 256 KB 自动轮换为 `timing.log.1` |

## 环境要求

| 项 | 要求 |
|---|---|
| dsh | `>= 0.2.1-rc.5 < 0.3.0`（已在 `0.2.1-rc.5` 上验证） |
| 其他插件 | 无 |
| 运行时依赖 | 零 |

## 卸载

在 **插件** 里停用或移除即可。如果要连数据一起清掉，再删除 `$DSH_HOME/dsh-profile-stats/` 目录。

## 参与开发

- **本地预览**：`node tools/preview.mjs`，或直接双击 `preview/index.html`。预览页用内置的示例数据渲染仓库里这份 `client.js`，可以切换浅色 / 深色主题、窗口宽度、语言和各种状态。
- **测试**：`npm test`。没有依赖，大约一秒跑完；CI 会在 UTC、上海、洛杉矶三个时区各跑一遍。
- **发版**：由 GitHub Actions 每 4 小时批量发布，不需要手动改版本号。

更多内容见 [CONTRIBUTING.md](CONTRIBUTING.md)；口径定义、数据流、快照字段与排障细节见 [docs/INTERNALS.md](docs/INTERNALS.md)。

## 许可

MIT © 2026 Lovenndme。内置价格表来自 LiteLLM（MIT），Token 统计的估算方法参考 dsh-context，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
