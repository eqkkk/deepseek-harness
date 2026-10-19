# plugin/ — opt-in Host tool plugins

English | [中文](README.zh.md)

Host-side tool plugins that are not part of the default profile. Each package registers on `ctx.tools` and is mounted by a bundle patch or a profile `cordis.patch.yml`.

| Package | Role | ctx key |
|---|---|---|
| [`xu-datakit-ask/`](xu-datakit-ask/README.md) | Read-only xu-datakit ask tools: discover, aggregate, one drilldown, and citation. | (registers on `ctx.tools`) |

The child README owns configuration, routes, and model-visible text.
