/**
 * The beginning of a sign-in: the browser is sent to Access.
 */

import { setCookie } from 'hono/cookie'
import { createRoute } from 'honox/factory'
import { randomValue, safeRedirect } from '../../../domains/authentication'
import { sign } from '../../../domains/session'
import { LOGIN_COOKIE } from '../../middleware/session'

export default createRoute(async (c) => {
  const services = c.get('services')
  const state = randomValue()
  const login = services.logins.begin({
    state,
    nonce: randomValue(),
    verifier: randomValue(),
    redirect: safeRedirect(c.req.query('redirect')),
  })
  // The cookie binds the login to the browser that began it: a code that
  // comes back to another browser is not a code of this login.
  setCookie(c, LOGIN_COOKIE, sign(state, services.config.sessionSecret), {
    httpOnly: true,
    secure: services.config.cookieSecure,
    sameSite: 'Lax',
    path: '/auth/callback',
    maxAge: 600,
  })
  const target = await services.provider.authorizationUrl({
    redirectUri: services.callbackUrl,
    state: login.state,
    nonce: login.nonce,
    verifier: login.verifier,
  })
  c.header('cache-control', 'no-store')
  return c.redirect(target)
})
