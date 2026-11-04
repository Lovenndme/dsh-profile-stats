# dsh-profile-stats

在 DSH 侧栏加一个个人用量主页：累计 Token、今日用量、活动热力图、按模型分布、按供应商拆分，全部由本机会话日志折叠而来。

[English](README.md) · **简体中文**

![个人主页](https://cdn.jsdelivr.net/gh/Lovenndme/dsh-profile-stats@main/docs/overview.png)

## 能看到什么

- 累计 Token 数（带近 14 天迷你柱）、今日 Token 用量、最长任务用时、连续活跃天数
- 近 12 个月 Token 活动：每天的日格 / 每周合计 / 累计总量
- 模型分布：近 12 天 / 12 周 / 12 个月，按模型家族堆叠
- Token 构成（Cache Lens）：缓存命中率与 缓存 / 未缓存输入 / 输出 三段占比，可放大看非缓存部分
- 按供应商分类（今日 / 累计），用来核对网关账单

## 安装

在插件市场：**插件 → 发现**，搜索 `dsh-profile-stats`。

或直接装：

```
plugin_manager(action: "install_bundle", target: "dsh-profile-stats")
```

要求：dsh `>= 0.2.1-rc.5 < 0.3.0`。不依赖其他插件，零依赖。

## 许可

MIT © 2026 Lovenndme

---

口径定义、数据流、联网范围、更新方式与排障细节见 [docs/INTERNALS.md](https://github.com/Lovenndme/dsh-profile-stats/blob/main/docs/INTERNALS.md)。
