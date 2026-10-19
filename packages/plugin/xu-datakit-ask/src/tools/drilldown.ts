/**
 * `drilldown`: one detail page for the previous aggregate.
 * @module @deepseek-ai/dsh-plugin-xu-datakit-ask/tools/drilldown
 */

import type { Context } from '@deepseek-ai/cordis'
import type { JsonSchemaNode } from '@deepseek-ai/dsh-tools'
import type { AskTransport } from '../client/http.ts'
import { tabularResult } from '../client/normalize.ts'
import { RECORDS_PATH } from '../client/routes.ts'
import { asJson } from '../json.ts'
import { predicatesOf, rememberDrill, type AskLedger } from '../ledger.ts'
import { DRILLDOWN_PARAMETERS } from '../schema.ts'
import { RewriteError } from '../rewrite.ts'
import { registerAskTool } from './define.ts'
import { FILTER_OUTPUT } from './output.ts'

/** Services the drilldown tool needs. */
export interface DrilldownDeps {
  transport: AskTransport
  timeoutMs: number
  ledgerFor(agentId: string | undefined): AskLedger
}

const OUTPUT: JsonSchemaNode = {
  type: 'object',
  additionalProperties: false,
  required: ['businessTableId', 'columns', 'rows', 'filters'],
  properties: {
    businessTableId: { type: 'string' },
    queryId: { type: 'string' },
    columns: { type: 'array', items: { type: 'string' } },
    rows: { type: 'array' },
    filters: FILTER_OUTPUT,
  },
}

/**
 * Register `drilldown`.
 * @param ctx - registrant context.
 * @param deps - transport and the per-agent citation ledger.
 */
export function registerDrilldown(ctx: Context, deps: DrilldownDeps): void {
  registerAskTool(ctx, {
    name: 'drilldown',
    description: 'One-shot detail drilldown for a prior semantic_query context. Read-only; no physical SQL.',
    parameters: DRILLDOWN_PARAMETERS,
    output: OUTPUT,
    timeoutMs: deps.timeoutMs,
    kind: 'fetch',
    render(value) {
      const body = value as { businessTableId: string; rows: unknown[] }
      return `Drilldown for ${body.businessTableId}: ${body.rows.length} row(s).`
    },
    async execute(args, exec) {
      const ledger = deps.ledgerFor(exec.agent?.id)
      if (ledger.drillUsed) {
        throw new RewriteError('A drilldown was already returned for this aggregate. Ask a new aggregate question instead of drilling down again.')
      }
      const businessTableId = args.businessTableId as string
      const parentQueryId = typeof args.parentQueryId === 'string' ? args.parentQueryId : undefined
      if (parentQueryId !== undefined && ledger.queryIds.length > 0 && !ledger.queryIds.includes(parentQueryId)) {
        throw new RewriteError('The drilldown does not match the previous aggregate. Rephrase using the query id from semantic_query.')
      }
      const filters = predicatesOf(args.filters)
      const columns = Array.isArray(args.columns) ? args.columns as string[] : []
      const limit = args.limit as number
      const offset = args.offset as number
      const data = await deps.transport.request('POST', RECORDS_PATH, asJson({
        businessTableId,
        ...parentQueryId === undefined ? {} : { parentQueryId },
        filters,
        columns,
        limit,
        offset,
      }), exec.signal)
      const table = tabularResult(data, limit)
      rememberDrill(ledger, {
        businessTableId,
        predicates: filters,
        ...table.queryId === undefined ? {} : { queryId: table.queryId },
        columns: table.columns,
      })
      return asJson({
        businessTableId,
        ...table.queryId === undefined ? {} : { queryId: table.queryId },
        columns: table.columns,
        rows: table.rows,
        filters,
      })
    },
  })
}
