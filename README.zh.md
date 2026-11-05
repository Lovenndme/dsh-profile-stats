# dsh-profile-stats

在 DSH 侧栏加一个个人用量主页：用了多少 Token、什么时候用的、用的哪个模型、走的哪条计费通道——全部由本机会话日志折叠而来。

[English](README.md) · **简体中文**

![个人主页](https://cdn.jsdelivr.net/gh/Lovenndme/dsh-profile-stats@main/docs/overview.png?v=2)

## 能看到什么

- **五个核心数字**：累计 Token（带近几天迷你柱）、今日用量、最长任务用时、最长连续天数、当前连续天数
- **Token 活动**：近 12 个月日格热力图，可在「每天 / 每周 / 累计总量」之间切换
- **模型分布**：按模型家族堆叠（版本 + 档位分开，`v4-flash` 与 `v4.1-flash` 不会混在一起），窗口可切近 12 天 / 12 周 / 12 个月，自带开关、不受其他区块影响
- **Token 构成（Cache Lens）**：总 Token 与缓存命中率，以及「缓存命中 / 未缓存输入 / 输出」分段占比条，可放大查看非缓存部分的构成
- **供应商分类**：按计费通道拆分，可切今日或累计

![Cache Lens](https://cdn.jsdelivr.net/gh/Lovenndme/dsh-profile-stats@main/docs/mix.png?v=2)

所有数字都来自你自己机器上的会话日志（经 `ctx.sessionQuery` 读取），不猜、不估算。唯一的外发请求是每 6 小时读一次本包在 npm 上的版本号，供面板内的更新按钮使用；不上报数据、不碰凭据。

## 安装

在 DSH 里：**插件 → 添加插件**，粘贴包名：

```
dsh-profile-stats
```

国内没有代理时，先把安装源切到 **中国大陆镜像源**（即 `registry.npmmirror.com`）再装——「发现」页本身挂在 GitHub Pages 上，无代理可能打不开。装好之后完全离线可用。

要求：dsh `>= 0.2.1-rc.5 < 0.3.0`。不依赖其他插件，零运行时依赖。

## 许可

MIT © 2026 Lovenndme

---

口径定义、数据流、联网范围、更新方式与排障细节见 [docs/INTERNALS.md](https://github.com/Lovenndme/dsh-profile-stats/blob/main/docs/INTERNALS.md)。
