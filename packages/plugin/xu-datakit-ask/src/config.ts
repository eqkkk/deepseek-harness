/**
 * Deployment settings for the xu-datakit ask plugin. Defaults are applied here,
 * not inside a tool body.
 * @module @deepseek-ai/dsh-plugin-xu-datakit-ask/config
 */

import { isCredentialRefName } from '@deepseek-ai/dsh-credentials'

/** Fields the Cordis config schema passes to {@link resolveAskConfig}. */
export interface AskConfigInput {
  /** Origin of the xu-datakit HTTP API. Empty falls through to `XU_DATAKIT_BASE_URL`. */
  baseUrl?: string
  /** Credential reference resolved per request. Default `XU_DATAKIT_TOKEN`. */
  tokenRef?: string
  /** Platform role the referenced token is expected to have. */
  role?: string
  /** Domain named in the `discover_bt` description. Default `net`. */
  sampleDomain?: string
  /** Send `X-Datakit-Debug: plan` on platform requests. Default false. */
  debugPlan?: boolean
  /** Cooperative tool timeout in milliseconds. Default 30000. */
  timeoutMs?: number
  /** Maximum accepted response body in bytes. Default 1048576. */
  maxResponseBytes?: number
}

/** Settings after defaults and load-time checks. */
export interface ResolvedAskConfig {
  /** Trimmed base URL, or absent when neither config nor the environment set one. */
  baseUrl?: string
  /** Credential reference name. */
  tokenRef: string
  /** Validated platform role. */
  role: 'query' | 'ops' | 'admin'
  /** Non-empty sample domain. */
  sampleDomain: string
  /** Whether requests ask the platform for a plan header. */
  debugPlan: boolean
  /** Positive integer timeout. */
  timeoutMs: number
  /** Positive integer response cap. */
  maxResponseBytes: number
}

const ROLES = ['query', 'ops', 'admin'] as const

/**
 * Pick the configured base URL, otherwise the environment value.
 * @param configured - `baseUrl` from plugin config.
 * @param envValue - `XU_DATAKIT_BASE_URL` from the launch environment.
 * @returns a trimmed URL, or undefined when both are blank.
 */
export function resolveBaseUrl(configured: string | undefined, envValue: string | undefined): string | undefined {
  const preferred = configured?.trim()
  const picked = preferred !== undefined && preferred.length > 0 ? preferred : envValue?.trim()
  if (picked === undefined || picked.length === 0) return undefined
  return picked
}

/**
 * Apply defaults and reject self-contained misconfiguration.
 * @param config - raw plugin config, before or after schemastery defaults.
 * @returns the settings tool registration uses.
 */
export function resolveAskConfig(config: AskConfigInput): ResolvedAskConfig {
  const role = config.role ?? 'query'
  if (!isRole(role)) throw new Error('xu-datakit-ask: role must be query, ops, or admin')
  const sampleDomain = (config.sampleDomain ?? 'net').trim()
  if (sampleDomain.length === 0) throw new Error('xu-datakit-ask: sampleDomain must be a non-empty string')
  const tokenRef = (config.tokenRef ?? 'XU_DATAKIT_TOKEN').trim()
  if (tokenRef.length === 0) throw new Error('xu-datakit-ask: tokenRef must name a credential')
  if (!isCredentialRefName(tokenRef)) throw new Error('xu-datakit-ask: tokenRef must be a credential reference name')
  const timeoutMs = config.timeoutMs ?? 30_000
  const maxResponseBytes = config.maxResponseBytes ?? 1_048_576
  assertPositiveInteger('timeoutMs', timeoutMs)
  assertPositiveInteger('maxResponseBytes', maxResponseBytes)
  const baseUrl = config.baseUrl?.trim()
  return {
    ...baseUrl === undefined || baseUrl.length === 0 ? {} : { baseUrl },
    tokenRef,
    role,
    sampleDomain,
    debugPlan: config.debugPlan ?? false,
    timeoutMs,
    maxResponseBytes,
  }
}

function isRole(value: string): value is ResolvedAskConfig['role'] {
  return (ROLES as readonly string[]).includes(value)
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`xu-datakit-ask: ${name} must be a positive integer`)
  }
}
