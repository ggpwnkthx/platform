/**
 * The state of the provider of a login (spec §5.3).
 *
 * The state of the provider is bound to the state of the login: it is
 * derived from the fields of the state and from the secret of the
 * deployment, so it cannot be forged, and it does not have to be carried
 * by the cookie.
 *
 * The binding names the provider of the login: a code that was minted
 * for one provider is not a code for another one.
 */

import { createHmac } from 'node:crypto'
import type { LoginState } from './state'

/** The state of the provider of a state of a login. */
export function providerStateOf(state: LoginState, secret: string): string {
  return createHmac('sha256', secret)
    .update(`${state.tenant}:${state.provider}:${state.startedAt}:${state.nonce}`)
    .digest('base64url')
}
