/**
 * The sign-in at a local provider (spec §5.4).
 *
 * The two endpoints are the page that asks for the password and the
 * answer of the form. The page is served by Access, and the form posts
 * to the service itself: the state of the login travels in a cookie of
 * its own, and the token of the form is the state of the provider.
 *
 * The refusal of a sign-in is the refusal of every sign-in: the page
 * says that the address or the password is wrong, and it never says
 * which one of the two it was.
 */

import type { Context } from 'hono'
import { LocalLoginError } from '../domains/identity'
import { LOCAL_STATE_COOKIE, readCookie } from './cookies'
import type { AccessDependencies } from './dependencies'
import { localLoginPage } from './local'
import { refusalPage } from './pages'
import type { AccessEnv } from './state'

/**
 * `GET /oauth/local/authorize`: the page that asks for the password.
 *
 * The page is written for a login that is in flight: the cookie of the
 * state names the tenant and the provider of the login. A login that is
 * not in flight has no page: the sign-in starts again.
 */
export async function localAuthorizeHandler(
  context: Context<AccessEnv>,
  dependencies: AccessDependencies
): Promise<Response> {
  const cookie = readCookie(context.req.raw, LOCAL_STATE_COOKIE)
  try {
    const form = dependencies.local.form(cookie)
    return localLoginPage(form)
  } catch (error) {
    if (error instanceof LocalLoginError) {
      return refusalPage('login_state_invalid', 'the login has to start again', 400)
    }
    throw error
  }
}

/**
 * `POST /oauth/local/login`: the answer of the form.
 *
 * The form is checked, the password is checked, and the callback is
 * given a code that names the credential that signed in. The browser
 * goes back to the callback of Access, and the login finishes there.
 */
export async function localLoginHandler(
  context: Context<AccessEnv>,
  dependencies: AccessDependencies
): Promise<Response> {
  const cookie = readCookie(context.req.raw, LOCAL_STATE_COOKIE)
  const form = await context.req.parseBody()
  const email = typeof form.email === 'string' ? form.email : ''
  const password = typeof form.password === 'string' ? form.password : ''
  const token = typeof form.token === 'string' ? form.token : ''

  try {
    const signedIn = await dependencies.local.signIn({
      cookie,
      email,
      password,
      token,
      address: dependencies.callerAddress(context.req.raw),
    })
    // The callback is on the origin of the service: the browser never
    // leaves it, and the url of the redirect is relative.
    const url = new URL('/oauth/tenant/callback', 'https://access.invalid')
    url.searchParams.set('code', signedIn.code)
    url.searchParams.set('state', signedIn.state)
    return new Response(null, {
      status: 302,
      headers: { location: `${url.pathname}${url.search}` },
    })
  } catch (error) {
    if (error instanceof LocalLoginError) {
      dependencies.logger.warn('the sign-in at a local provider was refused', {
        code: error.code,
        requestId: context.get('requestId'),
        reason: error.message,
      })
      if (error.code === 'too_many_requests') {
        return refusalPage('too_many_requests', error.message, 429)
      }
      if (error.code === 'login_state_invalid') {
        return refusalPage('login_state_invalid', 'the login has to start again', 400)
      }
      return refusalPage('identity_rejected', error.message, 403)
    }
    throw error
  }
}
