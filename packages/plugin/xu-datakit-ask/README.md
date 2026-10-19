# @deepseek-ai/dsh-plugin-xu-datakit-ask

English | [中文](README.zh.md)

Read-only xu-datakit ask tools for one Host. The plugin registers `discover_bt`, `semantic_query`, `drilldown`, and `cite` on `ctx.tools`. `discover_bt` uses GET list and GET detail. `semantic_query` and `drilldown` both POST `/api/v1/business-tables/{id}/query`. `cite` assembles an audit citation in process. The package opens no physical SQL channel.

## Tools

| Tool | Platform call | Result the model receives |
|---|---|---|
| `discover_bt` | `GET /api/v1/business-tables?domain=` then `GET /api/v1/business-tables/{id}` | `Discovered <n> business table(s) in domain <domain>.` |
| `semantic_query` | `POST /api/v1/business-tables/{id}/query` | `Aggregate result for <id>: <n> row(s).` and, when the platform returns an id, ` Query id: <queryId>.` |
| `drilldown` | `POST /api/v1/business-tables/{id}/query` | `Drilldown for <id>: <n> row(s).` |
| `cite` | none | `Citation: business tables <ids>. Predicates: <predicates>. Query ids: <ids>. Columns: <columns>.` plus ` Note: <note>.` when `note` is a non-empty string. |

`semantic_query` posts `metrics`, `dimensions`, `filters`, `orderBy`, and `limit`. `drilldown` posts `filters`, `columns`, `limit`, `offset`, and `parentQueryId` when the model supplied one. The business table id is the path segment.

`semantic_query` remembers the business table, filters, columns, and query id for the calling agent. `drilldown` may run once for that memory. The next successful `semantic_query` on the same agent replaces it. `cite` unions the model's ids, predicates, and query ids with that memory and copies the remembered columns. An empty predicate list, query-id list, or column list renders as `(none)`.

A second `drilldown` before the next aggregate returns `Error: A drilldown was already returned for this aggregate. Ask a new aggregate question instead of drilling down again.` A `parentQueryId` that is absent from a non-empty remembered query-id list returns `Error: The drilldown does not match the previous aggregate. Rephrase using the query id from semantic_query.`

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `baseUrl` | unset | xu-datakit origin. A blank value is ignored. |
| `tokenRef` | `XU_DATAKIT_TOKEN` | Credential reference read on each call. |
| `role` | `query` | `X-Datakit-Role` header. One of `query`, `ops`, `admin`. |
| `sampleDomain` | `net` | Domain id interpolated into the `discover_bt` description. |
| `debugPlan` | `false` | Send `X-Datakit-Debug: plan` when true. |
| `timeoutMs` | `30000` | Cooperative tool timeout, stored on each tool as `timeoutMs`. |
| `maxResponseBytes` | `1048576` | Largest response body accepted before the envelope is unwrapped. |

`role`, `sampleDomain`, `tokenRef`, `timeoutMs`, and `maxResponseBytes` are checked when the plugin loads. `tokenRef` must be a credential reference name. `timeoutMs` and `maxResponseBytes` must be positive integers. `sampleDomain` must be non-blank after trimming.

The endpoint is `baseUrl` when that value is non-blank, otherwise `XU_DATAKIT_BASE_URL` from the launch environment. A missing endpoint fails the next tool call with `Error: XU_DATAKIT_BASE_URL is not set. Configure the data service endpoint and ask again.` An unparsable endpoint fails with `Error: XU_DATAKIT_BASE_URL is not a valid URL. Correct the endpoint and ask again.`

When `ctx.credentials` is mounted, it is the only token source: `credentials.resolve` on `tokenRef` wins, and a missing or blank value does not continue into the environment. When that service is absent, the launch environment value of `tokenRef` is used. A missing or blank token fails the call with `Error: Credential XU_DATAKIT_TOKEN is not set. Configure a query credential and ask again.` The bearer value is removed from returned text.

## Enablement

Default profiles do not mount this plugin. Insert the package patch, or the same row, into the profile that should see the tools:

```yaml
- id: xu-datakit-ask
  name: '@deepseek-ai/dsh-plugin-xu-datakit-ask'
  config:
    tokenRef: XU_DATAKIT_TOKEN
    role: query
    sampleDomain: net
```

Set `XU_DATAKIT_BASE_URL` to the platform origin. Provide `XU_DATAKIT_TOKEN` through the credentials service, or through the environment when that service is not mounted. The locked sample domain is `net`.

## HTTP client

Successful platform bodies are an `ApiResponse` envelope `{ success, message?, data }`. The client unwraps `data` only when the HTTP status is successful, `success` is true, and `data` is present. Redirects are rejected. Request paths and bodies that contain blocked query text are refused before `fetch`. Response strings that contain that text become `[omitted]`. Object keys `sql`, `mql`, `statement`, `querysql`, and `physicalsql` are dropped. Service messages longer than 240 characters, blank, or blocked are replaced by a generic failure line.

Argument checks run in the plugin before any HTTP call. They enforce object, array, string, and integer types, `required`, `additionalProperties: false`, `enum`, and the numeric bounds `minimum`, `maximum`, and `minItems`. A violation is a rewrite suggestion prefixed with `Error: Rephrase the question for <tool>:`.

## Export shape

A function plugin: named exports `name`, `inject`, `Config`, and `apply`, and no default export. `inject` is `['tools']`. The `./invariant` companion registers an empty installer on `ctx.invariants` because the package appends no session events. Rationale for the package path, the in-memory citation memory, and the parameter keywords: [xu-datakit ask tools](../../../.agents/notes/implemented/feature/2026-10-19-xu-datakit-ask-tools.md).

## Model Experience

### Registered tools

#### What the model sees

Mounted requests include four tool definitions. `discover_bt` is `List discoverable BusinessTables and their dimensions/metrics for a domain. Read-only metadata; no secrets. Sample domain id: <sampleDomain>.` `semantic_query` is `Run a read-only aggregate query against one BusinessTable via xu-datakit. Never emit or execute physical SQL.` `drilldown` is `One-shot detail drilldown for a prior semantic_query context. Read-only; no physical SQL.` `cite` is `Emit an audit citation for the current answer: BusinessTables and predicates used.`

#### Token effect

The four definitions are a fixed cost on every request where the plugin is mounted. `sampleDomain` is part of the `discover_bt` definition, so changing it changes that definition's size.

#### KV Cache effect

Prefix-stable while the definitions, `sampleDomain`, and tool visibility stay unchanged. Loading or unloading the plugin, or changing `sampleDomain`, can invalidate reuse from these definitions.

### Tool results

#### What the model sees

Success text is the four sentences in the tools table. Empty citation sections render `(none)`. Argument failures and blocked query text return `Error: Rephrase the question for <tool>: …` or `Error: Rephrase the question using a business-table name, metric, or filter.` Platform failures return a short `Error:` line. Credential values are replaced with `[redacted]` when they occur in a service message. Blocked query text in a result cell is `[omitted]`.

#### Token effect

Discovery text is a fixed sentence. Aggregate and drilldown text grows with the row count, which `limit` caps at 500 and 200. Citation text grows with the merged ids, predicates, query ids, columns, and optional `note`.

#### KV Cache effect

Append-only. Each result follows the reusable request prefix and does not replace earlier tool definitions.

## Known Limitations and Deferred Work

- **Opt-in only** — default Headless and base profiles do not mount the plugin. A profile inserts the patch before the tools exist.
- **Process-local citation memory** — the last aggregate and the one-shot drilldown latch live in memory, keyed by agent id. A restart drops them. The package appends no session event of its own.
- **One drilldown per aggregate** — a second `drilldown` on the same agent is rejected until the next successful `semantic_query` replaces that memory.
- **No physical SQL channel** — `discover_bt` uses the two GET business-table routes. `semantic_query` and `drilldown` both POST `.../query`. `cite` does not call the platform. Blocked query text is refused or omitted.
- **Credential text stays out of results** — the bearer token is not copied into tool text. A mounted credentials service does not fall through to the environment when the reference is unset.
