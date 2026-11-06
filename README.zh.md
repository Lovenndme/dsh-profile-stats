<div align="center">

<h1>dsh-profile-stats</h1>

<p><b>DSH 侧栏里的个人用量主页。</b><br>
用了多少 Token、什么时候用的、用的哪个模型、走的哪条计费通道——<br>
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

<img src="https://cdn.jsdelivr.net/gh/Lovenndme/dsh-profile-stats@main/docs/overview.png?v=2" alt="DSH 侧栏里的个人用量主页" width="900">

</div>

[安装](#安装) · [截图](#截图) · [能看到什么](#能看到什么) · [隐私](#隐私) · [环境要求](#环境要求) · [内部实现](docs/INTERNALS.md)

## 安装

在 DSH 里打开 **插件 → 添加插件**，粘贴包名：

```text
dsh-profile-stats
```

国内没有代理时，先把安装源切到 **中国大陆镜像源**（即 `registry.npmmirror.com`）再装——「发现」页本身挂在 GitHub Pages 上，无代理可能打不开。装好之后完全离线可用。

## 截图

<table>
  <tr>
    <td align="center" width="33%"><img src="https://cdn.jsdelivr.net/gh/Lovenndme/dsh-profile-stats@main/docs/heatmap.png?v=2" alt="Token 活动热力图"><br><sub><b>Token 活动</b><br>近 12 个月，每天 / 每周 / 累计总量</sub></td>
    <td align="center" width="33%"><img src="https://cdn.jsdelivr.net/gh/Lovenndme/dsh-profile-stats@main/docs/model-chart.png?v=2" alt="模型分布"><br><sub><b>模型分布</b><br>按模型家族与档位堆叠</sub></td>
    <td align="center" width="33%"><img src="https://cdn.jsdelivr.net/gh/Lovenndme/dsh-profile-stats@main/docs/mix.png?v=2" alt="Token 构成（Cache Lens）"><br><sub><b>Cache Lens</b><br>缓存命中 / 未缓存输入 / 输出</sub></td>
  </tr>
</table>

## 能看到什么

| | 区块 | 说明 |
|---|---|---|
| 📊 | **五个核心数字** | 累计 Token（带近几天迷你柱）、今日用量、最长任务用时、最长连续天数、当前连续天数 |
| 🗓️ | **Token 活动** | 近 12 个月日格热力图，可在「每天 / 每周 / 累计总量」之间切换 |
| 🧩 | **模型分布** | 按模型家族堆叠（版本 + 档位分开，`v4-flash` 与 `v4.1-flash` 不会混在一起），窗口可切近 12 天 / 12 周 / 12 个月，自带开关、不受其他区块影响 |
| 🎯 | **Token 构成（Cache Lens）** | 总 Token 与缓存命中率，以及「缓存命中 / 未缓存输入 / 输出」分段占比条，可放大查看非缓存部分的构成 |
| 💳 | **供应商分类** | 按计费通道拆分，可切今日或累计 |

页面级时间范围（全部 / 今日 / 7 天 / 30 天）驱动上述用量数字。

## 隐私

> [!NOTE]
> 所有数字都来自你自己机器上的会话日志（经 `ctx.sessionQuery` 读取），不猜、不估算。唯一的外发请求是每 6 小时读一次本包在 npm 上的版本号，供面板内的更新按钮使用；不上报数据、不碰凭据。

## 环境要求

| 项 | 要求 |
|---|---|
| dsh | `>= 0.2.1-rc.5 < 0.3.0`（已在 `0.2.1-rc.5` 上验证） |
| 其他插件 | 无 |
| 运行时依赖 | 零 |

## 许可

MIT © 2026 Lovenndme

---

口径定义、数据流、联网范围、更新方式与排障细节见 [docs/INTERNALS.md](docs/INTERNALS.md)。
