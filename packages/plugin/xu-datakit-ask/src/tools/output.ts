/**
 * Output schema fragment shared by aggregate and drilldown filters.
 * @module @deepseek-ai/dsh-plugin-xu-datakit-ask/tools/output
 */

import type { JsonSchemaNode } from '@deepseek-ai/dsh-tools'

/** Filter list on a successful aggregate or drilldown result. */
export const FILTER_OUTPUT: JsonSchemaNode = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['field', 'op', 'value'],
    properties: {
      field: { type: 'string' },
      op: { type: 'string' },
      value: {},
    },
  },
}
