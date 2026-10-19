/**
 * xu-datakit HTTP paths used by the ask tools. No other path is requested.
 * @module @deepseek-ai/dsh-plugin-xu-datakit-ask/client/routes
 */

/**
 * List business tables in one domain.
 * @param domain - sample domain id, such as `net`.
 * @returns the path and query relative to the configured origin.
 */
export function listTablesPath(domain: string): string {
  return `api/v1/business-tables?domain=${encodeURIComponent(domain)}`
}

/**
 * Read one business table.
 * @param id - business table id.
 * @returns the path relative to the configured origin.
 */
export function tablePath(id: string): string {
  return `api/v1/business-tables/${encodeURIComponent(id)}`
}

/**
 * Run one business-table query.
 * `semantic_query` posts an aggregate body: `metrics`, `dimensions`, `filters`, `orderBy`, and `limit`.
 * `drilldown` posts a detail body: `filters`, `columns`, `limit`, `offset`, and `parentQueryId` when the model sent one.
 * The business table id is the `{id}` segment. This module does not request a records route.
 * @param id - business table id.
 * @returns the path relative to the configured origin.
 */
export function queryPath(id: string): string {
  return `api/v1/business-tables/${encodeURIComponent(id)}/query`
}
