# dsh-profile-stats

给 **DeepSeek Harness Web UI**（dsh）加一个个人用量主页。侧栏多出**个人主页**一项，里面是大家真正会问的那些数字。

[English](README.md) · **简体中文**

![个人主页整页](https://cdn.jsdelivr.net/gh/Lovenndme/dsh-profile-stats@main/docs/overview.png)

## 页面里有什么

- **累计 Token 数**：输入 / 输出 / 缓存命中三项的环形图
- **今日 Token 用量**
- **最长任务用时**（`turn/start` → `turn/end` 的最长时段）
- **最长连续 / 当前连续**活跃天数
- **近 12 个月活动热力图**：每天 / 每周 / 累计总量三档，悬浮显示该时间点的日期与用量
- **模型分布**：按时间分桶的柱状图（近 14 天按天、全部按周），按每一步的 `message.source.model` 分成
  Flash 与 Pro 两个系列
- **供应商拆分**（今日 / 累计）：每个 token 走的是哪条计费通道

所有数字都由**本机的会话日志**折叠而来。

## 每个数字的口径

| 卡片 | 定义 |
|---|---|
| 累计 Token 数 | 每条 `assistant/message` 取 `max(totalTokens, input + output)`，全部会话求和。provider 给的 `totalTokens` 本身已含输入+输出+缓存，所以缓存只算一次。 |
| 今日 Token 用量 | 同一个公式，只统计本地日历的"今天"。 |
| 最长任务用时 | `turn/start` 到其 `turn/end` 的最长跨度；没有 `turn/end` 的中断任务不计。 |
| 连续天数 | 活跃日 = 当天至少用了 1 个 token。当前连续到今天为止；今天还没用过则算到昨天。 |
| Token 构成 | 输入 / 输出 / 缓存命中。**输入只算未命中缓存的 prompt**，缓存命中单独计列，两者相加才是完整 prompt。 |
| 模型分布 | 模型名含 `pro` 归 Pro，含 `flash` 归 Flash，其余归其他。所以标着当前模型名的那根柱子，实际聚合了同家族的历史变体。 |
| 供应商拆分 | 每一步的 `data.message.source.provider`，例如 `wincode`、`arkcli-coding-plan`、`myapi`、`deepseek-account`。 |

### 为什么需要「供应商拆分」

中转网关的控制台常把 `输入 + 缓存命中 + 输出` 加起来当"总 Token"。而缓存命中是**输入的子集**，
这样相加等于把缓存算了两次。实测（2026-10-30）某条通道的网关卡片显示 340.15M，而 `输入 + 输出`
是 173.02M；本插件同一通道的数字是 172.21M，差 0.5%（差在扫描时间比网关早几分钟）。**按供应商
分开比，账才对得上。**

## 要求

- 带 Web UI 的 DeepSeek Harness（桌面版或 `dsh web`），**dsh >= 0.2.1-rc.5 < 0.3.0**。
- 不依赖其他插件。浅色 / 深色主题都支持（只用主题 token）。

## 安装

三种方式任选。

**1. 从 npm 装**（想要自动更新或面板内更新就选这个）：

```
plugin_manager(action: "install_bundle", target: "dsh-profile-stats")
```

等价于 `dsh plugin add dsh-profile-stats`。

**2. 直接从仓库装**（不依赖 npm 发布）：

```
plugin_manager(action: "install_bundle", target: "github:Lovenndme/dsh-profile-stats")
```

**3. 从插件市场装**：**插件 → 发现（Discover）**，搜索 `dsh-profile-stats`，点安装。

装完侧栏会出现**个人主页**一行（人像图标）。点开后先用缓存快照立即出图，随后在后台补扫。日志多的话
首次扫描需要一两秒，期间卡片显示 `—` 并给出 `已读/总数` 进度。

## 更新

**面板内按钮。** 如果是从 npm 装的，面板每 6 小时读一次自己在 npm 上的 `latest` 版本，有新版本时页脚
出现 `更新到 x.y.z`。点击后宿主按"移除 → 重装"完成升级，装完页面自动刷新。

**第三方 updater。** 从 registry 装的包也可以交给 `@sueleven/dsh-auto-update` 这类插件：启动时列出
有新版本且已启用的包，确认后通过官方 `dsh plugin add` 通道更新。两条路在桌面版上都需要重启一次。

两个刻意的限制：

- 用 git / tarball / `link:` 安装的一律不显示按钮，registry updater 也会跳过它们——那种情况下的
  "自更新"会改写你的安装方式。想要自动更新就请用 npm 安装。
- **桌面** profile 拒绝 `dsh plugin` 命令（`profile "desktop" is managed exclusively by the Electron
  application`），所以 CLI 系 updater 在桌面版用不了；面板内按钮可以。

**更新失败怎么办**：旧版本已被移除、新版本装不上时，插件会从侧栏消失——重新打开**插件**页装一次
`dsh-profile-stats` 即可。数据不受影响，缓存与 `profile.json` 都在 `$DSH_HOME` 里，与包无关。

## 显示的是谁（名字 / 账号 / 头像）

没有任何硬编码，也不读任何账号：**新装时显示的是你操作系统的账户名**。优先级为：

1. **`$DSH_HOME/dsh-profile-stats/profile.json`** —— 可选，只有你想要别的显示名时才写：

   ```json
   { "name": "你的名字", "handle": "@你的账号", "avatar": "你" }
   ```

   `handle` 省略时会自动补 `@`；`avatar` 省略时取 `name` 首字。该文件每次请求快照都会重读，改完不用
   重启。它在你自己的 `$DSH_HOME` 里，不随包分发，也不在本仓库中。
2. **操作系统账户名**（`os.userInfo().username`），账号为 `@<小写账户名>`。
3. 取不到账户名时兜底为 `DSH 用户` / `@local`。

快照里会给出 `identity.source`（`file` 或 `os`）与 `identity.file`（具体路径），所以永远能判断当前
生效的是哪条规则。

## 数据流与联网范围

宿主半边（`index.js`）：

- `GET  /api/dsh-profile-stats/snapshot` —— 当前快照；`scanning: true` 时带 `progress`
- `POST /api/dsh-profile-stats/refresh` —— 请求后台重扫
- `POST /api/dsh-profile-stats/update` —— 请求面板内升级（仅 registry 安装可用）
- 通过 `ctx.sessionQuery`（`listSessions` / `readSession`）读会话，逐会话折叠后缓存；只有**仍在运行**
  或**从未折叠过**的会话会被重读。
- fork / seed 会话会把来源会话的事件抄在日志头部（`inheritedEventCount`）。这些副本默认不计——除非
  来源会话已不在本机，那时副本是唯一记录，会补算。

客户端半边（`client.js`）注册到 `sidebar.panellist`（id `profile`）与 `main` 槽（key `profile`），
样式只用主题 token，所有可见文案走 locale 服务（`en` / `zh`）。

**唯一的外发请求**是宿主最多每 6 小时发一次 `GET https://registry.npmjs.org/dsh-profile-stats/latest`，
用于判断有没有新版本。不带任何标识、不含任何用量数据，失败则静默。无遥测、无凭据、不上传任何内容；
会话日志从不离开本机。

快照字段：

```
totals:  tokens, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, calls,
         sessions, activeDays, firstDay, lastDay,
         peakDay {date, tokens}, peakStepTokens, peakSessionTokens, longestTurnMs,
         longestStreak, currentStreak, byProvider {}, byModel {}
daily[]: date, tokens, calls, inputTokens, outputTokens, cacheTokens, byProvider {}, byModel {}
update:  installed, latest, available, canUpdate, running, lastResult
```

## 卸载

在**插件**页停用或移除即可。本插件只写这几个文件，都在包外：

```
$DSH_HOME/dsh-profile-stats/cache.json      # 默认 ~/.dsh/dsh-profile-stats/cache.json
$DSH_HOME/dsh-profile-stats/profile.json    # 可选的显示名覆盖
$DSH_HOME/dsh-profile-stats/update.json     # 最近一次面板内升级的结果
```

## 已知边界

- 只统计本机：其他设备、其他工具的用量不会进这些日志。
- 会话进行中数字会动（日志没有固定结尾），相隔几分钟两次扫描会有 1% 以内的漂移。
- 一天按宿主本地时区划分；换机器会改变历史分桶。
- 读不出日志的会话会记入 `failedSessions` 并跳过，不做猜测。
- 模型分类是子串匹配，所以 Pro / Flash 标签描述的是"系列"，不是单个模型 id。

## 开发

- 宿主改动需要新的模块代：用 `plugin_manager` 把 `include:dsh-profile-stats` 关掉再打开，或重启 Harness。
- 客户端改动只需刷新页面。
- `index.js` 只导出 `apply` / `inject`；`client.js` 通过 `window.__ModuleLoader__` 注册。

## 发布（维护者）

```
pwsh tools/release.ps1            # patch 升版本 -> 测试 -> 提交 -> 推送 -> 发布 -> 校验
pwsh tools/release.ps1 minor      # 也可以 minor / major / 指定版本 / none
```

脚本不把凭据写进仓库：它从 `$env:NPM_TOKEN` 或 `$HOME/.dsh/.npm-publish-token` 读取一个 granular npm
token（bypass 2FA，仅本包读写）。

## 许可

MIT © 2026 Lovenndme
