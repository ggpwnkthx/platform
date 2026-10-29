/**
 * The end of a sign-in: Access sends the browser back with
 * the code of the login, and the console exchanges it.
 */

import { deleteCookie, getCookie } from 'hono/cookie'
import { createRoute } from 'honox/factory'
import { LoginError } from '../../../domains/authentication'
import { unsign } from '../../../domains/session'
import { PageHead, Refusal, refusalOf } from '../../components/page'
import { LOGIN_COOKIE, writeSessionCookie } from '../../middleware/session'

export default createRoute(async (c) => {
  const services = c.get('services')
  const presented = unsign(getCookie(c, LOGIN_COOKIE), services.config.sessionSecret)
  deleteCookie(c, LOGIN_COOKIE, { path: '/auth/callback', secure: services.config.cookieSecure })
  c.header('cache-control', 'no-store')

  const fail = (error: unknown) => {
    const refusal = refusalOf(error)
    services.log.warn('a sign-in did not complete', {
      requestId: c.get('requestId'),
      code: refusal.code,
    })
    c.status(refusal.status === 502 ? 502 : 400)
    return c.render(
      <section class="refusal">
        <PageHead title="The sign-in did not complete" />
        <Refusal refusal={refusal} />
        <p>
          <a class="button" href="/auth/login">
            Sign in again
          </a>
        </p>
      </section>,
      { title: 'Sign-in' }
    )
  }

  // Access, or the provider of the tenant, refused the login.
  const refused = c.req.query('error')
  if (refused) {
    return fail(
      new LoginError(refused, c.req.query('error_description') ?? 'the login was refused')
    )
  }

  const state = c.req.query('state') ?? ''
  const code = c.req.query('code') ?? ''
  const login = state ? services.logins.take(state) : null
  if (!login || presented !== state || !code) {
    return fail(
      new LoginError(
        'login_state_invalid',
        'the login is unknown, expired, or was begun in another browser: a new one has to start'
      )
    )
  }

  try {
    const tokens = await services.provider.exchange({
      code,
      redirectUri: services.callbackUrl,
      verifier: login.verifier,
    })
    const identity = await services.provider.verify(tokens.idToken, login.nonce)
    // A login replaces the session the browser had: the identifier of a
    // session never survives a change of the identity it names.
    const previous = c.get('session')
    if (previous) services.sessions.destroy(previous.id)
    const session = services.sessions.create({
      principal: {
        id: identity.subject,
        tenant: identity.tenant,
        email: identity.email,
        name: identity.name,
        roles: identity.roles,
      },
      accessToken: tokens.accessToken,
      accessTokenExpiresAt: tokens.expiresAt,
    })
    // The workspaces the caller opened before survive a renewal.
    if (previous && previous.principal.id === session.principal.id) {
      session.workspaces = previous.workspaces
    }
    c.set('session', session)
    writeSessionCookie(c, session)
    services.log.info('a caller signed in', {
      requestId: c.get('requestId'),
      principal: identity.subject,
      tenant: identity.tenant,
    })
    return c.redirect(login.redirect)
  } catch (error) {
    return fail(error)
  }
})
