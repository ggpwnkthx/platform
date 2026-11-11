/**
 * The address of the caller (spec §5.2.2).
 *
 * The page is served by Access itself: the caller never leaves the origin
 * of the service. It asks for an address, and it carries the token of the
 * form: the state of the provider, which is bound to the state of the
 * login.
 *
 * The answer of the form is the address of the caller, and the login goes
 * on with it: the domain of the address names the tenant of the login, and
 * the provider of that tenant is the one the login signs in at.
 */

import type { Context } from 'hono'
import { LoginError, type AuthorizationRequest } from '../domains/identity'
import {
  deletedDiscoveryStateCookie,
  DISCOVERY_STATE_COOKIE,
  localStateCookie,
  readCookie,
  stateCookie,
  STATE_TTL_SECONDS,
} from './cookies'
import type { AccessDependencies } from './dependencies'
import { chooserLinks } from './login'
import { discoveryPage, providerChooserPage, refusalPage } from './pages'
import type { AccessEnv } from './state'

/**
 * `GET /oauth/discover`: the page that asks for the address of the caller.
 *
 * The page is written for a login that is in flight: the cookie of the
 * state names the client of the login. A login that is not in flight has
 * no page: the login starts again.
 */
export async function discoveryPageHandler(
  context: Context<AccessEnv>,
  dependencies: AccessDependencies
): Promise<Response> {
  const cookie = readCookie(context.req.raw, DISCOVERY_STATE_COOKIE)
  try {
    return discoveryPage(dependencies.login.discoveryForm(cookie))
  } catch (error) {
    if (error instanceof LoginError) {
      return refusalPage('login_state_invalid', 'the login has to start again', 400)
    }
    throw error
  }
}

/**
 * `POST /oauth/discover`: the answer of the form of the address.
 *
 * The answer is the address of the caller, and the login goes on with it:
 * the browser is sent to the provider of the tenant the domain of the
 * address names.
 */
export async function discoveryAnswerHandler(
  context: Context<AccessEnv>,
  dependencies: AccessDependencies
): Promise<Response> {
  const cookie = readCookie(context.req.raw, DISCOVERY_STATE_COOKIE)
  const form = await context.req.parseBody()
  const address = typeof form.email === 'string' ? form.email : ''
  const token = typeof form.token === 'string' ? form.token : ''

  try {
    const begun = await dependencies.login.discover({ cookie, address, token })
    // The state of the discovery is single use: it is deleted when the
    // login goes on. A refused answer keeps it, and the caller starts
    // the login again.
    const headers = new Headers()
    headers.append('set-cookie', deletedDiscoveryStateCookie(dependencies.cookieSecure))
    if (begun.kind === 'choose') {
      // The tenant of the login signs its people in at several providers
      // and it has no default one: the caller chooses (spec §5.2.1).
      const query = queryOf(dependencies.login.requestOf(cookie), begun.tenant)
      const page = providerChooserPage(begun.providers, chooserLinks(begun.providers, query))
      headers.set('content-type', 'text/html; charset=utf-8')
      return new Response(page.body, { status: page.status, headers })
    }
    if (begun.kind === 'discover') {
      // The answer of the form carries the address of the caller, and the
      // address names the tenant: the login never asks twice.
      return refusalPage('login_state_invalid', 'the login has to start again', 400)
    }
    if (begun.kind === 'local') {
      // The provider is a local one: the browser goes to the page of the
      // password, and the state of the login travels in two cookies: the
      // one of the callback and the one of the page (spec §5.4).
      headers.set('location', begun.url)
      headers.append(
        'set-cookie',
        stateCookie(begun.cookie, dependencies.cookieSecure, STATE_TTL_SECONDS)
      )
      headers.append(
        'set-cookie',
        localStateCookie(begun.cookie, dependencies.cookieSecure, STATE_TTL_SECONDS)
      )
      return new Response(null, { status: 302, headers })
    }
    headers.set('location', begun.url)
    headers.append(
      'set-cookie',
      stateCookie(begun.cookie, dependencies.cookieSecure, STATE_TTL_SECONDS)
    )
    return new Response(null, { status: 302, headers })
  } catch (error) {
    if (error instanceof LoginError) {
      dependencies.logger.warn('the address of the caller was refused', {
        code: error.code,
        requestId: context.get('requestId'),
      })
      return refusalPage('login_state_invalid', 'the login has to start again', 400)
    }
    throw error
  }
}

/**
 * The query of the request of a discovery.
 *
 * The query carries the parameters of the request of the caller and the
 * tenant of the login: the tenant is named, so that the login that begins
 * again is the login of the same tenant.
 */
function queryOf(
  request: AuthorizationRequest | null,
  tenant: string
): Record<string, string | undefined> {
  if (!request) return { tenant }
  return {
    client_id: request.clientId,
    redirect_uri: request.redirectUri,
    state: request.state,
    nonce: request.nonce,
    scope: request.scopes.join(' '),
    tenant,
    code_challenge: request.codeChallenge,
    code_challenge_method: request.codeChallenge ? 'S256' : undefined,
  }
}
