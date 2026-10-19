# @deepseek-ai/dsh-plugin-xu-datakit-ask

[English](README.md) | 中文

面向单个 Host 的只读 xu-datakit 问数工具。插件在 `ctx.tools` 上注册 `discover_bt`、`semantic_query`、`drilldown` 和 `cite`。`discover_bt` 使用 GET 列表和 GET 详情。`semantic_query` 与 `drilldown` 都 POST `/api/v1/business-tables/{id}/query`。`cite` 在进程内组装审计引用。本包不打开物理 SQL 通道。

## 工具

| 工具 | 平台调用 | 模型收到的结果 |
|---|---|---|
| `discover_bt` | `GET /api/v1/business-tables?domain=`，然后 `GET /api/v1/business-tables/{id}` | `Discovered <n> business table(s) in domain <domain>.` |
| `semantic_query` | `POST /api/v1/business-tables/{id}/query` | `Aggregate result for <id>: <n> row(s).`；平台返回 id 时还有 ` Query id: <queryId>.` |
| `drilldown` | `POST /api/v1/business-tables/{id}/query` | `Drilldown for <id>: <n> row(s).` |
| `cite` | 无 | `Citation: business tables <ids>. Predicates: <predicates>. Query ids: <ids>. Columns: <columns>.`；`note` 为非空字符串时再加 ` Note: <note>.` |

`semantic_query` 提交 `metrics`、`dimensions`、`filters`、`orderBy` 和 `limit`。`drilldown` 提交 `filters`、`columns`、`limit`、`offset`，以及模型提供了 `parentQueryId` 时的该字段。业务表 id 在路径段里。

`semantic_query` 为调用方 agent 记住业务表、过滤条件、列和 query id。`drilldown` 对这份记忆只能执行一次。同一 agent 上一次成功的 `semantic_query` 会替换它。`cite` 把模型给出的 id、谓词和 query id 与这份记忆取并集，并复制记住的列。空的谓词列表、query id 列表或列列表渲染为 `(none)`。

同一 agent 在下一次聚合之前再次调用 `drilldown`，返回 `Error: A drilldown was already returned for this aggregate. Ask a new aggregate question instead of drilling down again.` `parentQueryId` 不在非空的已记住 query id 列表中时，返回 `Error: The drilldown does not match the previous aggregate. Rephrase using the query id from semantic_query.`

## 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `baseUrl` | 未设置 | xu-datakit 源站。空白值被忽略。 |
| `tokenRef` | `XU_DATAKIT_TOKEN` | 每次调用读取的凭证引用。 |
| `role` | `query` | `X-Datakit-Role` 头。取值为 `query`、`ops`、`admin` 之一。 |
| `sampleDomain` | `net` | 写入 `discover_bt` 描述的域 id。 |
| `debugPlan` | `false` | 为 true 时发送 `X-Datakit-Debug: plan`。 |
| `timeoutMs` | `30000` | 协作式工具超时，记在每个工具的 `timeoutMs` 上。 |
| `maxResponseBytes` | `1048576` | 拆开响应信封之前接受的最大响应体字节数。 |

插件加载时检查 `role`、`sampleDomain`、`tokenRef`、`timeoutMs` 和 `maxResponseBytes`。`tokenRef` 必须是凭证引用名。`timeoutMs` 和 `maxResponseBytes` 必须是正整数。`sampleDomain` 去空白后不得为空。

端点在 `baseUrl` 非空白时用该值，否则用启动环境中的 `XU_DATAKIT_BASE_URL`。缺少端点时，下一次工具调用失败，文本为 `Error: XU_DATAKIT_BASE_URL is not set. Configure the data service endpoint and ask again.` 无法解析的端点失败，文本为 `Error: XU_DATAKIT_BASE_URL is not a valid URL. Correct the endpoint and ask again.`

挂载了 `ctx.credentials` 时，它是唯一的令牌来源：对 `tokenRef` 的 `credentials.resolve` 生效，缺失或空白的值不会继续到环境变量。该服务不存在时，使用启动环境里 `tokenRef` 的值。缺失或空白的令牌使调用失败，文本为 `Error: Credential XU_DATAKIT_TOKEN is not set. Configure a query credential and ask again.` 返回文本中的 bearer 值会被去掉。

## 启用

默认 profile 不挂载本插件。把包内 patch，或同一行，插入需要这些工具的 profile：

```yaml
- id: xu-datakit-ask
  name: '@deepseek-ai/dsh-plugin-xu-datakit-ask'
  config:
    tokenRef: XU_DATAKIT_TOKEN
    role: query
    sampleDomain: net
```

把 `XU_DATAKIT_BASE_URL` 设为平台源站。凭证服务存在时通过它提供 `XU_DATAKIT_TOKEN`；该服务未挂载时通过环境变量提供。锁定的示例域是 `net`。

## HTTP 客户端

成功的平台响应体是 `ApiResponse` 信封 `{ success, message?, data }`。仅当 HTTP 状态成功、`success` 为 true 且存在 `data` 时，客户端才拆出 `data`。重定向会被拒绝。路径或请求体含被禁止的查询文本时，在 `fetch` 之前拒绝。响应字符串中的这类文本变成 `[omitted]`。对象键 `sql`、`mql`、`statement`、`querysql` 和 `physicalsql` 会被丢弃。超过 240 个字符、空白或被禁止的服务消息替换为通用失败行。

参数检查在任何 HTTP 调用之前于插件内执行。它强制对象、数组、字符串和整数类型，以及 `required`、`additionalProperties: false`、`enum` 和数值界限 `minimum`、`maximum`、`minItems`。违规是改写建议，前缀为 `Error: Rephrase the question for <tool>:`。

## 导出形式

函数插件：具名导出 `name`、`inject`、`Config` 和 `apply`，没有默认导出。`inject` 为 `['tools']`。`./invariant` 伴生在 `ctx.invariants` 上注册空安装器，因为本包不追加会话事件。包路径、进程内引用记忆和参数关键字的理由见 [xu-datakit 问数工具](../../../.agents/notes/implemented/feature/2026-10-19-xu-datakit-ask-tools.zh.md)。

## Model Experience

### Registered tools

#### What the model sees

已挂载的请求包含四个工具定义。`discover_bt` 为 `List discoverable BusinessTables and their dimensions/metrics for a domain. Read-only metadata; no secrets. Sample domain id: <sampleDomain>.` `semantic_query` 为 `Run a read-only aggregate query against one BusinessTable via xu-datakit. Never emit or execute physical SQL.` `drilldown` 为 `One-shot detail drilldown for a prior semantic_query context. Read-only; no physical SQL.` `cite` 为 `Emit an audit citation for the current answer: BusinessTables and predicates used.`

#### Token effect

插件挂载后，四个定义是每次请求的固定开销。`sampleDomain` 属于 `discover_bt` 定义，因此修改它会改变该定义的大小。

#### KV Cache effect

定义、`sampleDomain` 和工具可见性不变时，前缀保持稳定。加载或卸载插件，或修改 `sampleDomain`，可能使从这些定义开始的复用失效。

### Tool results

#### What the model sees

成功文本是工具表中的四句。空的引用区段渲染为 `(none)`。参数失败和被禁止的查询文本返回 `Error: Rephrase the question for <tool>: …` 或 `Error: Rephrase the question using a business-table name, metric, or filter.` 平台失败返回简短的 `Error:` 行。服务消息里出现的凭证值替换为 `[redacted]`。结果单元格里被禁止的查询文本为 `[omitted]`。

#### Token effect

发现文本是固定句子。聚合与下钻文本随行数增长，`limit` 分别封顶为 500 和 200。引用文本随合并后的 id、谓词、query id、列和可选 `note` 增长。

#### KV Cache effect

只追加。每条结果跟在可复用的请求前缀之后，不替换更早的工具定义。

## Known Limitations and Deferred Work

- **仅可选挂载** — 默认 Headless 与 base profile 不挂载本插件。profile 插入 patch 之后工具才存在。
- **进程内引用记忆** — 最近一次聚合和一次性下钻闩锁保存在内存中，键为 agent id。重启后丢失。本包不追加自己的会话事件。
- **每次聚合只能下钻一次** — 同一 agent 上的第二次 `drilldown` 会被拒绝，直到下一次成功的 `semantic_query` 替换这份记忆。
- **没有物理 SQL 通道** — `discover_bt` 使用两条 GET 业务表路由。`semantic_query` 与 `drilldown` 都 POST `.../query`。`cite` 不调用平台。被禁止的查询文本会被拒绝或省略。
- **凭证文本不进入结果** — bearer 令牌不会复制进工具文本。凭证服务已挂载且引用未设置时，不会回落到环境变量。
