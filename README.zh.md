# dsh-profile-stats

在 DSH 侧栏加一个个人用量主页：累计 Token、今日用量、活动热力图、按模型分布、按供应商拆分，全部由本机会话日志折叠而来。

[English](README.md) · **简体中文**

![个人主页](https://cdn.jsdelivr.net/gh/Lovenndme/dsh-profile-stats@main/docs/overview.png)

## 能看到什么

- 累计 Token 数（输入 / 输出 / 缓存命中，环形图）
- 今日 Token 用量、最长任务用时、连续活跃天数
- 近 12 个月活动热力图（每天 / 每周 / 累计总量）
- 按模型分布的柱状图（Flash / Pro）
- 按供应商拆分（今日 / 累计），用来核对网关账单

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
