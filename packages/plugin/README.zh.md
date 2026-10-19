# plugin/：可选的 Host 工具插件

[English](README.md) | 中文

不属于默认 profile 的 Host 侧工具插件。每个包都注册到 `ctx.tools`，由组合包 patch 或 profile 的 `cordis.patch.yml` 挂载。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`xu-datakit-ask/`](xu-datakit-ask/README.zh.md) | 只读 xu-datakit 问数工具：发现、聚合、一次下钻与引用。 | （注册到 `ctx.tools`） |

子级 README 负责配置、路由和模型可见文本。
