/**
 * Platform values the ask tools keep after normalization.
 * @module @deepseek-ai/dsh-plugin-xu-datakit-ask/client/types
 */

/**
 * Whether a platform field is a non-empty string.
 * @param value - a field from a business-table payload.
 * @returns true when the field can be shown as an id or name.
 */
export function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}
