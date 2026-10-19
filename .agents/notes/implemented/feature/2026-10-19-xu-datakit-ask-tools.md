# Agent Note: xu-datakit ask tools

Status: implemented

English | [中文](2026-10-19-xu-datakit-ask-tools.zh.md)

## Problem

Intelligent-ask MVP D1 needs four model-facing tools that discover business tables, run one aggregate, drill into records once, and cite the business tables and predicates used. The platform owns query compilation. The harness checkout that carries this work is `0.1.1-rc.2`. A later tag, `dsh-v0.1.7-rc.2`, exists upstream, and the product sketch named a package path the workspace layout does not allow.

## Decision

`@deepseek-ai/dsh-plugin-xu-datakit-ask` lives at `packages/plugin/xu-datakit-ask`. `plugin/` is a group container with no `package.json`. The package is a function plugin with named exports `name`, `inject`, `Config`, and `apply`, and no default export. It registers `discover_bt`, `semantic_query`, `drilldown`, and `cite` through `ctx.tools.register`.

`discover_bt` calls `GET /api/v1/business-tables` and `GET /api/v1/business-tables/{id}`. `semantic_query` and `drilldown` both call `POST /api/v1/business-tables/{id}/query`. The aggregate body is `metrics`, `dimensions`, `filters`, `orderBy`, and `limit`. The detail body is `filters`, `columns`, `limit`, `offset`, and `parentQueryId` when the model sent one. The business table id is the path segment. `cite` performs no HTTP. The client unwraps an `ApiResponse` envelope and sends the credential as a bearer token with `redirect: 'error'`. `XU_DATAKIT_BASE_URL` supplies the origin when `baseUrl` is blank. `tokenRef` defaults to `XU_DATAKIT_TOKEN`. A mounted `ctx.credentials` service is authoritative.

Parameter objects keep `minimum`, `maximum`, and `minItems` so the model sees the bounds from the tool sketch. `parseArgs` enforces those bounds before HTTP because output validation in `@deepseek-ai/dsh-tools` accepts a smaller JSON Schema subset. Output objects stay inside that subset.

Citation memory is an in-memory map keyed by agent id. `semantic_query` replaces it. `drilldown` may succeed once per replacement. `cite` unions caller arguments with that memory. The package appends no session event. Default Headless and base profiles do not insert `cordis.patch.yml`.

This change stays on the current `master` at `0.1.1-rc.2`. It does not fast-forward to `upstream/master` or `dsh-v0.1.7-rc.2`. `packages/core` is unchanged. Source under the package contains no physical SQL client.

## Alternatives considered

**Fast-forward the tree to `dsh-v0.1.7-rc.2` before the tools.** Declined for this change: the checkout is `0.1.1-rc.2`, and moving the whole workspace to that tag is a repository-wide upgrade with its own conflicts and build risk. `master` stays the upstream-tracking branch. A later upgrade can carry this package forward.

**Use the sketch path `packages/plugin-xu-datakit-ask` and the name `@dsh/plugin-xu-datakit-ask`.** Declined: workspace packages sit at `packages/<group>/<pkg>` and publish as `@deepseek-ai/dsh-*`. A new `plugin/` group holds the package without a group `package.json`.

**Register the tools only through `defineTool`.** Declined: that helper's parameter compiler does not keep `minimum`, `maximum`, and `minItems`. Raw `ctx.tools.register` keeps those keywords on the parameters object, and `parseArgs` enforces them before a platform call.

**Add a session event for citation memory.** Declined: the memory is process-local input to `cite` and `drilldown`. The tool result that reaches the model is the registry result, which the agent loop already logs. A restart loses the latch; that loss is stated on the package README.

**Mount the patch in the default Headless profile.** Declined: the tools need a platform origin and a query credential that default profiles do not have. Opt-in insertion keeps keyless default transcripts unchanged.

**Add one tool that discovers, queries, drills, and cites.** Declined: each operation has its own arguments, route, and failure text. One tool would hide the one-shot drilldown latch and the local citation step.

**Open a physical SQL channel beside the HTTP routes.** Declined: the platform compiles aggregates and record queries. The client refuses or omits blocked query text and never sends a statement to a database driver.

## Consequences

A profile that inserts `@deepseek-ai/dsh-plugin-xu-datakit-ask` exposes the four tools to the CLI agent. Live calls need `XU_DATAKIT_BASE_URL` and a query credential. Contract tests mock the list route, the detail route, and the shared query route, including a drilldown body on that query route, and the local citation step. The suite does not call a live platform, so a missing origin does not skip an assertion.

`packages/core` has no diff from this package. There is no `run` path for physical SQL. Parameter bounds that the harness subset omits are still rejected locally, so an out-of-range `limit` does not reach xu-datakit. Citation memory does not survive a process restart and is not shared across agent ids.

The package is absent from the generated tool catalog because that generator lists `packages/*/tool-*` packages. The README quotes the tool descriptions and result sentences directly. Default profile snapshots do not include these tools.
