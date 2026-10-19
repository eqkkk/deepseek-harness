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
 * Run one semantic aggregate.
 * @param id - business table id.
 * @returns the path relative to the configured origin.
 */
export function queryPath(id: string): string {
  return `api/v1/business-tables/${encodeURIComponent(id)}/query`
}

/** Detail-record query path. */
export const RECORDS_PATH = 'api/v1/records/query'
