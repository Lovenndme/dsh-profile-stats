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

<img src="https://cdn.jsdelivr.net/gh/Lovenndme/dsh-profile-stats@main/docs/preview.png" alt="DSH 侧栏里的个人用量主页" width="900">

</div>

## 安装

在 DSH 里打开 **插件 → 添加插件**，粘贴包名：

```text
dsh-profile-stats
```

## 能看到什么

| | 区块 | 说明 |
|---|---|---|
| 📊 | **五个核心数字** | 所选范围内的 Token（一周、一个月内带每日用量小柱，累计和更长的自定义范围带 7 日均线，以及与上一周期的对比）、今日用量、最长任务用时、连续天数（附最长纪录）、今日缓存命中率 |
| 🗓️ | **Token 活动** | 近 12 个月日格热力图，可在「每天 / 每周 / 累计总量」之间切换 |
| 🧩 | **模型分布** | 按模型家族堆叠（版本 + 档位分开，`v4-flash` 与 `v4.1-flash` 不会混在一起），不跟页头范围走，自己选按日（最近 7 天）/ 周（最近 4 周）/ 月（最近 6 个月），用量用堆叠柱，占比用饼图（各模型占这段时间总量的比例） |
| 🎯 | **Token 构成（Cache Lens）** | 总 Token 与缓存命中率，以及「缓存命中 / 未缓存输入 / 输出」分段占比条（供应商报了缓存写入时多一段），可放大查看非缓存部分的构成；底部是每日缓存命中率 |
| 💳 | **供应商分类** | 所选范围内按计费通道拆分用量与各家的缓存命中率，可切到只看今天；可以给渠道起个只存在本机的名字 |
| 📁 | **项目** | 所选范围内按工作目录拆分用量，并标出其中子代理会话的占比 |
| 💰 | **花费** | 所选范围的花费与高峰时段占比，供应商、项目各有一列费用。用量按调用时间的官方价折算；每家可以设成官方价、打折、包月或不计入，设置只存在本机 |

页头的时间范围（本日、本周、本月、累计、自定义日期）驱动第一个数字、Token 构成、项目与供应商分类（模型分布有自己的开关，不受它影响）；所选范围可导出为 CSV（每天一行）或 JSON。

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
