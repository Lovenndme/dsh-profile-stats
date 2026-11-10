# 贡献指南

感谢你愿意为 `dsh-profile-stats` 出力。

这是一个 DSH（DeepSeek Harness）插件，直接发布到 npm，用户装上就用。
**`main` 分支上的每一个提交都会被自动发版**（见 [§4.3](#43-合并就是发版)），所以下面的规范比一般的小项目严格：
它们大多来自这个仓库踩过的坑，而不是形式主义。

English readers: this guide is written in Chinese because the code comments, test titles and most review
discussion are. You can open issues and pull requests in English or Chinese; commit messages are in English.

## 目录

1. [七条底线](#1-七条底线)
2. [项目结构](#2-项目结构)
3. [开发环境](#3-开发环境)
4. [工作流程](#4-工作流程)
5. [硬性约束](#5-硬性约束)
6. [代码风格](#6-代码风格)
7. [测试](#7-测试)
8. [本地预览与 UI 改动](#8-本地预览与-ui-改动)
9. [文档](#9-文档)
10. [提交信息与 Pull Request](#10-提交信息与-pull-request)
11. [做不熟悉的新功能：先调研](#11-做不熟悉的新功能先调研)
12. [Issue、安全问题与许可证](#12-issue安全问题与许可证)

---

## 1. 七条底线

违反其中任何一条，PR 都会被要求修改后才会评审。每条的细节在对应章节。

1. **零运行时依赖。** 不加 npm 依赖，浏览器半区只能 `require('react')`，不引图表库、CDN、webfont（[§5.1](#51-通用)、[§5.2](#52-浏览器半区clientjs)）。
2. **不新增对外请求。** 浏览器半区只访问本插件的同源路由；宿主半区唯一的外发请求是读 npm 上自己的版本号（[§5.1](#51-通用)）。
3. **颜色只用宿主主题 token**，不写死 `#rrggbb` / `rgb()` / `hsl()`（[§5.2](#52-浏览器半区clientjs)）。
4. **界面里不写解释性文字。** UI 只放数据和控件，解释写进文档（[§5.2](#52-浏览器半区clientjs)）。
5. **改了折叠口径就要 bump `CACHE_VERSION`；改了用户看到的数字，要在 PR 里写清「改前 / 改后 / 哪些卡片跟着变」**（[§5.3](#53-宿主半区indexjs与缓存版本)、[§5.4](#54-数据口径)）。
6. **每个 bug 修复都带一条会先失败的测试；时间相关的代码在三个时区都要通过**（[§7](#7-测试)）。
7. **公开文件里不出现私人信息**：自己的中转站 / 供应商名、用户名、本机路径、token（[§5.5](#55-隐私与公开内容)）。

另外两件事**不要做**：手改 `package.json` 的 `version` 或 `CHANGELOG.md`（发布机器人会生成）；
运行 `tools/*.ps1` 里的发布脚本（那是维护者的工具）。

---

## 2. 项目结构

单包双面：同一个 npm 包里有「宿主半区」和「浏览器半区」，没有构建步骤，源码就是发布物。

| 路径 | 作用 |
|---|---|
| `index.js` | **宿主半区**（Node，ESM）。通过 `ctx.sessionQuery` 读本机会话日志、折叠成用量快照、写缓存，并注册同源路由 |
| `client.js` | **浏览器半区**（单文件）。`window.__ModuleLoader__.load({ id, factory })` 外壳，里面是全部 React 组件、CSS 字符串和中英文文案 |
| `cordis.patch.yml`、`package.json` 的 `exports` / `dsh` / `engines` / `files` | 决定 DSH 如何加载这个包，**改动需要维护者确认**（[§5.1](#51-通用)） |
| `locale/*.json` | 插件在 DSH 插件列表里的标题与描述（界面文案不在这里，在 `client.js` 的 `EN` / `ZH` 字典里） |
| `test/` | 仓库内测试套件（`node:test`，零依赖）。`test/helpers/` 有假宿主与「从 `client.js` 切出纯函数」的工具 |
| `preview/`、`tools/preview.mjs` | 本地预览页：用**同一份** `client.js` 加内置假数据渲染。`preview/vendor/` 是第三方压缩文件，原样保留 |
| `docs/INTERNALS.md` | 每个数字的口径定义、数据流与网络面、更新机制、排障。**口径的唯一权威来源** |
| `README.md` / `README.zh.md` | 面向用户的说明（英 / 中，保持同步） |
| `FINDINGS.md` | 审查与修复记录（A 类改数字 / B 类健壮性 / C 类只报告）以及设计调研记录 |
| `market/description.{en,zh}.txt` | 插件市场条目的标准描述，由 CI 同步到市场仓库 |
| `.github/workflows/` | `test.yml`（三时区测试）、`publish-pending.yml`（自动发版）、`sync-market-entry.yml`（市场描述同步） |

更完整的数据流见 [`docs/INTERNALS.md`](docs/INTERNALS.md#data-flow-and-network-surface)。

---

## 3. 开发环境

**不需要 `npm install`**：仓库没有任何依赖，也没有构建。

- Node.js：本地用 20 或更新版本。CI 在 Node 24 上跑测试矩阵，发版流程在 Node 20 上再跑一遍，所以**不要用 Node 20 没有的语法或 API**。
- 换行符：`.gitattributes` 统一为 LF。编辑 `package.json` 时存成 **UTF-8 无 BOM**——带 BOM 会让 DSH 静默丢弃整个插件。
- 提交前的最小自检：

  ```bash
  node --check index.js && node --check client.js   # 语法
  npm test                                           # 全部测试，约 1 秒
  node tools/preview.mjs                             # 改了界面的话，打开预览看一眼
  ```

- 在真实 DSH 里试：把你的本地检出以本地目录（`link:`）方式安装到 DSH 的 profile 里。
  - 改了 `client.js`：刷新页面即可。
  - 改了 `index.js`：需要新一代模块——在 `plugin_manager` 里把 `include:dsh-profile-stats` 关掉再打开，或重启 Harness。
  - 以 `link:` / git / tarball 方式安装的包不会显示面板里的「更新」按钮，这是有意的限制。
  - 具体的安装命令以 DSH 自己的文档为准。

---

## 4. 工作流程

### 4.1 先沟通，再动手

- 修 bug、改文档、补测试：直接开 PR 即可。
- **新功能、改口径、新增对外请求、改界面信息架构**：请先开 issue 讨论方向，避免白写。
  这个页面的口径和视觉经历过整版回滚，维护者对「看起来能跑」的半成品很谨慎。

### 4.2 分支与 PR

1. Fork 仓库（或有权限时直接建分支），从最新的 `main` 拉分支，命名 `<type>/<短名>`，例如 `fix/week-bucket-dst`、`feat/export-xlsx`。
2. 一个 PR 只做一件事。逻辑修复、视觉改动、文档整理分开提，能单独回退。
3. PR 目标分支是 `main`。填写 [§10.2](#102-pull-request) 的内容。
4. CI 必须全绿（三个时区）。红了先看该 run 里的 `test-output-*` 日志（保留 14 天）；`main` 上的失败还会自动开一个 `ci-failure` issue，来自 fork 的 PR 可能开不出，直接看 Actions 页面。

### 4.3 合并就是发版

`.github/workflows/publish-pending.yml` 每 4 小时运行一次：只要 `main` 上有上次 `v*` 标签之后的新提交，
就跑测试 → 自动把补丁版本号加一 → 用这些提交的**标题**生成 `CHANGELOG.md` 的新一节 → 发布到 npm → 打标签 → 发 GitHub Release。测试不过则不发。

所以：

- 合进 `main` 的东西会在几小时内到达所有用户。评审偏保守是有意的。
- **每个提交标题都会原样成为更新日志里的一行。** 标题要让用户读得懂（[§10.1](#101-提交信息)）。
- 不要在 PR 里改 `version` 或 `CHANGELOG.md`，会与发布机器人冲突。
- 请保持提交历史干净（无 `wip`、`fixup`、来回反复的提交）；维护者可能会 squash 合并，此时 **PR 标题**就是最终标题。

---

## 5. 硬性约束

### 5.1 通用

**零依赖。** `package.json` 没有 `dependencies`，请保持。需要的小工具自己写成纯函数（并配测试）。

**网络面是承诺，不是实现细节。** README 的 Privacy 段向用户保证了「没有遥测、没有凭据、什么都不上传」。因此：

- 浏览器半区只 `fetch` 本插件的五个同源路由：`GET /api/dsh-profile-stats/snapshot`，`POST` 的 `refresh`、`update`、`alias`、`billing`。
- 宿主半区唯一的外发请求是读 `registry.npmjs.org/dsh-profile-stats/latest`（最多每 6 小时一次，不带任何标识或用量数据）。
- **任何新增的外发请求或新路由**都必须先在 issue 里获得维护者同意，默认关闭、由用户逐项开启，并同步更新
  [`docs/INTERNALS.md`](docs/INTERNALS.md#data-flow-and-network-surface) 的路由清单、`README.md` 的 Privacy 段，以及 `index.js` 顶部的注释。
- 宿主半区只通过 `ctx.sessionQuery` 读会话日志，**只写** `$DSH_HOME/dsh-profile-stats/` 下的文件（缓存、`profile.json`、`aliases.json`、`billing.json`、`update.json`）。
  新增写入的文件要列进 INTERNALS 的 *Uninstall* 清单；绝不写进包目录。
- 会话日志、路径、用户名不得离开本机，也不得写进错误信息或日志。

**包清单与加载方式。** 不要改 `exports`、`dsh`、`engines` 字段和 `cordis.patch.yml` 的挂载方式，除非 issue 里已讨论。
新增需要随包发布的文件，要加进 `package.json` 的 `files` 白名单（否则不会发布）。

### 5.2 浏览器半区（`client.js`）

- **外壳不变。** 保持 `window.__ModuleLoader__.load({ id: 'dsh-profile-stats', factory(require) {…} })`，
  返回值 `{ inject: ['slots'], apply }`，`apply` 里往 `slots` 注册侧栏入口和主区页面。
- **只能 `require('react')`**（由宿主提供）。不用 `import`、不引图表库——图表自己用 SVG / CSS 画，图标用内联 SVG（`currentColor` 描边）。
- **颜色走主题 token，不写死色值。** DSH 有浅色、深色两套主题，写死颜色必然在其中一套里看不见。当前使用的 token：

  ```
  --dsw-alias-bg-base / bg-layer-1 / bg-layer-2 / bg-mask-2
  --dsw-alias-border-l1 / border-l2
  --dsw-alias-label-primary / label-secondary
  --dsw-alias-brand-primary
  --dsw-alias-state-success-primary / state-warn-primary / state-error-primary / state-business-primary
  ```

  需要透明或混合时用 `color-mix(in srgb, var(--dsw-alias-brand-primary) 55%, transparent)` 这类写法。
  已知的坑（DSH 0.2.1-rc.5 实测）：`brand-primary` 与 `label-primary` 是同一个「墨色」（浅色近黑、深色近白），没法拿它区分数据系列；
  `state-idle-primary` 在两套主题里都**没有定义**，用了会变透明；浅色主题下几层背景都是白色，卡片和轨道要靠边框才看得见。
- **界面只放数据和控件，不写解释性文字。** 不要出现「口径说明」「提示：…」「此图表示…」这类小字。
  数据标签、单位、坐标轴刻度、列头、悬浮提示、状态信息都可以；需要说明分母或模式变了，就改列头 / 标签（例如把「占总 Token」改成「占非缓存合计」），解释写进 `docs/INTERNALS.md`。
- **文案成对。** 所有可见文字走 `client.js` 里的 `EN` / `ZH` 字典，两种语言在同一个提交里一起加。未知的供应商 id 原样显示。
- **不崩、不空白。** 数据为空 / 为 0 / 只有一条 / 未来日期时，所有卡片仍要渲染；页面里不能出现 `NaN`、`Infinity`、`undefined`，也不能出现大于 100% 的百分比。
- **无障碍。** 所有可交互元素键盘可达并有 `:focus-visible` 样式；动效尊重 `@media (prefers-reduced-motion: reduce)`；纯图形按钮要有 `aria-label`。
- **布局稳定。** 切换时间范围、粒度、视图时不要让布局跳动，指标卡的数字与环比不能被压缩，第一张卡的数字、趋势各占固定的位置，环比在趋势正上方（卡片窄时让出空间的是趋势）；页面在 1280px、900px、760px 宽度下都要可用。
- **组件生命周期。** 定时器、事件监听要清理；注意 `useEffect` 依赖与过期闭包；不要声明名为 `window` 的局部变量（会遮住全局对象，曾导致更新后 `window.location.reload()` 报错，有测试专门守着）。
- **保持纯函数可测。** 派生数据（占比、分桶、坐标轴、格式化）写成 `factory` 里的顶层函数。测试是按函数名从 `client.js` 源码里切出来求值的
  （`test/helpers/client-source.mjs`）：**改名或内联这些函数会让测试报错，那是在提醒你同步更新测试**，不是测试写坏了。

### 5.3 宿主半区（`index.js`）与缓存版本

- 折叠结构或口径变了（每天 / 每会话记什么、怎么算一步的总量），**必须 bump `index.js` 里的 `CACHE_VERSION`**，并在它上方的注释里补一行说明这个版本改了什么。
  否则旧缓存会让所有用户看到错误数字。
- bump 的后果是「用户升级后首次打开会全量重扫一次」，请在 PR 描述里写明这一点。
- 只改聚合（缓存之后的计算）、不改折叠结构，**不需要** bump（例如修日期加减就不用）。
- 折叠口径的改动和 `CACHE_VERSION` 的 bump 放在**同一个提交**里，并配 `test/fold.test.mjs` / `test/cache.test.mjs` / `test/aggregate.test.mjs` 里的断言。
- 新的纯函数请从 `index.js` 导出，方便测试直接调用（现有函数就是这样做的）；测试需要宿主时用 `test/helpers/fake-host.mjs`，不要依赖真实 DSH。
- 读不了的会话计入 `failedSessions` 并跳过，**绝不猜**。

### 5.4 数据口径

这个页面的价值在于「数字可信」，口径变化是最危险的一类改动。

- **数字只来自日志。** 浏览器半区的数据只来自 `GET /snapshot`；这里只「画」和「派生展示值」，不重新定义「什么算 token」。
- **按日志里的四项原样记，不反推。** 未缓存输入、缓存读、缓存写、输出互不重叠，总量 = 四项之和；不要从总量倒推某一项，也不要靠数字大小猜字段含义。
  某一步的数字自相矛盾时只计数（`usageMismatchCalls`），不去「修正」。
- **计算全程用原始整数，只在渲染时格式化**（`万` / `亿`、一位小数、`<0.1%`）。不要让 `Math.round` / `toFixed` 的结果参与下游计算。
  极小的类别可以有最小可见宽度，但不能把 0.2% 画成 20%。
- **日期是本地时区的日历日。** 日期的加减用日历运算（`shiftDayKey` / `addDays`），**不要用「今天 − n × 86400000 毫秒」**——
  这类写法在夏令时地区会错一天，在 UTC− 时区会让连续天数恒为 1（这两个 bug 都真实发生过，见 FINDINGS 的 A-H2、A-2）。周从周一开始。
- **同一区块内的百分比分母一致**；跨区块口径不同时，要在列头 / 标签里让它们各自自洽。
- 命中率等指标的公式定义在 [`docs/INTERNALS.md`](docs/INTERNALS.md#what-each-number-means)。要改公式，先开 issue。

**改变用户看到的数字的改动**，PR 描述里必须写清：改前显示什么、改后显示什么、依据是什么、同一份数据下**还有哪些区块的数字会跟着变**。
同时更新 `docs/INTERNALS.md` 的对应定义，并在 `FINDINGS.md` 里加一条（沿用现有格式：现象 / 根因 / 修法 / 影响 / 断言 / 级别）。
说不清「改了之后为什么更对」的，就别改，写成 FINDINGS 里的 C 类「只报告」。

### 5.5 隐私与公开内容

这是公开仓库，也是公开的 npm 包。以下内容**不得**出现在代码、注释、文档、测试、预览数据、截图里：

- 你自己的（尤其是公司的）中转站 / 供应商名称与价格、用户名、邮箱、本机绝对路径、API key、token；
- 真实会话日志的片段。

演示 / 预览 / 测试数据只用宿主内置的供应商 id（`deepseek-official`、`deepseek-account`、`deepseek-modlens`）加上自编的中性 id，
模型名用**当前**在售的型号。未知的供应商 id 在界面里就是原样显示，不需要为它写特例。

仓库里没有自动检查这一点（检查本身就会包含那些名字），靠提交者自觉与评审。提交前请把 `git diff` 从头看一遍。

---

## 6. 代码风格

仓库没有 linter / formatter 配置，**跟随现有代码**：

- ESM，2 空格缩进，**不写分号**，字符串用单引号，行尾 LF。
- 注释写「为什么」，不复述「做了什么」；注释语言跟随所在文件（现有注释以中文为主）。同一段不要中英混写。
- 提交里不要夹带无关的格式化改动；`preview/vendor/**` 不要格式化也不要修改。
- 不留 `TODO` / 调试输出 / 注释掉的旧代码 / 永远不成立的分支。
- 用 AI 助手写的代码同样适用以上全部规则，提交者对每一行负责；agent 产生的截图、临时目录（如 `.tmp-shots/`、`.playwright-cli/`）不要提交。

---

## 7. 测试

```bash
npm test                              # = node --test，不需要安装依赖，约 1 秒
TZ=America/Los_Angeles npm test       # 换时区再跑一遍（PowerShell：$env:TZ='America/Los_Angeles'; npm test）
TZ=Asia/Shanghai npm test
```

| 文件 | 覆盖 |
|---|---|
| `test/fold.test.mjs` | 会话日志折叠（单步总量、继承前缀、孤儿前缀…） |
| `test/aggregate.test.mjs` | 折叠结果的聚合（总量、每日、峰值、继承前缀、项目…） |
| `test/cache.test.mjs` | 缓存文件的健壮性（损坏、版本不符…） |
| `test/host.test.mjs` | 路由与更新流程（用假宿主 + 假 registry） |
| `test/client.test.mjs` | 浏览器半区的纯函数（占比、分桶、范围窗口、导出、费用折算…，从 `client.js` 源码切出来求值）与几条源码级守卫 |
| `test/fuzz.test.mjs` | 随机输入（固定种子）下费用折算与日期窗口的不变量；失败时打印种子和场景序号，便于复现 |
| `test/time.test.mjs`、`streak.test.mjs`、`version.test.mjs` | 日期工具、连续天数、版本比较 |

规则：

- **每个 bug 修复配一条测试**，并确认它在修复前会失败。
- **新功能的纯逻辑要有测试**；边界要覆盖：空数据、单条数据、跨月 / 跨年 / 闰日、未来日期、夏令时。
- **不得为了让测试通过而删除或放宽已有断言。** 口径确实变了，就在 PR 里说明并更新断言。
- **时间相关的断言按本地日期构造**（`new Date(y, m, d, …)`），不要写死 UTC 毫秒，否则在 UTC− 时区会挂。
  CI 会在 UTC、`America/Los_Angeles`、`Asia/Shanghai` 三个时区各跑一遍——本地日历类 bug 往往只在 UTC− 时区暴露。
- 测试不依赖网络、真实 DSH 或你本机的会话日志，也不要读写 `$DSH_HOME`（用临时目录）。
- 测试标题描述「期望的行为」，现有标题用中文，沿用即可。
- 视觉上的好坏测试覆盖不了，那部分靠预览页和评审（见下一章）。

---

## 8. 本地预览与 UI 改动

```bash
node tools/preview.mjs            # 起一个只监听 127.0.0.1 的静态服务并打开预览页；加 --no-open 不自动打开
```

也可以直接双击 `preview/index.html`（file:// 下可用）。预览页渲染的就是仓库里这份 `client.js`，改完刷新即可；页面状态保存在 URL hash 里。

预览页能切换：浅色 / 深色、窗口宽度（1280 / 900 / 760）、模型图按月视图、有缓存写入的供应商、空数据 / 首次扫描 / 请求失败状态、语言、更新按钮。

**改了界面的 PR，请：**

- 在预览页里把以上相关状态至少过一遍，**浅色和深色都要看**；
- 在 PR 里附上改动前后的截图（浅色 + 深色）；外观好不好由评审判断，请不要在描述里写「视觉效果已验证」；
- 新增的状态或数据形态，补进 `preview/preview.js` 的假数据与开关（只用 [§5.5](#55-隐私与公开内容) 允许的 id 和型号）；
- 不要重新做整版视觉。曾经有一次「一次改五个变量、无法本地验证」的整体换样式被整版回滚；**分步提交、每一步都能在预览里看到**是硬要求。

README 的截图是从预览页重新截取的；换图时请用**新的文件名**（jsDelivr 会把 `@main` 路径缓存约 12 小时），并且只用预览页的假数据。通常这一步由维护者做。

---

## 9. 文档

文档和代码同等对待，**该改的一起改**：

| 你改了 | 需要同时改 |
|---|---|
| 某个数字的定义或计算方式 | `docs/INTERNALS.md` 的 *What each number means*；如影响用户可见数字，加 `FINDINGS.md` 条目 |
| 路由、写入的文件、对外请求 | `docs/INTERNALS.md` 的 *Data flow* / *Uninstall*；`README.md` 的 Privacy 段；`index.js` 顶部注释 |
| 用户能看到的新功能或新控件 | `README.md` 与 `README.zh.md` 的功能表（**两份保持同步**）；必要时 `docs/INTERNALS.md` |
| 插件的主打功能列表 | `market/description.en.txt` 与 `market/description.zh.txt`（成对改；CI 会把它同步到插件市场） |

注意：

- 面向用户的解释放在 `README` / `docs/INTERNALS.md`，**不要放进界面**（[§5.2](#52-浏览器半区clientjs)）。
- `CHANGELOG.md` 由发布机器人生成，不要手改。
- `market/` 下的其他文件由维护者管理。

---

## 10. 提交信息与 Pull Request

### 10.1 提交信息

格式沿用仓库历史（Conventional Commits 的子集）：

```
<type>(<scope>): <subject>
```

- `type`：`feat`、`fix`、`docs`、`style`、`test`、`chore`、`ci`；也可以用 `refactor`、`perf`。**`release` 保留给发布机器人，不要使用。**
- `scope` 可省略，常见的有 `ui`、`client`、`host`、`readme`、`market`。
- `subject` 用英文，小写开头，不加句号，描述**用户能感知到的变化**，因为它会原样出现在 `CHANGELOG.md` 里。
  - 好：`fix: switching the time range resets the model chart to that range's default granularity`
  - 差：`fix bug`、`update client.js`、`wip`
- **一个提交只做一件事。** 逻辑修复与视觉改动分开；折叠口径改动与 `CACHE_VERSION` bump 在同一个提交里，正文写清为什么必须改宿主半区、升级后是否会全量重扫。
- 正文（可选）写「为什么」和取舍，不要贴大段 diff。
- 不要在提交信息里放 token、个人信息或会话日志片段。

### 10.2 Pull Request

PR 标题遵循上面的格式（squash 合并时它就是最终标题）。描述里请包含：

- **做了什么、为什么**（关联 issue）；
- **怎么验证的**：跑了哪些命令、在哪些时区跑了测试、预览里看了哪些状态；
- **UI 改动**：浅色 / 深色截图；
- **数字改动**：改前 / 改后 / 哪些区块跟着变（[§5.4](#54-数据口径)）；
- **是否 bump 了 `CACHE_VERSION`**，以及它对用户意味着什么；
- **文档是否同步**（[§9](#9-文档)）。

提交前自检清单：

```markdown
- [ ] `node --check index.js && node --check client.js` 通过
- [ ] `npm test` 通过，并且在 `America/Los_Angeles` 与 `Asia/Shanghai` 下也通过
- [ ] 没有新增依赖、没有新增对外请求；`client.js` 里没有硬编码颜色
- [ ] 界面里没有新增解释性文字；EN / ZH 文案成对
- [ ] bug 修复带有先失败的测试；没有删除或放宽已有断言
- [ ] 改了折叠口径的话：已 bump `CACHE_VERSION`，PR 里写明「升级后首次打开会全量重扫」
- [ ] 改了用户可见的数字：PR 里有改前 / 改后；`docs/INTERNALS.md`（及 `FINDINGS.md`）已更新
- [ ] 改了界面：预览页里看过浅色 + 深色、1280 / 900 / 760 宽度、空数据状态，并附了截图
- [ ] README 中英文、`market/description.*.txt` 已按需同步
- [ ] 没有私人信息（供应商名、用户名、本机路径、token）；没有改 `version` / `CHANGELOG.md`
```

---

## 11. 做不熟悉的新功能：先调研

对一个不熟悉的领域（计费、缓存命中率、跨时区日期……），**不要直接从零实现**。先看看别人怎么做：

1. 找 2–4 个同类开源项目：维护活跃（近期有提交 / release、issue 有回应）、许可证明确且与本项目的 MIT 开源 / 闭源分发兼容（MIT、Apache-2.0 等）。
2. 比较：实现思路、依赖成本、已知问题（未关闭的 issue、CHANGELOG 里的 breaking change）。
3. **借鉴经过验证的设计，不复制代码。** 许可证不兼容、技术栈或版本不匹配、来源不明的代码一律不要带进来。
4. 把结论写进 PR 描述或 `FINDINGS.md` 的「设计参考」一节：候选项目 / 许可证与维护状态 / 关键取舍 / 已知问题，以及**明确的决策**——采纳哪个思路、拒绝哪个、为什么。

`FINDINGS.md` 里的「缓存命中率口径」一节就是一份完整的示例。

---

## 12. Issue、安全问题与许可证

**报告 bug** 时请提供：

- 插件版本（`package.json` 的 `version` 或面板里显示的版本）与 DSH 版本；
- 操作系统与**时区**（日历类 bug 常常只在特定时区出现）；
- 你选的时间范围、看到的数字与你预期的数字，以及你是怎么得出预期的；
- 必要时附上快照字段的**节选**（`GET /api/dsh-profile-stats/snapshot`），先去掉路径、用户名和私有的供应商名。**不要贴原始会话日志。**

**安全问题**（例如能读到插件目录之外的文件、数据被意外发送到外部）请不要在公开 issue 里写利用细节，
优先使用仓库 *Security* 页签里的 *Report a vulnerability*；没有这个入口时，开一个只写「有一个想私下沟通的安全问题」的 issue。

**许可证。** 本项目使用 [MIT](LICENSE)。提交 PR 即表示你同意你的贡献以 MIT 许可证发布，并且你有权这样做——
代码是你自己写的，或者来源的许可证与 MIT 兼容并已注明。`preview/vendor/` 下的 React 文件保留它自己的许可证（`LICENSE-react.txt`）。

**交流。** 请友善、就事论事。评审意见针对代码与取舍，不针对人。
