/**
 * The renewal of the token of the caller.
 *
 * The browser asks the console to renew the token of its session before
 * it expires. The console renews it with the refresh token of the login,
 * on the server, and answers the moment the new token expires.
 *
 * The answer holds no token: the browser never sees one.
 */

import { createRoute } from 'honox/factory'
import { tokenIsAlive } from '../../middleware/session'

export const POST = createRoute((c) => {
  const session = c.get('session')
  if (!session) return c.json({ error: 'no_session' }, 401)
  return c.json({
    expiresAt: session.accessTokenExpiresAt,
    // A session that holds no refresh token cannot renew itself: the
    // browser offers the sign-in again.
    renewable: session.refreshToken !== null && tokenIsAlive(session),
  })
})
