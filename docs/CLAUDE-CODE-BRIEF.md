# 任务：重制 dsh-profile-stats 的界面（全权执行，视觉自由）

## 0. 你的角色与权限

你是一位资深前端 + 数据可视化设计师 + 代码审查者。

**你拥有全权执行权。** 不需要先出方案等我批准，不需要逐条确认，不需要等我评审代码——直接做，做到你认为对了为止。

**主人只做一件事：打开页面用眼睛验收。** 他不懂你的实现细节，也不会审你的 diff。如果结果不合他意，他会**整版回退**到开工前的备份（回退点见第 9 节），而不是让你改。

所以你的目标很明确：**一次做对，做到他自己看了会想留下来。** 这也意味着：

- 不要交付"看起来能跑"的半成品去等反馈，没有反馈轮次
- 不要留 TODO、不要留"这里以后可以优化"
- 交付前把该验的都验过（见第 7 节），因为你验不了的那部分（视觉）会由他来承担

**明确允许你抛弃现有视觉方案**：现在的配色、间距、卡片样式、图表形态、动效都可以全部推翻，不需要"兼容旧风格"。

---

## 1. 项目是什么

DeepSeek Harness（下称 DSH）是一个本地 AI Agent 桌面应用。插件系统允许第三方插件往界面上"插一块"。

本插件 `dsh-profile-stats` 给它加一个**个人用量主页**：从本机会话日志里统计 token 用量，画成图表，让用户看清"钱花在哪了"。

- 仓库根目录：`dsh-profile-stats/`（当前就在你的工作目录下）
- 主要改的文件：**`client.js`**（浏览器半区，单文件，约 2400 行，含全部组件 + CSS 字符串 + 中英文案）
- 宿主半区是 `index.js`（读日志、聚合、提供快照与三个路由）

### 插件在界面里的位置

- 左侧竖排图标栏（`sidebar.panellist`）里有一个「个人主页」入口
- 点开后，右侧主区（`main` slot，key=`profile`）渲染整页
- 主区可用宽度约 1180px，窗口变窄时会更窄（最小到 ~700px 也要能用）

### 技术形态（外壳必须保持）

```js
window.__ModuleLoader__.load({
  id: 'dsh-profile-stats',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    // ...你的所有组件与样式...
    return { inject: ['slots'], apply }
  },
})
```

- `apply(ctx)` 里用 `ctx.get('slots')` 注册两个 slot（`sidebar.panellist` → 入口按钮，`main` → 页面）
- React 由宿主以 `require('react')` 提供；**不能** `import` 任何包、不能用 npm 依赖、不能用 CDN、不能用 webfont
- 图标一律内联 SVG（`currentColor` 描边）
- 图表自己用 SVG / CSS 画，**不引入图表库**

---

## 2. 硬约束（违反即不合格）

1. **界面数据只来自一个接口**
   `GET /api/dsh-profile-stats/snapshot`。你负责"画"和"派生展示值"（百分比、平均值、分桶求和），不要重新定义"什么算 token"。

2. **颜色必须走主题 token**，不能写死色值。应用有**浅色和深色两套主题**，写死颜色必然在其中一套里瞎掉：

   ```
   --dsw-alias-bg-base, --dsw-alias-bg-layer-1, --dsw-alias-bg-layer-2, --dsw-alias-bg-overlay
   --dsw-alias-border-l1, --dsw-alias-border-l2
   --dsw-alias-label-primary, --dsw-alias-label-secondary
   --dsw-alias-brand-primary
   --dsw-alias-state-success-primary, --dsw-alias-state-warn-primary,
   --dsw-alias-state-error-primary, --dsw-alias-state-idle-primary
   ```
   （需要透明度/混合时用 `color-mix(in srgb, var(--dsw-alias-brand-primary) 55%, transparent)` 这类写法）

3. **界面里不加解释性说明文字**。主人的硬性偏好：UI 只呈现**数据与控件**。不要写"口径说明""提示：…""此图表示…"这类小字。需要解释的写进 README，不进界面。（数据自己的标签、单位、坐标轴刻度、tooltip 当然要，那不叫说明文字。）

4. **零外部请求**。除了这三个同源路由，不要 fetch 任何地址：
   - `GET /api/dsh-profile-stats/snapshot`（读数据）
   - `POST /api/dsh-profile-stats/refresh`（点刷新按钮时）
   - `POST /api/dsh-profile-stats/update`（点更新按钮时，仅在有新版本时出现）

5. **无障碍**：所有交互元素键盘可达、有 `:focus-visible` 样式；动效尊重 `@media (prefers-reduced-motion: reduce)`。

6. **不崩、不空白**：任何数据为空/为 0 时页面要能看，不能抛错、不能让整块消失。

---

## 3. 必须保留的功能（呈现方式你完全自由）

### 3.1 页头
- 头像（首字母或 `identity.avatar`）、用户名、`@handle`
- 刷新按钮（`POST /refresh`）
- 有新版本时出现「更新到 x.y.z」按钮（`POST /update`）

### 3.2 五个核心指标
| 指标 | 来源 |
|---|---|
| 累计 Token 数 | `totals.tokens` |
| 今日 Token 用量 | 今日那天的 `daily[].tokens` |
| 最长任务用时 | `totals.longestTurnMs` |
| 最长连续天数 | `totals.longestStreak` |
| 当前连续天数 | `totals.currentStreak` |

### 3.3 Token 活动（日历热力图）
- 近 12 个月，日格热力图
- 三档口径切换：**每天 / 每周 / 累计总量**
- **切换后必须有肉眼可见的差别**（历史坑：三档都渲染同样 365 格、只改颜色深浅，格子压小后完全看不出变化，等于把功能做没了）
- 悬浮显示"日期 + 用量"，浮层不被视口裁切

### 3.4 模型分布
- **自带「按日 / 按周 / 按月」三档**，窗口各 12 个桶（近 12 天 / 12 周 / 12 个月）
- 这一块**独立**，不受其他控件影响
- 按模型家族堆叠：前 6 个家族各自一段，其余合成「其他模型 (N)」
- 图例给每个家族**自己的用量**；卡片头部给**总计**
- 纵轴整齐刻度（1/2/2.5/5 × 10ⁿ），单位自动 万/亿
- 悬浮给该桶日期 + 各段用量
- 空数据时保留卡片

### 3.5 Token 构成（Cache Lens）
- 两个大数字：
  - **总 Token**（`totals.tokens`）
  - **缓存命中率** = `缓存` ÷ (`缓存` + **未缓存输入**)
    - 未缓存输入必须用 `总Token − 缓存 − 输出` 反推，**不能**直接用 `totals.inputTokens`（不同供应商的 `inputTokens` 语义不一致，实测会多算约 1.6%）
- 横向分段占比条：**缓存命中 / 未缓存输入 / 输出**，宽度 = 各段占**总量**比例，合计 100%
- 三行明细：色块 + 名称 + 用量 + 占**总量**百分比
- 「放大非缓存细分」→ 切到以**非缓存合计**为分母的视图（只含未缓存输入 / 输出），并明示分母变了；可返回
- 悬浮：类型 + 用量 + 占比
- 不得夸大极小类别（可以给最小可见宽度，但**不能把 0.2% 画成 20%**）

### 3.6 供应商分类
- **自带「今日 / 累计」两档**，独立于其他控件
- 每行：可读供应商名（不是原始 id）+ 用量 + 占比 + 进度条
- 空数据时保留卡片

### 3.7 状态与异常
- 首次扫描中：显示进度（`progress.done / progress.total`），不要显示一堆 0
- 无会话：空状态，不是白屏
- 接口失败：错误态 + 重试

---

## 4. 数据契约（不用去读宿主代码，照这个写）

`GET /api/dsh-profile-stats/snapshot` 返回：

```jsonc
{
  "identity": { "name": "Mike", "handle": "@lovenndme", "avatar": "M" },   // avatar 可缺省
  "totals": {
    "tokens": 3330000000,            // 本机日志折叠出的总 token（已去重继承前缀）
    "calls": 12345,
    "inputTokens": 75000000,         // 语义不一致，见 3.5
    "outputTokens": 6900000,
    "cacheReadTokens": 3200000000,
    "cacheWriteTokens": 0,           // 可能为 0
    "sessions": 69,
    "activeDays": 48,
    "firstDay": "2026-08-17",
    "lastDay": "2026-11-04",
    "peakDay": { "date": "2026-10-26", "tokens": 1200000000 },
    "peakStepTokens": 0, "peakStepSession": null,
    "peakSessionTokens": 0, "peakSession": null,
    "longestTurnMs": 3700000,        // 毫秒
    "longestTurnSession": "…",
    "longestStreak": 10,             // 天
    "currentStreak": 10,             // 天
    "tokensWithInherited": 3400000000
  },
  "daily": [
    {
      "date": "2026-11-04",          // 本地日期 YYYY-MM-DD，只包含有活动的天
      "tokens": 16500000,
      "calls": 42,
      "inputTokens": 300000,
      "outputTokens": 41000,
      "cacheTokens": 16000000,       // 当天缓存（read+write）
      "byProvider": { "myapi": 16500000, "wincode": 0 },
      "byModel":    { "deepseek-v4-1-flash": 16500000 }
    }
  ],
  "scanning": false,
  "progress": { "done": 69, "total": 69 },
  "generatedAt": 1762350000000,      // 毫秒时间戳
  "update": { "available": false, "latest": "2.4.11", "installed": "2.4.11" }  // 可缺省
}
```

补充事实：
- `daily` **可能不含某天**（那天空白是正常的，不是 bug）
- `byModel` 的键是**模型家族**（`deepseek-v4-1-flash` / `deepseek-v4-pro` / 其他厂商 id），展示成 `DeepSeek V4.1 Flash` 这类可读名
- `byProvider` 的键是渠道 id（`myapi` / `wincode` / `arkcli-coding-plan` / `deepseek-official` …），映射成可读名，未知的 id 原样显示
- 数值单位：≥1e8 用「亿」，≥1e4 用「万」，1 位小数；**计算全程用原始整数，只在渲染那一步格式化**

---

## 5. 大胆自由的地方

- 整体视觉语言（仪表盘 / 编辑式排版 / 极简数据海报，随你）
- 页面布局与信息层级（哪些并排、哪些整行、要不要侧栏摘要）
- 图表形式（热力图可换呈现方式，只要信息量不减；模型分布可用堆叠柱、堆叠面积、分组条形）
- 动效（入场、切换、数值变化）
- 字体层级、间距节奏、圆角与边框策略
- 深浅两套主题的差异化处理

**底线**：第 3 节功能一个不少、第 2 节约束一条不破、数据不许算错。

---

## 6. 自主探索：找出并修掉没人事先告诉你的问题

除了重做 UI，你还有**第二个任务**：把 `client.js`（必要时连同 `index.js`）当成陌生代码去审，主动找出 bug、逻辑不合理、边界漏洞、死代码、性能问题。

**发现问题你直接修，不必等我确认。** 唯一的纪律是"把改动写清楚、拆得开"（见 6.3）。

### 6.1 重点审查方向（不限于此）

- **统计口径**：同一份数据在不同区块算出不同结果；百分比分母前后不一致；把 `inputTokens` 当"未缓存输入"用
- **取整与精度**：计算链路里出现 `Math.round` / `toFixed` 让下游用舍入值继续算
- **空态与边界**：0 数据、单条数据、未来日期、跨月/跨年、时区（本地日期 vs UTC）、字典序比日期
- **分桶完整性**：日/周/月分桶是否漏掉"没有活动的桶"、周起点、月末跨月错位
- **状态机**：`scanning` 期间刷新、连点刷新、失败重试、`update` 在重装期间的行为
- **组件生命周期**：stale closure、`useEffect` 依赖、定时器未清理、重渲染导致动画重播
- **DOM/样式**：类名漂移、重复 id、`z-index` 打架、浮层被 `overflow` 裁切、窄窗口溢出
- **可访问性**：只能鼠标操作、无 `focus-visible`、缺 `aria-label`
- **死代码**：永不成立的分支、未使用的导出、注释与实现不符

### 6.2 你可以改宿主（`index.js`），但要扛后果

允许修改宿主半区，但必须遵守：

- **单独 commit**，commit message 里写清"为什么必须改宿主"
- 如果改动了聚合结构或口径，**必须同步 bump `CACHE_VERSION`**（否则旧缓存会让所有用户看到错数），并在报告里说明"用户升级后首次打开会全量重扫"
- 不能改 `package.json` 的 `exports` / `dsh` 字段、不能改 `cordis.patch.yml` 的挂载方式
- 改完后 `host-integration.mjs` 必须全绿（可以改它，但只能加断言、增强覆盖，不能删弱）

### 6.3 改动必须可追溯（不是要你等我批准）

- **一个 commit 只做一件事**，逻辑修复与视觉重做分开
- 任何会**改变用户看到数字**的修改，写进 `FINDINGS.md` 的单列条目：改前显示什么、改后显示什么、依据是什么、同一份数据下**哪些区块的数字会跟着变**
- 说不清"改了之后为什么更对"的，就别改，写进 `FINDINGS.md` 的"C 类-只报告"
- 每修一个数据类 bug，配一条断言

---

## 7. 验收标准

### A. 功能验收
- [ ] 页头：头像 / 用户名 / handle / 刷新按钮可用；有新版本时出现更新按钮
- [ ] 5 个指标卡数值与快照一致
- [ ] 热力图覆盖近 12 个月，三档切换**有肉眼可见差异**，悬浮给"日期+用量"
- [ ] 模型分布：日/周/月三档各 12 桶；堆叠正确；图例带各自用量；头部带总计；纵轴整齐
- [ ] Cache Lens：总 Token 正确；命中率 = 缓存 ÷（缓存 + 未缓存输入）；三段宽度合计 ≈ 100%；明细三行齐全；放大/返回可用且分母标注正确
- [ ] 供应商分类：今日/累计两档；名称/用量/占比/进度条齐全
- [ ] 刷新真的重新拉数据；扫描中显示进度；接口失败有错误态

### B. 数据正确性
- [ ] 三段构成相加 **精确等于** 总 Token（误差 0）
- [ ] 页面**不出现 > 100% 的百分比**，不出现 `NaN` / `Infinity` / `undefined`
- [ ] 同一区块内百分比分母一致；跨区块口径不同要能各自自洽
- [ ] 空数据/0 值下**所有卡片仍然渲染**

### C. 技术
- [ ] `node --check client.js`（改了宿主的话 `index.js` 也要）通过
- [ ] **无新增依赖**：`require(...)` 只出现 `react`；无 `import`；无 CDN / webfont
- [ ] `client.js` 里**没有硬编码颜色**（`#rrggbb` / `rgb(` / `hsl(` 一律不允许）
- [ ] 只有那三个同源 fetch，grep 不出别的 URL
- [ ] `window.__ModuleLoader__.load({ id, factory })` 外壳与 `{ inject: ['slots'], apply }` 返回值保持不变
- [ ] `package.json` 的 `exports` / `dsh` 字段与 `cordis.patch.yml` **零改动**
- [ ] 宿主测试 `profile-stats-verify/host-integration.mjs` 全绿

### D. 测试交付
现有 `profile-stats-verify/client-smoke.mjs` 断言的是**当前 DOM 结构与类名**（`.dps-lens-seg`、`.dps-chart-stack` 等）。你重做 UI 后它必然失败，这是预期的。

- [ ] **重写** `client-smoke.mjs`，改为断言**行为**（`data-*` 属性、文案、可查询结构），覆盖 A、B 两组全部条目
- [ ] 重写后全绿
- [ ] 至少 6 条断言覆盖历史回归点：
  1. 三档热力图切换后渲染结果不同
  2. 模型分布空数据时卡片仍在
  3. Cache Lens 放大视图第二个指标用「未缓存输入」做分子（不是缓存）
  4. 计算过程不提前取整（只有渲染层 format）
  5. 供应商卡片空数据时仍在
  6. 三段占比合计 ≈ 100%

### E. 视觉验收由主人做 —— 你必须给他一个能看的入口

**你大概率看不到真实渲染结果，主人也不能把整个 DSH 桌面应用交给你截图。** 所以你的任务不是"替他判断好不好看"，而是**把判断成本降到最低**。

必须交付一个**本地预览页**，让他双击/一条命令就能看到你的设计：

- [ ] 根目录下 `preview/` 或等价位置，提供 `node tools/preview.mjs`（或一个 `.html`）即可打开
- [ ] 预览页用**与插件完全相同的那份 CSS 和同一套组件代码**渲染（不要另写一份"长得像"的假页面），数据用第 4 节的假快照
- [ ] 预览页里能**一键切换**四件事，且都覆盖到：
  1. 浅色 / 深色主题
  2. 宽度 1280px / 900px
  3. 视图：默认态 / 模型分布"按月" / Cache Lens 放大态 / 空数据态
  4. （可选）扫描中 / 错误态
- [ ] 预览页**不依赖插件运行时**：不 fetch 真实接口，数据内置
- [ ] 交付时在报告里写清三行：**怎么打开、看哪几个点、哪些点是你的设计取舍**

> 允许你自验的部分（能查就查）：`node --check`、测试全绿、预览页能构建/无引用错误、grep 约束（无硬编码色、无外部 URL、无新依赖）。**看起来好不好看**这一项由主人负责，你不要替他下结论，也不要写"视觉效果已验证"这种话。

### F. 自主探索验收
- [ ] `FINDINGS.md` 列出所有发现（A 类已修 / B 类已修或说明 / C 类只报告）
- [ ] 每条 A 类有对应断言
- [ ] 没有静默口径变化：任何用户可见数字的变化都能在 `FINDINGS.md` 里追到条目与理由
- [ ] 改过宿主的话，`CACHE_VERSION` 已同步 bump，并在报告里写明"升级后首次打开会全量重扫"
- [ ] 修复 commit 与视觉 commit 分离，能单独回退

---

## 8. 交付物

1. `client.js` 的改动（逻辑修复与视觉重做**分开 commit**）
2. 重写后的 `client-smoke.mjs`
3. **本地预览入口**（第 7-E 节），以及"怎么打开"的一句话说明
4. **`FINDINGS.md`**：发现清单，每条按此格式：

   ```md
   ### [A-1] 模型图"按月"档在跨年时会漏掉一月
   - 现象：2025-12 与 2026-01 显示为同一根柱子
   - 根因：month key 用了 `MM` 而不是 `YYYY-MM`
   - 修法：key 改为 `YYYY-MM`，标签只显示月份
   - 影响：仅影响跨年窗口，历史数据不变
   - 断言：`跨年两个月是两根柱`
   - 级别：A（展示误导）
   ```
5. 一段简短说明：
   - 视觉方向与理由（3–5 句）
   - 哪些地方**改变了信息组织方式**（合并了什么、降级了什么）
   - 哪些地方**有意保留原样**，为什么

---

## 9. 回退点（主人会用它，你不用动）

开工前的状态已备份，若结果不合主人意，他会整版回退，而不是让你迭代：

| 方式 | 位置 |
|---|---|
| git tag | `snapshot/pre-claude-redesign-20261104` |
| git 分支 | `backup/pre-claude-redesign` |
| 物理副本 | `C:\Users\lenovo\Documents\DSH-Workspace\_backup\dsh-profile-stats-20261104\`（client.js / index.js / package.json / CHANGELOG.md / cordis.patch.yml / 两份测试） |

回退命令：`git checkout backup/pre-claude-redesign -- client.js`

**这不代表你可以随意**——恰恰相反：没有评审轮次、没有"再来一版"，你只有一次机会。

---

## 10. 工作方式

1. 直接开始，不要等我批准方案。
2. 分阶段提交：数据管道 → 各区块 → 动效细节；每阶段的 commit 要能单独看懂。
3. 先把**预览入口**做出来（哪怕是半成品），因为那是唯一能被"看见"的东西；再往里填细节。
4. 收尾前自检清单：第 7 节 A–F 逐条过一遍，能自动化的写成断言。
5. 报告里不要写"应该没问题""视觉效果良好"这类无法验证的判断。

> 历史教训：这个界面之前被一次性整体替换过样式层，因为"一次改五个变量 + 无法本地验证"，被整版回滚。**分阶段 + 每阶段可看**是硬要求。
