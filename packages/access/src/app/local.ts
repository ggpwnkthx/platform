/**
 * The sign-in at a local provider (spec §5.4).
 *
 * The page is served by Access itself: the caller never leaves the origin
 * of the service. It asks for an address and a password, and it carries
 * the token of the form: the state of the provider, which is bound to the
 * state of the login.
 *
 * The answer of a refused sign-in is the answer of every refused sign-in:
 * the page says that the address or the password is wrong, and it never
 * says which one of the two it was.
 */

import { escapeHtml } from './pages'

/** The form of the password page. */
export interface LocalFormView {
  /** The slug of the tenant of the login. */
  tenant: string
  /** The slug of the provider of the login. */
  provider: string
  /** The token of the form: the state of the provider. */
  token: string
}

/**
 * Builds the page that asks for the password.
 *
 * The page carries no account of the tenant and no hint about the
 * accounts it holds: it asks for an address and a password, and nothing
 * else.
 */
export function localLoginPage(form: LocalFormView): Response {
  const body = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Sign in</title>
  </head>
  <body>
    <h1>Sign in</h1>
    <form method="post" action="/oauth/local/login">
      <input type="hidden" name="token" value="${escapeHtml(form.token)}" />
      <p>
        <label for="email">E-mail</label>
        <input id="email" name="email" type="email" required autocomplete="username" />
      </p>
      <p>
        <label for="password">Password</label>
        <input id="password" name="password" type="password" required autocomplete="current-password" />
      </p>
      <p><button type="submit">Sign in</button></p>
    </form>
  </body>
</html>
`
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}
