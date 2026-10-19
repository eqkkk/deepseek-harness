/**
 * Shared registration for one ask tool. Each tool still has its own parameters,
 * description, and execute function.
 * @module @deepseek-ai/dsh-plugin-xu-datakit-ask/tools/define
 */

import type { Context } from '@deepseek-ai/cordis'
import type { JsonSchemaNode, JsonValue, ToolCallView, ToolResult, ToolResultView, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { parseArgs, type SchemaNode } from '../schema.ts'

/** Kind shown on the generic pending card. */
export type AskCardKind = 'search' | 'fetch' | 'other'

/** Pieces that differ per tool. */
export interface AskToolSpec {
  name: string
  description: string
  parameters: SchemaNode
  output: JsonSchemaNode
  timeoutMs: number
  kind: AskCardKind
  render(value: JsonValue): string
  execute(args: Record<string, unknown>, exec: ToolRunContext): Promise<JsonValue>
}

/**
 * Register one ask tool on `ctx.tools`.
 * @param ctx - registrant context. The tool service must already be present.
 * @param spec - the tool's schema and body.
 */
export function registerAskTool(ctx: Context, spec: AskToolSpec): void {
  ctx.tools.register({
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters as unknown as Record<string, unknown>,
    timeoutMs: spec.timeoutMs,
    output: {
      schema: spec.output,
      render(_args, value) {
        return [{ type: 'text', text: spec.render(value) }]
      },
    },
    presentCall(_args): ToolCallView {
      return { card: 'generic', title: spec.name, kind: spec.kind }
    },
    presentResult(_args, result: ToolResult): ToolResultView {
      return { card: 'generic', title: spec.name, content: result.content }
    },
    execute(args, exec) {
      return spec.execute(parseArgs(spec.parameters, args, spec.name), exec)
    },
  })
}
