# Agent Note: xu-datakit 问数工具

Status: implemented

[English](2026-10-19-xu-datakit-ask-tools.md) | 中文

## 问题

智能问数 MVP D1 需要四个面向模型的工具：发现业务表、执行一次聚合、对记录下钻一次，并引用用到的业务表和谓词。查询编译属于平台。承载这项工作的 harness 检出是 `0.1.1-rc.2`。上游另有更晚的标签 `dsh-v0.1.7-rc.2`，产品草图使用的包路径也不被工作区布局接受。

## 决定

`@deepseek-ai/dsh-plugin-xu-datakit-ask` 位于 `packages/plugin/xu-datakit-ask`。`plugin/` 是没有 `package.json` 的分组容器。该包是函数插件，具名导出 `name`、`inject`、`Config` 和 `apply`，没有默认导出。它通过 `ctx.tools.register` 注册 `discover_bt`、`semantic_query`、`drilldown` 和 `cite`。

`discover_bt` 调用 `GET /api/v1/business-tables` 和 `GET /api/v1/business-tables/{id}`。`semantic_query` 与 `drilldown` 都调用 `POST /api/v1/business-tables/{id}/query`。聚合请求体是 `metrics`、`dimensions`、`filters`、`orderBy` 和 `limit`。明细请求体是 `filters`、`columns`、`limit`、`offset`，以及模型提供了 `parentQueryId` 时的该字段。业务表 id 在路径段里。`cite` 不发起 HTTP。客户端拆开 `ApiResponse` 信封，以 bearer 令牌发送凭证，并使用 `redirect: 'error'`。`baseUrl` 为空白时，由 `XU_DATAKIT_BASE_URL` 提供源站。`tokenRef` 默认为 `XU_DATAKIT_TOKEN`。已挂载的 `ctx.credentials` 服务具有决定权。

参数对象保留 `minimum`、`maximum` 和 `minItems`，使模型看到工具草图中的界限。`parseArgs` 在 HTTP 之前强制这些界限，因为 `@deepseek-ai/dsh-tools` 的输出校验只接受更小的 JSON Schema 子集。输出对象留在该子集内。

引用记忆是以 agent id 为键的内存映射。`semantic_query` 替换它。每次替换后 `drilldown` 可以成功一次。`cite` 把调用方参数与这份记忆取并集。本包不追加会话事件。默认 Headless 与 base profile 不插入 `cordis.patch.yml`。

这项改动留在当前 `master` 的 `0.1.1-rc.2`。它不快进到 `upstream/master` 或 `dsh-v0.1.7-rc.2`。`packages/core` 没有改动。包内源码不包含物理 SQL 客户端。

## 考虑过的替代方案

**在加入工具之前把整棵树快进到 `dsh-v0.1.7-rc.2`。** 这次改动未采用：检出是 `0.1.1-rc.2`，把整个工作区移到该标签是一次带有冲突和构建风险的仓库级升级。`master` 仍是跟踪上游的分支。以后的升级可以把这个包带过去。

**使用草图路径 `packages/plugin-xu-datakit-ask` 和名称 `@dsh/plugin-xu-datakit-ask`。** 未采用：工作区包位于 `packages/<group>/<pkg>`，发布名为 `@deepseek-ai/dsh-*`。新建的 `plugin/` 分组容纳该包，分组本身没有 `package.json`。

**只通过 `defineTool` 注册工具。** 未采用：该辅助函数的参数编译器不保留 `minimum`、`maximum` 和 `minItems`。直接 `ctx.tools.register` 把这些关键字留在参数对象上，`parseArgs` 在平台调用之前强制它们。

**为引用记忆增加会话事件。** 未采用：这份记忆是 `cite` 和 `drilldown` 的进程内输入。到达模型的工具结果是注册表结果，agent loop 已经记录它。重启会丢失闩锁；这一损失写在包 README 上。

**把 patch 挂进默认 Headless profile。** 未采用：这些工具需要平台源站和查询凭证，默认 profile 没有。可选插入使无密钥的默认记录保持不变。

**用一个工具完成发现、查询、下钻和引用。** 未采用：每个操作有自己的参数、路由和失败文本。一个工具会藏起一次性下钻闩锁和本地引用步骤。

**在 HTTP 路由旁边打开物理 SQL 通道。** 未采用：平台编译聚合和记录查询。客户端拒绝或省略被禁止的查询文本，并且不向数据库驱动发送语句。

## 后果

插入 `@deepseek-ai/dsh-plugin-xu-datakit-ask` 的 profile 会把四个工具暴露给 CLI agent。真实调用需要 `XU_DATAKIT_BASE_URL` 和查询凭证。契约测试模拟列表路由、详情路由和共用的 query 路由，包括该 query 路由上的下钻请求体，以及本地引用步骤。套件不调用真实平台，因此源站缺失时没有被跳过的断言。

这个包没有给 `packages/core` 带来 diff。没有物理 SQL 的 `run` 路径。harness 子集省略的参数界限仍在本地被拒绝，因此超范围的 `limit` 不会到达 xu-datakit。引用记忆不能在进程重启后保留，也不在 agent id 之间共享。

生成的工具目录不包含本包，因为生成器列出的是 `packages/*/tool-*`。README 直接引用工具描述和结果句子。默认 profile 快照不包含这些工具。
