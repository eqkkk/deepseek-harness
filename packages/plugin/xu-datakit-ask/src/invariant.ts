/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-plugin-xu-datakit-ask`.
 * @module @deepseek-ai/dsh-plugin-xu-datakit-ask/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-plugin-xu-datakit-ask'

/** Cordis companion plugin name. */
export const name = 'xu-datakit-ask-invariant'

/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: ask results are tool outputs owned by the tool registry.
 * This package appends no session event, so there is no package-owned event
 * relation to check.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
