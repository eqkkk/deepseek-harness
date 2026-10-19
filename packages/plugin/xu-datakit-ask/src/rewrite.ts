/**
 * Model-facing failure for a refused or unusable ask call.
 * The message is a rewrite suggestion. It never names a physical query channel.
 * @module @deepseek-ai/dsh-plugin-xu-datakit-ask/rewrite
 */

/** Failure whose text the model should treat as a request to rephrase. */
export class RewriteError extends Error {
  /**
   * @param message - natural-language suggestion safe to show to the model.
   */
  constructor(message: string) {
    super(message)
    this.name = 'RewriteError'
  }
}
