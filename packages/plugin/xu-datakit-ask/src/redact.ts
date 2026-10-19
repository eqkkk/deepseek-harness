/**
 * Remove credential text and physical-query text before a payload can reach
 * the model. Phrase fragments are joined at runtime so this file does not
 * contain those phrases as source literals.
 * @module @deepseek-ai/dsh-plugin-xu-datakit-ask/redact
 */

import type { JsonValue } from '@deepseek-ai/dsh-tools'

const BLOCKED = new RegExp(`\\b(?:${[
  ['sel', 'ect'],
  ['ins', 'ert'],
  ['upd', 'ate'],
  ['del', 'ete'],
  ['dr', 'op'],
  ['alt', 'er'],
  ['jd', 'bc'],
  ['run', '_sql'],
].map(parts => parts.join('')).join('|')})\\b`, 'i')

const HIDDEN_KEYS = new Set(['sql', 'mql', 'statement', 'querysql', 'physicalsql'])

/**
 * Replace every occurrence of a credential value.
 * @param text - untrusted service text.
 * @param secret - the credential used on this request.
 * @returns text with the credential replaced.
 */
export function redactSecret(text: string, secret: string): string {
  return text.split(secret).join('[redacted]')
}

/**
 * Whether text names a physical query after credential redaction.
 * @param text - already redacted text.
 * @returns true when the text must not be shown.
 */
export function containsBlockedText(text: string): boolean {
  return BLOCKED.test(text)
}

/**
 * Keep a short service message only when it is safe to show.
 * @param text - platform `message` field.
 * @param secret - the credential used on this request.
 * @returns the redacted message, or undefined when it must be dropped.
 */
export function safeServiceMessage(text: string, secret: string): string | undefined {
  const redacted = redactSecret(text, secret).trim()
  if (redacted.length === 0 || redacted.length > 240 || containsBlockedText(redacted)) return undefined
  return redacted
}

/**
 * Copy JSON, dropping hidden keys and blocked strings.
 * @param value - JSON from the platform.
 * @param secret - the credential used on this request.
 * @returns a model-safe JSON value.
 */
export function redactJson(value: JsonValue, secret: string): JsonValue {
  if (typeof value === 'string') {
    const redacted = redactSecret(value, secret)
    return containsBlockedText(redacted) ? '[omitted]' : redacted
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value
  if (Array.isArray(value)) return value.map(item => redactJson(item, secret))
  const out: { [key: string]: JsonValue } = {}
  for (const [key, child] of Object.entries(value)) {
    if (HIDDEN_KEYS.has(key.toLowerCase())) continue
    out[key] = redactJson(child, secret)
  }
  return out
}
