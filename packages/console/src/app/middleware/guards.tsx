/**
 * The guards of the sections of the console.
 *
 * A guard refuses a request before the page runs: a page of a workspace
 * needs a caller whose token the gateway still accepts, and a page of
 * the administration needs an operator whose scope reaches the tenant.
 */

import type { Context, MiddlewareHandler } from 'hono'
import { createMiddleware } from 'hono/factory'
import { consoleAbility, CONSOLE_ACTIONS, CONSOLE_SUBJECT } from '../../domains/ability'
import { credentialFor } from '../../domains/operators'
import { flash, hereOf, loginUrl, tokenIsAlive } from './session'
import { operatorScope } from './scope'

/** Sends the caller to the login, and back to where it was. */
function toLogin(c: Context): Response {
  if (c.req.method === 'GET' || c.req.method === 'HEAD') return c.redirect(loginUrl(hereOf(c)))
  // A form that was sent with an expired session is not replayed after
  // the login: the caller sends it again, knowingly.
  const referer = c.req.header('referer')
  const back = referer ? new URL(referer).pathname : '/'
  return c.redirect(loginUrl(back))
}

/** A page that requires a caller. */
export const requireSession: MiddlewareHandler = createMiddleware(async (c, next) => {
  if (!c.get('session')) return toLogin(c)
  await next()
})

/**
 * A page that reads the data of a workspace: the caller needs a token
 * the gateway accepts. The access token of Access lives five
 * minutes and there is no refresh token: a token that expired is renewed
 * with a login, which the provider of the tenant answers without a
 * question when the caller is still signed in there.
 */
export const requireToken: MiddlewareHandler = createMiddleware(async (c, next) => {
  const session = c.get('session')
  if (!session) return toLogin(c)
  if (!tokenIsAlive(session)) {
    if (c.req.method !== 'GET') {
      flash(c, {
        kind: 'error',
        text: 'Your access to the data expired before the form was sent. Nothing was changed: send it again.',
      })
    }
    return toLogin(c)
  }
  await next()
})

/** A page of the administration: the caller administers something. */
export const requireOperator: MiddlewareHandler = createMiddleware(async (c, next) => {
  if (!c.get('session')) return toLogin(c)
  const ability = consoleAbility(await operatorScope(c))
  if (!ability.can(CONSOLE_ACTIONS.admin, CONSOLE_SUBJECT)) {
    c.status(403)
    return c.render(
      <section class="refusal">
        <h1>The administration is not open to you</h1>
        <p>
          Access holds neither <code>console.admin</code> nor <code>console.platform</code> for you
          on the route of the console, or the console holds no credential of the administration for
          your tenant.
        </p>
        <p>
          <a href="/me">See what the console knows about you</a>
        </p>
      </section>,
      { title: 'Not open to you', section: 'operators' }
    )
  }
  await next()
})

/** The credential of the administration for the tenant of a page, or a refusal. */
export async function tenantCredential(c: Context, tenant: string): Promise<string | null> {
  const scope = await operatorScope(c)
  return credentialFor(scope, c.get('services').credentials, tenant)
}
