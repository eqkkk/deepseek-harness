/**
 * Plain-object test shared by argument checks and response normalization.
 * @module @deepseek-ai/dsh-plugin-xu-datakit-ask/json
 */

import type { JsonValue } from '@deepseek-ai/dsh-tools'

/**
 * Whether a value is a non-null, non-array object.
 * @param value - candidate from arguments or a platform payload.
 * @returns true when the value has string keys.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Copy a tool result through JSON so omitted fields stay absent.
 * @param value - a result assembled from checked arguments and platform JSON.
 * @returns the same data as lossless JSON.
 */
export function asJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}
