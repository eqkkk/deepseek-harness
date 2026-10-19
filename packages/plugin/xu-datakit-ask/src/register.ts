/**
 * Register the four ask tools on one host. Each tool stays a separate
 * registration; this module only shares the transport and the citation ledger.
 * @module @deepseek-ai/dsh-plugin-xu-datakit-ask/register
 */

import type { Context } from '@deepseek-ai/cordis'
import type { AskTransport } from './client/http.ts'
import { createAskLedger, ledgerKey, type AskLedger } from './ledger.ts'
import { registerCite } from './tools/cite.ts'
import { registerDiscoverBt } from './tools/discover-bt.ts'
import { registerDrilldown } from './tools/drilldown.ts'
import { registerSemanticQuery } from './tools/semantic-query.ts'

/** Services shared by the four registrations. */
export interface AskRegistration {
  transport: AskTransport
  /** Domain named in the `discover_bt` description. */
  sampleDomain: string
  /** Cooperative timeout attached to every tool. */
  timeoutMs: number
}

/**
 * Register `discover_bt`, `semantic_query`, `drilldown`, and `cite`.
 * @param ctx - registrant context. `ctx.tools` must already be present.
 * @param options - transport and deployment settings.
 */
export function registerAskTools(ctx: Context, options: AskRegistration): void {
  const ledgers = new Map<string, AskLedger>()
  const ledgerFor = (agentId: string | undefined): AskLedger => {
    const key = ledgerKey(agentId)
    const existing = ledgers.get(key)
    if (existing !== undefined) return existing
    const created = createAskLedger()
    ledgers.set(key, created)
    return created
  }
  registerDiscoverBt(ctx, {
    transport: options.transport,
    sampleDomain: options.sampleDomain,
    timeoutMs: options.timeoutMs,
  })
  registerSemanticQuery(ctx, {
    transport: options.transport,
    timeoutMs: options.timeoutMs,
    ledgerFor,
  })
  registerDrilldown(ctx, {
    transport: options.transport,
    timeoutMs: options.timeoutMs,
    ledgerFor,
  })
  registerCite(ctx, {
    timeoutMs: options.timeoutMs,
    ledgerFor,
  })
}
