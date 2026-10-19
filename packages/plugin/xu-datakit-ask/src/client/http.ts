/**
 * HTTP client for the xu-datakit `ApiResponse` envelope. Redirects are rejected
 * before a `Location` target is contacted. The credential is sent as a bearer
 * token and is removed from any text this module returns.
 * @module @deepseek-ai/dsh-plugin-xu-datakit-ask/client/http
 */

import type { JsonValue } from '@deepseek-ai/dsh-tools'
import type { ResolvedAskConfig } from '../config.ts'
import { containsBlockedText, redactJson, safeServiceMessage } from '../redact.ts'
import { RewriteError } from '../rewrite.ts'
import { isRecord } from '../json.ts'

/** One platform call. `body` is omitted for GET. */
export interface AskTransport {
  /**
   * Call one documented xu-datakit path.
   * @param method - HTTP method.
   * @param path - origin-relative path, including a query string when needed.
   * @param body - JSON body for POST.
   * @param signal - caller cancellation signal.
   * @returns the envelope `data` value after redaction.
   */
  request(method: 'GET' | 'POST', path: string, body: JsonValue | undefined, signal: AbortSignal): Promise<JsonValue>
}

/** How the plugin resolves the endpoint and credential for each request. */
export interface HttpTransportOptions {
  /** Current base URL, or undefined when it is not configured. */
  resolveBaseUrl(): string | undefined
  /** Current credential value, or undefined when the reference is unset. */
  resolveToken(): Promise<string | undefined>
  /** Send `X-Datakit-Debug: plan` when true. */
  debugPlan: boolean
  /** Role header. The token itself remains the credential. */
  role: ResolvedAskConfig['role']
  /** Maximum response body size in bytes. */
  maxResponseBytes: number
}

/**
 * Build the fetch transport used by every ask tool.
 * @param options - endpoint, credential, and limit resolvers.
 * @returns a transport that unwraps `ApiResponse`.
 */
export function createHttpTransport(options: HttpTransportOptions): AskTransport {
  return {
    request(method, path, body, signal) {
      return perform(options, method, path, body, signal)
    },
  }
}

async function perform(
  options: HttpTransportOptions,
  method: 'GET' | 'POST',
  path: string,
  body: JsonValue | undefined,
  signal: AbortSignal,
): Promise<JsonValue> {
  const baseUrl = options.resolveBaseUrl()
  if (baseUrl === undefined) {
    throw new RewriteError('XU_DATAKIT_BASE_URL is not set. Configure the data service endpoint and ask again.')
  }
  const token = await options.resolveToken()
  if (token === undefined) {
    throw new RewriteError('Credential XU_DATAKIT_TOKEN is not set. Configure a query credential and ask again.')
  }
  let url: URL
  try {
    url = joinUrl(baseUrl, path)
  } catch {
    throw new RewriteError('XU_DATAKIT_BASE_URL is not a valid URL. Correct the endpoint and ask again.')
  }
  if (containsBlockedText(path) || (body !== undefined && containsBlockedText(JSON.stringify(body)))) {
    throw new RewriteError('Rephrase the question using business-table metrics, dimensions, and filters.')
  }
  const headers = new Headers({
    accept: 'application/json',
    authorization: `Bearer ${token}`,
    'x-datakit-role': options.role,
  })
  if (options.debugPlan) headers.set('x-datakit-debug', 'plan')
  if (body !== undefined) headers.set('content-type', 'application/json')
  let response: Response
  let text: string
  try {
    response = await fetch(url, {
      method,
      headers,
      ...body === undefined ? {} : { body: JSON.stringify(body) },
      redirect: 'error',
      signal,
    })
    text = await response.text()
  } catch (error: unknown) {
    if (signal.aborted) throw error
    throw new RewriteError(transportFailureMessage(error))
  }
  if (new TextEncoder().encode(text).byteLength > options.maxResponseBytes) {
    throw new RewriteError('The data service response exceeded the configured size. Narrow the question and ask again.')
  }
  return unwrap(response.ok, text, token)
}

/**
 * Join a base URL and an origin-relative path, keeping a base path prefix.
 * @param baseUrl - configured origin or origin-plus-prefix.
 * @param path - path that does not start with a slash.
 * @returns the absolute URL.
 */
export function joinUrl(baseUrl: string, path: string): URL {
  const base = new URL(baseUrl)
  const prefix = base.href.endsWith('/') ? base.href : `${base.href}/`
  return new URL(path, prefix)
}

function transportFailureMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : ''
  if (/redirect/i.test(raw)) {
    return 'The data service redirected the request. Ask again using the configured endpoint.'
  }
  return 'The data service could not be reached. Check the endpoint and ask again.'
}

function unwrap(ok: boolean, text: string, token: string): JsonValue {
  let payload: unknown
  try {
    payload = JSON.parse(text) as unknown
  } catch {
    throw new RewriteError(ok
      ? 'The data service returned an unreadable response. Rephrase the question and try again.'
      : 'The data service rejected the request. Rephrase the question and try again.')
  }
  if (!isRecord(payload) || payload.success !== true || !ok) {
    throw new RewriteError(failureSuggestion(payload, token))
  }
  if (!Object.hasOwn(payload, 'data')) {
    throw new RewriteError('The data service returned no data. Rephrase the question and try again.')
  }
  return redactJson(JSON.parse(JSON.stringify(payload.data)) as JsonValue, token)
}

function failureSuggestion(payload: unknown, token: string): string {
  const message = isRecord(payload) && typeof payload.message === 'string'
    ? safeServiceMessage(payload.message, token)
    : undefined
  if (message !== undefined) {
    return `The data service could not answer: ${message} Rephrase the question using a known business table, metric, or filter.`
  }
  return 'The data service could not answer. Rephrase the question using a known business table, metric, or filter.'
}
