/**
 * Argument schema nodes for the four ask tools, plus defaulting and checks
 * the harness parameter compiler does not apply (`minimum`, `maximum`,
 * `minItems`, and a closed parameter root).
 * @module @deepseek-ai/dsh-plugin-xu-datakit-ask/schema
 */

import { isRecord } from './json.ts'
import { RewriteError } from './rewrite.ts'

/** One JSON Schema node stored on a tool and checked before a platform call. */
export interface SchemaNode {
  type?: 'object' | 'array' | 'string' | 'integer'
  description?: string
  properties?: Record<string, SchemaNode>
  required?: string[]
  additionalProperties?: boolean
  items?: SchemaNode
  enum?: string[]
  minimum?: number
  maximum?: number
  minItems?: number
  default?: string | number
}

const FILTER: SchemaNode = {
  type: 'object',
  additionalProperties: false,
  properties: {
    field: { type: 'string' },
    op: {
      type: 'string',
      enum: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'like', 'between'],
    },
    value: {},
  },
  required: ['field', 'op', 'value'],
}

const OPEN_FILTER: SchemaNode = {
  type: 'object',
  properties: {
    field: { type: 'string' },
    op: { type: 'string' },
    value: {},
  },
  required: ['field', 'op', 'value'],
}

const CITATION_PREDICATE: SchemaNode = {
  type: 'object',
  properties: {
    field: { type: 'string' },
    op: { type: 'string' },
    value: {},
  },
  required: ['field', 'op'],
}

/** Model-facing parameters for `discover_bt`. */
export const DISCOVER_PARAMETERS: SchemaNode = {
  type: 'object',
  additionalProperties: false,
  properties: {
    domain: {
      type: 'string',
      description: 'Sample domain id, e.g. nat_log or net',
    },
    keyword: {
      type: 'string',
      description: 'Optional name/keyword filter',
    },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: 100,
      default: 20,
    },
  },
  required: ['domain'],
}

/** Model-facing parameters for `semantic_query`. */
export const SEMANTIC_PARAMETERS: SchemaNode = {
  type: 'object',
  additionalProperties: false,
  properties: {
    businessTableId: { type: 'string' },
    metrics: {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
    },
    dimensions: {
      type: 'array',
      items: { type: 'string' },
    },
    filters: {
      type: 'array',
      description: 'Semantic predicates (field, op, value); compiled by platform',
      items: FILTER,
    },
    orderBy: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          field: { type: 'string' },
          dir: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
        },
        required: ['field'],
      },
    },
    limit: { type: 'integer', minimum: 1, maximum: 500, default: 50 },
  },
  required: ['businessTableId', 'metrics'],
}

/** Model-facing parameters for `drilldown`. */
export const DRILLDOWN_PARAMETERS: SchemaNode = {
  type: 'object',
  additionalProperties: false,
  properties: {
    businessTableId: { type: 'string' },
    parentQueryId: {
      type: 'string',
      description: 'Id returned by semantic_query for audit linkage',
    },
    filters: {
      type: 'array',
      items: OPEN_FILTER,
    },
    columns: {
      type: 'array',
      items: { type: 'string' },
    },
    limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
    offset: { type: 'integer', minimum: 0, default: 0 },
  },
  required: ['businessTableId', 'filters'],
}

/** Model-facing parameters for `cite`. */
export const CITE_PARAMETERS: SchemaNode = {
  type: 'object',
  additionalProperties: false,
  properties: {
    businessTableIds: {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
    },
    predicates: {
      type: 'array',
      items: CITATION_PREDICATE,
    },
    queryIds: {
      type: 'array',
      items: { type: 'string' },
    },
    note: { type: 'string' },
  },
  required: ['businessTableIds'],
}

/**
 * Fill schema `default` annotations the model omitted.
 * @param schema - the tool parameter node.
 * @param value - the raw model arguments.
 * @returns a copy with omitted defaults filled.
 */
export function applyDefaults(schema: SchemaNode, value: unknown): unknown {
  if (schema.type === 'array' && Array.isArray(value)) {
    const items = schema.items
    if (items === undefined) return value
    return value.map(item => applyDefaults(items, item))
  }
  if (schema.type !== 'object' || !isRecord(value)) return value
  const out: Record<string, unknown> = { ...value }
  for (const [key, child] of Object.entries(schema.properties ?? {})) {
    if (!Object.hasOwn(out, key) && Object.hasOwn(child, 'default')) out[key] = child.default
    else if (Object.hasOwn(out, key)) out[key] = applyDefaults(child, out[key])
  }
  return out
}

/**
 * Check arguments and return the defaulted object, or throw a rewrite suggestion.
 * @param schema - the tool parameter node.
 * @param args - the raw model arguments.
 * @param toolName - tool name included in the suggestion.
 * @returns the defaulted argument object.
 */
export function parseArgs(schema: SchemaNode, args: unknown, toolName: string): Record<string, unknown> {
  const value = applyDefaults(schema, args)
  const violations = validateNode(schema, value, '$')
  const violation = violations[0]
  if (violation !== undefined) {
    throw new RewriteError(`Rephrase the question for ${toolName}: ${violation}`)
  }
  return value as Record<string, unknown>
}

function validateNode(schema: SchemaNode, value: unknown, path: string): string[] {
  if (schema.type === undefined) return []
  if (schema.type === 'object') return validateObject(schema, value, path)
  if (schema.type === 'array') return validateArray(schema, value, path)
  if (schema.type === 'string') return validateString(schema, value, path)
  return validateInteger(schema, value, path)
}

function validateObject(schema: SchemaNode, value: unknown, path: string): string[] {
  if (!isRecord(value)) return [`${path} must be an object`]
  const properties = schema.properties ?? {}
  const violations: string[] = []
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(properties, key)) violations.push(`${path}.${key} is not allowed`)
    }
  }
  const required = schema.required
  if (required !== undefined) {
    for (const key of required) {
      if (!Object.hasOwn(value, key)) violations.push(`${path}.${key} is required`)
    }
  }
  for (const [key, child] of Object.entries(properties)) {
    if (!Object.hasOwn(value, key)) continue
    violations.push(...validateNode(child, value[key], `${path}.${key}`))
  }
  return violations
}

function validateArray(schema: SchemaNode, value: unknown, path: string): string[] {
  if (!Array.isArray(value)) return [`${path} must be an array`]
  const violations: string[] = []
  if (schema.minItems !== undefined && value.length < schema.minItems) {
    violations.push(`${path} must contain at least ${schema.minItems} item(s)`)
  }
  const items = schema.items
  if (items === undefined) return violations
  for (let index = 0; index < value.length; index += 1) {
    violations.push(...validateNode(items, value[index], `${path}[${index}]`))
  }
  return violations
}

function validateString(schema: SchemaNode, value: unknown, path: string): string[] {
  if (typeof value !== 'string') return [`${path} must be a string`]
  if (schema.enum !== undefined && !schema.enum.includes(value)) {
    return [`${path} must be one of ${schema.enum.join(', ')}`]
  }
  return []
}

function validateInteger(schema: SchemaNode, value: unknown, path: string): string[] {
  if (typeof value !== 'number' || !Number.isInteger(value)) return [`${path} must be an integer`]
  if (schema.minimum !== undefined && value < schema.minimum) {
    return [`${path} must be >= ${schema.minimum}`]
  }
  if (schema.maximum !== undefined && value > schema.maximum) {
    return [`${path} must be <= ${schema.maximum}`]
  }
  return []
}
