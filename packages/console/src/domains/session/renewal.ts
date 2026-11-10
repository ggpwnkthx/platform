/**
 * The renewal of the tokens of a session.
 *
 * The access token of Access lives five minutes. The console keeps the
 * token of the caller on the server and renews it before it expires,
 * with the refresh token of the login, so the caller signs in once and
 * reads the data for as long as the session lasts.
 *
 * The renewal happens on the server: the browser is never sent to the
 * provider of the tenant, and it never sees a token.
 */

import type { Session } from './store'

/**
 * How long before the expiry of a token the console renews it.
 *
 * The margin covers the time a call to Access takes: the token is
 * renewed before it dies, never after.
 */
export const RENEWAL_MARGIN_MS = 60_000

/**
 * Reports whether the token of a session is to be renewed.
 *
 * A session that holds no refresh token is not renewed: the caller has
 * to sign in again when the token expires.
 */
export function needsRenewal(session: Session, now: number = Date.now()): boolean {
  if (!session.refreshToken) return false
  return session.accessTokenExpiresAt - now <= RENEWAL_MARGIN_MS
}
