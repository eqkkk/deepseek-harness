/**
 * `cite`: assemble an audit citation from the call and the last query response.
 * This tool does not call xu-datakit.
 * @module @deepseek-ai/dsh-plugin-xu-datakit-ask/tools/cite
 */

import type { Context } from '@deepseek-ai/cordis'
import type { JsonSchemaNode } from '@deepseek-ai/dsh-tools'
import { asJson } from '../json.ts'
import {
  mergePredicates,
  mergeStrings,
  predicatesOf,
  type AskLedger,
  type Predicate,
} from '../ledger.ts'
import { CITE_PARAMETERS } from '../schema.ts'
import { registerAskTool } from './define.ts'

/** The citation tool only reads the in-memory ledger. */
export interface CiteDeps {
  timeoutMs: number
  ledgerFor(agentId: string | undefined): AskLedger
}

const OUTPUT: JsonSchemaNode = {
  type: 'object',
  additionalProperties: false,
  required: ['businessTableIds', 'predicates', 'queryIds', 'columns'],
  properties: {
    businessTableIds: { type: 'array', items: { type: 'string' } },
    predicates: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['field', 'op'],
        properties: {
          field: { type: 'string' },
          op: { type: 'string' },
          value: {},
        },
      },
    },
    queryIds: { type: 'array', items: { type: 'string' } },
    columns: { type: 'array', items: { type: 'string' } },
    note: { type: 'string' },
  },
}

/**
 * Register `cite`.
 * @param ctx - registrant context.
 * @param deps - the per-agent citation ledger.
 */
export function registerCite(ctx: Context, deps: CiteDeps): void {
  registerAskTool(ctx, {
    name: 'cite',
    description: 'Emit an audit citation for the current answer: BusinessTables and predicates used.',
    parameters: CITE_PARAMETERS,
    output: OUTPUT,
    timeoutMs: deps.timeoutMs,
    kind: 'other',
    render(value) {
      const body = value as unknown as {
        businessTableIds: string[]
        predicates: Predicate[]
        queryIds: string[]
        columns: string[]
        note?: string
      }
      const predicates = body.predicates.map((predicate) => {
        if (predicate.value === undefined) return `${predicate.field} ${predicate.op}`
        return `${predicate.field} ${predicate.op} ${JSON.stringify(predicate.value)}`
      }).join('; ')
      const note = body.note === undefined || body.note.length === 0
        ? ''
        : ` Note: ${body.note}.`
      return `Citation: business tables ${body.businessTableIds.join(', ')}. `
        + `Predicates: ${predicates.length === 0 ? '(none)' : predicates}. `
        + `Query ids: ${body.queryIds.length === 0 ? '(none)' : body.queryIds.join(', ')}. `
        + `Columns: ${body.columns.length === 0 ? '(none)' : body.columns.join(', ')}.${note}`
    },
    execute(args, exec) {
      const ledger = deps.ledgerFor(exec.agent?.id)
      const note = typeof args.note === 'string' ? args.note : undefined
      const predicates = mergePredicates(predicatesOf(args.predicates), ledger.predicates)
      const result = asJson({
        businessTableIds: mergeStrings(args.businessTableIds as string[], ledger.businessTableIds),
        predicates,
        queryIds: mergeStrings(stringList(args.queryIds), ledger.queryIds),
        columns: [...ledger.columns],
        ...note === undefined ? {} : { note },
      })
      return Promise.resolve(result)
    },
  })
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value as string[]
}
