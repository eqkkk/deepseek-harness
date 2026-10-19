/**
 * Normalize xu-datakit list, detail, and query payloads into the tool results.
 * Physical-query fields are removed before the value is returned.
 * @module @deepseek-ai/dsh-plugin-xu-datakit-ask/client/normalize
 */

import type { JsonValue } from '@deepseek-ai/dsh-tools'
import { isRecord } from '../json.ts'
import { RewriteError } from '../rewrite.ts'

/** One business table returned by `discover_bt`. */
export interface BusinessTableView {
  id: string
  name: string
  dimensions: string[]
  metrics: string[]
  fields: string[]
}

/** Rows and column names returned by an aggregate or a drilldown. */
export interface TabularResult {
  queryId?: string
  columns: string[]
  rows: JsonValue[]
}

/**
 * Read a business-table list from the envelope `data` field.
 * @param data - envelope `data`.
 * @returns record rows. Non-records are skipped.
 */
export function tableRecords(data: JsonValue): Record<string, unknown>[] {
  if (Array.isArray(data)) return recordsOf(data)
  if (isRecord(data) && Array.isArray(data.tables)) return recordsOf(data.tables)
  if (isRecord(data) && Array.isArray(data.items)) return recordsOf(data.items)
  throw new RewriteError('The data service returned no business-table list. Rephrase the question with a domain such as the sample domain.')
}

function recordsOf(rows: JsonValue[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (const row of rows) {
    if (isRecord(row)) out.push(row)
  }
  return out
}

/**
 * Read one business-table object from a detail payload.
 * @param data - envelope `data`.
 * @returns the table record.
 */
export function tableRecord(data: JsonValue): Record<string, unknown> {
  if (isRecord(data) && isRecord(data.table)) return data.table
  if (isRecord(data)) return data
  throw new RewriteError('The data service returned no business-table detail. Rephrase the question and try again.')
}

/**
 * Collect display names from a string list or a list of `{name|id|code}` objects.
 * @param value - platform field.
 * @returns non-empty names.
 */
export function names(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    if (typeof item === 'string') {
      if (item.length > 0) out.push(item)
      continue
    }
    if (!isRecord(item)) continue
    const candidate = item.name ?? item.id ?? item.code
    if (typeof candidate === 'string' && candidate.length > 0) out.push(candidate)
  }
  return out
}

/**
 * Normalize an aggregate or detail payload.
 * @param data - envelope `data`, already stripped of credential and physical-query text.
 * @param limit - maximum rows to keep.
 * @returns columns, capped rows, and an optional query id.
 */
export function tabularResult(data: JsonValue, limit: number): TabularResult {
  if (Array.isArray(data)) {
    return { columns: columnsFromRows(data), rows: data.slice(0, limit) }
  }
  if (!isRecord(data)) {
    throw new RewriteError('The data service returned no query result. Rephrase the question using known metrics and filters.')
  }
  const rows = arrayField(data, 'rows') ?? arrayField(data, 'records') ?? arrayField(data, 'items')
  if (rows === undefined) {
    throw new RewriteError('The data service returned no rows. Rephrase the question using known metrics and filters.')
  }
  const fromColumns = names(data.columns)
  const fromFields = names(data.fields)
  const columns = fromColumns.length > 0 ? fromColumns : fromFields.length > 0 ? fromFields : columnsFromRows(rows)
  const queryId = stringField(data, 'queryId') ?? stringField(data, 'id')
  return {
    ...queryId === undefined ? {} : { queryId },
    columns,
    rows: rows.slice(0, limit),
  }
}

function columnsFromRows(rows: readonly JsonValue[]): string[] {
  const first = rows[0]
  if (!isRecord(first)) return []
  return Object.keys(first)
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function arrayField(record: Record<string, unknown>, key: string): JsonValue[] | undefined {
  const value = record[key]
  if (!Array.isArray(value)) return undefined
  return value as JsonValue[]
}
