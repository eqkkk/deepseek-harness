/**
 * Read-only xu-datakit ask tools. The plugin registers four tools and does not
 * open a physical query channel.
 * @module @deepseek-ai/dsh-plugin-xu-datakit-ask
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-tools'
import { createHttpTransport } from './client/http.ts'
import { resolveAskConfig, resolveBaseUrl } from './config.ts'
import { registerAskTools } from './register.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'xu-datakit-ask'

/**
 * Tool registry required before registration. Credentials stay optional:
 * when `ctx.credentials` is absent, the launch environment supplies the token.
 */
export const inject = ['tools']

/** Deployment settings. Blank `baseUrl` falls through to `XU_DATAKIT_BASE_URL`. */
export interface Config {
  /** Origin of the xu-datakit HTTP API. */
  baseUrl?: string
  /** Credential reference resolved per request. Default `XU_DATAKIT_TOKEN`. */
  tokenRef?: string
  /** Platform role the referenced token is expected to have. Default `query`. */
  role?: 'query' | 'ops' | 'admin'
  /** Domain named in the `discover_bt` description. Default `net`. */
  sampleDomain?: string
  /** Send `X-Datakit-Debug: plan` on platform requests. Default false. */
  debugPlan?: boolean
  /** Cooperative tool timeout in milliseconds. Default 30000. */
  timeoutMs?: number
  /** Maximum accepted response body in bytes. Default 1048576. */
  maxResponseBytes?: number
}

export const Config: z<Config> = z.object({
  baseUrl: z.string(),
  tokenRef: z.string().default('XU_DATAKIT_TOKEN'),
  role: z.union(['query', 'ops', 'admin'] as const).default('query'),
  sampleDomain: z.string().default('net'),
  debugPlan: z.boolean().default(false),
  timeoutMs: z.number().default(30_000),
  maxResponseBytes: z.number().default(1_048_576),
})

/**
 * Register the four ask tools. Misconfiguration of role, domain, timeout, or
 * credential name fails here. A missing endpoint or token fails on the next call.
 * @param ctx - registrant context.
 * @param config - plugin config after schemastery defaults.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveAskConfig(config)
  const transport = createHttpTransport({
    resolveBaseUrl: () => resolveBaseUrl(
      resolved.baseUrl,
      launchEnvironmentOf(ctx).get('XU_DATAKIT_BASE_URL')?.value,
    ),
    resolveToken: () => resolveToken(ctx, resolved.tokenRef),
    debugPlan: resolved.debugPlan,
    role: resolved.role,
    maxResponseBytes: resolved.maxResponseBytes,
  })
  registerAskTools(ctx, {
    transport,
    sampleDomain: resolved.sampleDomain,
    timeoutMs: resolved.timeoutMs,
  })
}

/**
 * Read the query credential for one request.
 * A mounted credentials service is authoritative: this function does not
 * continue into the environment when that service has no value.
 * @param ctx - registrant context.
 * @param tokenRef - credential reference name.
 * @returns the token, or undefined when it is unset or blank.
 */
async function resolveToken(ctx: Context, tokenRef: string): Promise<string | undefined> {
  const credentials = ctx.get('credentials')
  if (credentials !== undefined) {
    const hit = await credentials.resolve(credentialRef(tokenRef))
    const value = hit?.value.trim()
    if (value !== undefined && value.length > 0) return value
    return undefined
  }
  const ambient = launchEnvironmentOf(ctx).get(tokenRef)?.value.trim()
  if (ambient !== undefined && ambient.length > 0) return ambient
  return undefined
}
