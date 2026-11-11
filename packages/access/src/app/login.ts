/**
 * The login of the callers (spec §5.1, §5.4).
 *
 * The gateway sends the browser to `/oauth/authorize` and the provider of
 * the tenant sends it back to `/oauth/tenant/callback`. The handlers are
 * thin: they read the parameters, they ask the identity domain and they
 * write the answer.
 */

import type { Context } from 'hono'
import { LoginError } from '../domains/identity'
import { acceptedScopes } from '../domains/provider'
import type { AccessDependencies } from './dependencies'
import { refusalPage } from './pages'
import type { AccessEnv } from './state'

/** The cookie of the state of a login. */
const STATE_COOKIE = 'access_login_state'

/** The attributes of the cookie of the state of a login. */
function stateCookie(value: string, secure: boolean, maxAgeSeconds: number): string {
  const parts = [
    `${STATE_COOKIE}=${value}`,
    'Path=/oauth/tenant/callback',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

/** The cookie that deletes the state of a login. */
function deletedStateCookie(secure: boolean): string {
  return stateCookie('', secure, 0)
}

/** Reads a cookie of a request. */
function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('cookie')
  if (!header) return undefined
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key !== name) continue
    const value = rest.join('=')
    // A value that is not a valid escape is not a cookie: the state of the
    // login is unreadable, and the callback refuses the login.
    try {
      return decodeURIComponent(value)
    } catch {
      return undefined
    }
  }
  return undefined
}

/**
 * `GET /oauth/authorize`: the beginning of a login.
 *
 * The tenant of the login is resolved, the state of the login is created
 * and the browser is sent to the provider of the tenant.
 */
export async function authorizeHandler(
  context: Context<AccessEnv>,
  dependencies: AccessDependencies
): Promise<Response> {
  const query = context.req.query()
  const clientId = query.client_id ?? ''
  const redirectUri = query.redirect_uri ?? ''
  if (!clientId || !redirectUri) {
    return refusalPage(
      'invalid_request',
      'the client id and the redirect uri of the request are required',
      400
    )
  }
  if (query.response_type && query.response_type !== 'code') {
    return refusalPage('invalid_request', 'the response type of the request is not supported', 400)
  }
  if (query.code_challenge_method && query.code_challenge_method !== 'S256') {
    return refusalPage(
      'invalid_request',
      'the challenge method of the request is not supported',
      400
    )
  }

  try {
    const begun = await dependencies.login.begin({
      clientId,
      redirectUri,
      state: query.state ?? '',
      nonce: query.nonce,
      scopes: acceptedScopes((query.scope ?? 'openid').split(' ').filter(Boolean)),
      tenant: query.tenant,
      loginHint: query.login_hint,
      // The provider of the tenant the caller signs in at: it names a
      // provider of the tenant of the login and nothing else (spec §5.2).
      provider: query.provider,
      codeChallenge: query.code_challenge,
    })
    return new Response(null, {
      status: 302,
      headers: {
        location: begun.url,
        'set-cookie': stateCookie(begun.cookie, dependencies.cookieSecure, 600),
      },
    })
  } catch (error) {
    // The authorization is the beginning of a login: a refusal there is
    // a refused login, and the metric counts it.
    dependencies.observer.recordLogin('refused', 'unknown')
    return refusalOf(error, dependencies)
  }
}

/**
 * `GET /oauth/tenant/callback`: the end of a login.
 *
 * The provider sends the browser back with the code and its state, or with
 * the answer of a refusal.
 */
export async function callbackHandler(
  context: Context<AccessEnv>,
  dependencies: AccessDependencies
): Promise<Response> {
  const query = context.req.query()
  const cookie = readCookie(context.req.raw, STATE_COOKIE)

  // The state cookie is single use: it is deleted whatever the outcome of
  // the callback is.
  const deleted = { 'set-cookie': deletedStateCookie(dependencies.cookieSecure) }

  // The provider refuses the login: its own answer is passed to the
  // browser, unchanged.
  if (query.error) {
    dependencies.observer.recordLogin(
      'refused',
      (await dependencies.login.tenantOf(cookie)) ?? 'unknown'
    )
    const redirectUri = await dependencies.login.redirectUriOf(cookie)
    if (!redirectUri) {
      return refusalPage('login_state_invalid', 'the login has to start again', 400)
    }
    const url = new URL(redirectUri)
    url.searchParams.set('error', query.error)
    if (query.error_description) url.searchParams.set('error_description', query.error_description)
    const state = await dependencies.login.stateOf(cookie)
    if (state) url.searchParams.set('state', state)
    return new Response(null, {
      status: 302,
      headers: { ...deleted, location: url.toString() },
    })
  }

  if (!query.code) {
    dependencies.observer.recordLogin(
      'refused',
      (await dependencies.login.tenantOf(cookie)) ?? 'unknown'
    )
    return refusalPage('invalid_request', 'the callback carries no code', 400)
  }

  try {
    const completed = await dependencies.login.complete({
      cookie,
      providerState: query.state ?? '',
      code: query.code,
      // The facts of the call, for the audit of the principal that the
      // login creates (spec §10.1).
      facts: {
        address: dependencies.callerAddress(context.req.raw),
        requestId: context.get('requestId'),
      },
    })
    // A tenant that hands its administration to its first identity gives
    // it to the principal that signed in first (spec §6.4). The login
    // does not fail when the grant does not go through: the principal is
    // there, and the operator of the tenant grants the administration by
    // hand.
    if (completed.created && completed.first) {
      try {
        const operator = completed.principal.email ?? completed.principal.externalSubject
        await dependencies.administration.bootstrapAdministrator(
          {
            id: completed.principal.id,
            tenant: completed.principal.tenantSlug,
            operator,
          },
          {
            operator,
            address: dependencies.callerAddress(context.req.raw),
            requestId: context.get('requestId'),
          }
        )
      } catch (error) {
        dependencies.logger.error('the administration of the tenant was not given', {
          error,
          tenant: completed.principal.tenantSlug,
        })
      }
    }
    // The login is a fact of the tenant: the metric counts it, the log
    // tells it, and the principal it created is a row of the audit of
    // the tenant.
    dependencies.observer.recordLogin('success', completed.principal.tenantSlug)
    dependencies.logger.info('the login succeeded', {
      tenant: completed.principal.tenantSlug,
      subject: completed.principal.externalSubject,
    })
    if (completed.created) {
      dependencies.logger.info('a principal was created by a login', {
        tenant: completed.principal.tenantSlug,
        subject: completed.principal.externalSubject,
      })
    }
    const code = await dependencies.codes.issue({
      // The client that began the login, and not necessarily the tenant
      // of the login: with a shared client, the gateway presents the
      // client id it is registered with, and the code and the audience
      // belong to it (spec §5.2).
      clientId: completed.clientId,
      redirectUri: completed.redirectUri,
      codeChallenge: completed.codeChallenge,
      subject: completed.principal.id,
      tenant: completed.principal.tenantSlug,
      audience: completed.clientId,
      scopes: completed.scopes,
      nonce: completed.nonce,
    })
    const url = new URL(completed.redirectUri)
    url.searchParams.set('code', code)
    if (completed.state) url.searchParams.set('state', completed.state)
    return new Response(null, {
      status: 302,
      headers: { ...deleted, location: url.toString() },
    })
  } catch (error) {
    dependencies.observer.recordLogin(
      error instanceof LoginError ? 'refused' : 'error',
      (await dependencies.login.tenantOf(cookie)) ?? 'unknown'
    )
    return refusalOf(error, dependencies, (await dependencies.login.tenantOf(cookie)) ?? 'unknown')
  }
}

/** Turns the failure of the login into the page of the refusal. */
function refusalOf(error: unknown, dependencies: AccessDependencies, tenant = 'unknown'): Response {
  if (error instanceof LoginError) {
    dependencies.logger.warn('the login was refused', { code: error.code, tenant })
    const status =
      error.code === 'invalid_request' || error.code === 'login_state_invalid'
        ? 400
        : error.code === 'tenant_disabled'
          ? 403
          : error.code === 'upstream_unavailable'
            ? 502
            : 403
    return refusalPage(error.code, error.message, status)
  }
  dependencies.logger.error('the login failed', { error })
  return refusalPage('internal_error', 'the service failed to answer', 500)
}
