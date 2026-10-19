/**
 * In-memory citation state for one agent. It is not a session event: the tool
 * results remain the durable record, and this map only lets `cite` repeat the
 * last aggregate and drilldown.
 * @module @deepseek-ai/dsh-plugin-xu-datakit-ask/ledger
 */

import type { JsonValue } from '@deepseek-ai/dsh-tools'

/** One predicate stored for citation. `value` is omitted when the caller did not send one. */
export interface Predicate {
  field: string
  op: string
  value?: JsonValue
}

/** Last aggregate and drilldown for one agent. */
export interface AskLedger {
  businessTableIds: string[]
  predicates: Predicate[]
  queryIds: string[]
  columns: string[]
  drillUsed: boolean
}

/**
 * Empty citation state.
 * @returns a ledger with no aggregate yet.
 */
export function createAskLedger(): AskLedger {
  return { businessTableIds: [], predicates: [], queryIds: [], columns: [], drillUsed: false }
}

/**
 * Map key for the calling agent. Calls with no agent share one ledger.
 * @param agentId - agent id, when the tool call has an owner.
 * @returns the ledger map key.
 */
export function ledgerKey(agentId: string | undefined): string {
  return agentId ?? ''
}

/**
 * Replace the ledger with one successful aggregate. A later drilldown is allowed again.
 * @param ledger - the agent's ledger.
 * @param entry - the aggregate that just succeeded.
 */
export function rememberAggregate(ledger: AskLedger, entry: {
  businessTableId: string
  predicates: Predicate[]
  queryId?: string
  columns: string[]
}): void {
  ledger.businessTableIds = [entry.businessTableId]
  ledger.predicates = entry.predicates
  ledger.queryIds = entry.queryId === undefined ? [] : [entry.queryId]
  ledger.columns = entry.columns
  ledger.drillUsed = false
}

/**
 * Record one successful drilldown. A second drilldown stays blocked until the next aggregate.
 * @param ledger - the agent's ledger.
 * @param entry - the drilldown that just succeeded.
 */
export function rememberDrill(ledger: AskLedger, entry: {
  businessTableId: string
  predicates: Predicate[]
  queryId?: string
  columns: string[]
}): void {
  if (!ledger.businessTableIds.includes(entry.businessTableId)) {
    ledger.businessTableIds.push(entry.businessTableId)
  }
  ledger.predicates = mergePredicates(ledger.predicates, entry.predicates)
  if (entry.queryId !== undefined && !ledger.queryIds.includes(entry.queryId)) {
    ledger.queryIds.push(entry.queryId)
  }
  ledger.columns = entry.columns
  ledger.drillUsed = true
}

/**
 * Append predicates that are not already present.
 * @param current - predicates already cited.
 * @param extra - predicates to add.
 * @returns the union, preserving order.
 */
export function mergePredicates(current: readonly Predicate[], extra: readonly Predicate[]): Predicate[] {
  const out = [...current]
  for (const predicate of extra) {
    const key = predicateKey(predicate)
    if (out.some(item => predicateKey(item) === key)) continue
    out.push({ ...predicate })
  }
  return out
}

/**
 * Append strings that are not already present.
 * @param first - leading ids.
 * @param second - ids to append.
 * @returns the union, preserving order.
 */
export function mergeStrings(first: readonly string[], second: readonly string[]): string[] {
  const out: string[] = []
  for (const item of [...first, ...second]) {
    if (out.includes(item)) continue
    out.push(item)
  }
  return out
}

function predicateKey(predicate: Predicate): string {
  return JSON.stringify([predicate.field, predicate.op, predicate.value ?? null])
}

/**
 * Read predicates from tool arguments that already passed the parameter check.
 * @param value - the `filters` or `predicates` argument, or undefined when omitted.
 * @returns the predicate list.
 */
export function predicatesOf(value: unknown): Predicate[] {
  if (!Array.isArray(value)) return []
  const out: Predicate[] = []
  for (const item of value) {
    const record = item as Predicate
    const predicate: Predicate = { field: record.field, op: record.op }
    if (Object.hasOwn(record, 'value') && record.value !== undefined) predicate.value = record.value
    out.push(predicate)
  }
  return out
}
