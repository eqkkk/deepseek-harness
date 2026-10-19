/**
 * `discover_bt`: list business tables, then read each matching table.
 * @module @deepseek-ai/dsh-plugin-xu-datakit-ask/tools/discover-bt
 */

import type { Context } from '@deepseek-ai/cordis'
import type { JsonSchemaNode } from '@deepseek-ai/dsh-tools'
import type { AskTransport } from '../client/http.ts'
import { names, tableRecord, tableRecords, type BusinessTableView } from '../client/normalize.ts'
import { listTablesPath, tablePath } from '../client/routes.ts'
import { nonEmptyString } from '../client/types.ts'
import { asJson } from '../json.ts'
import { containsBlockedText } from '../redact.ts'
import { DISCOVER_PARAMETERS } from '../schema.ts'
import { RewriteError } from '../rewrite.ts'
import { registerAskTool } from './define.ts'

/** Services the discover tool needs. */
export interface DiscoverDeps {
  transport: AskTransport
  sampleDomain: string
  timeoutMs: number
}

const OUTPUT: JsonSchemaNode = {
  type: 'object',
  additionalProperties: false,
  required: ['domain', 'tables'],
  properties: {
    domain: { type: 'string' },
    tables: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'name', 'dimensions', 'metrics', 'fields'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          dimensions: { type: 'array', items: { type: 'string' } },
          metrics: { type: 'array', items: { type: 'string' } },
          fields: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
}

/**
 * Register `discover_bt`.
 * @param ctx - registrant context.
 * @param deps - transport and the sample domain named in the description.
 */
export function registerDiscoverBt(ctx: Context, deps: DiscoverDeps): void {
  registerAskTool(ctx, {
    name: 'discover_bt',
    description: 'List discoverable BusinessTables and their dimensions/metrics for a domain. '
      + `Read-only metadata; no secrets. Sample domain id: ${deps.sampleDomain}.`,
    parameters: DISCOVER_PARAMETERS,
    output: OUTPUT,
    timeoutMs: deps.timeoutMs,
    kind: 'search',
    render(value) {
      const body = value as { domain: string; tables: unknown[] }
      return `Discovered ${body.tables.length} business table(s) in domain ${body.domain}.`
    },
    async execute(args, exec) {
      const domain = args.domain as string
      const keyword = typeof args.keyword === 'string' ? args.keyword : undefined
      if (containsBlockedText(domain) || (keyword !== undefined && containsBlockedText(keyword))) {
        throw new RewriteError('Rephrase the question using a business-table name, metric, or filter.')
      }
      const limit = args.limit as number
      const listed = tableRecords(await deps.transport.request('GET', listTablesPath(domain), undefined, exec.signal))
      const tables: BusinessTableView[] = []
      for (const row of listed) {
        const id = nonEmptyString(row.id) ? row.id : undefined
        if (id === undefined) continue
        const listedName = nonEmptyString(row.name) ? row.name : id
        if (!matches(id, listedName, keyword)) continue
        if (tables.length >= limit) break
        const detail = tableRecord(await deps.transport.request('GET', tablePath(id), undefined, exec.signal))
        const name = nonEmptyString(detail.name) ? detail.name : listedName
        tables.push({
          id,
          name,
          dimensions: names(detail.dimensions),
          metrics: names(detail.metrics),
          fields: names(detail.fields),
        })
      }
      return asJson({ domain, tables })
    },
  })
}

function matches(id: string, name: string, keyword: string | undefined): boolean {
  if (keyword === undefined || keyword.trim().length === 0) return true
  const needle = keyword.trim().toLowerCase()
  return id.toLowerCase().includes(needle) || name.toLowerCase().includes(needle)
}
