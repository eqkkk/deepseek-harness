/**
 * `semantic_query`: one read-only aggregate against a business table.
 * @module @deepseek-ai/dsh-plugin-xu-datakit-ask/tools/semantic-query
 */

import type { Context } from '@deepseek-ai/cordis'
import type { JsonSchemaNode } from '@deepseek-ai/dsh-tools'
import type { AskTransport } from '../client/http.ts'
import { tabularResult } from '../client/normalize.ts'
import { queryPath } from '../client/routes.ts'
import { asJson } from '../json.ts'
import { rememberAggregate, predicatesOf, type AskLedger } from '../ledger.ts'
import { SEMANTIC_PARAMETERS } from '../schema.ts'
import { registerAskTool } from './define.ts'
import { FILTER_OUTPUT } from './output.ts'

/** Services the aggregate tool needs. */
export interface SemanticDeps {
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
 * Register `semantic_query`.
 * @param ctx - registrant context.
 * @param deps - transport and the per-agent citation ledger.
 */
export function registerSemanticQuery(ctx: Context, deps: SemanticDeps): void {
  registerAskTool(ctx, {
    name: 'semantic_query',
    description: 'Run a read-only aggregate query against one BusinessTable via xu-datakit. Never emit or execute physical SQL.',
    parameters: SEMANTIC_PARAMETERS,
    output: OUTPUT,
    timeoutMs: deps.timeoutMs,
    kind: 'fetch',
    render(value) {
      const body = value as { businessTableId: string; rows: unknown[]; queryId?: string }
      const query = body.queryId === undefined ? '' : ` Query id: ${body.queryId}.`
      return `Aggregate result for ${body.businessTableId}: ${body.rows.length} row(s).${query}`
    },
    async execute(args, exec) {
      const businessTableId = args.businessTableId as string
      const metrics = args.metrics as string[]
      const dimensions = Array.isArray(args.dimensions) ? args.dimensions as string[] : []
      const filters = predicatesOf(args.filters)
      const orderBy = orderByOf(args.orderBy)
      const limit = args.limit as number
      const data = await deps.transport.request('POST', queryPath(businessTableId), asJson({
        metrics,
        dimensions,
        filters,
        orderBy,
        limit,
      }), exec.signal)
      const table = tabularResult(data, limit)
      rememberAggregate(deps.ledgerFor(exec.agent?.id), {
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

function orderByOf(value: unknown): { field: string; dir: string }[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    const record = item as { field: string; dir: string }
    return { field: record.field, dir: record.dir }
  })
}
