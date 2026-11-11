/**
 * The pages of the refusals of the login (spec §5.6).
 *
 * A page shows what happened and nothing else: the reason of the refusal
 * of the service stays in the log, and what the page shows is escaped.
 */

/** Escapes the text that a page shows. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** The titles of the pages of the refusals. */
const TITLES: Record<string, string> = {
  invalid_request: 'The request is not valid',
  login_state_invalid: 'The login has to start again',
  identity_rejected: 'The identity was refused',
  identity_unknown: 'The identity is not known to the platform',
  principal_disabled: 'The account is disabled',
  tenant_disabled: 'The tenant is disabled',
  upstream_unavailable: 'The provider is not reachable',
  internal_error: 'The service failed to answer',
}

/**
 * Builds the page of a refusal of the login.
 *
 * The page names the code of the refusal and says what happened. It never
 * shows the reason of the failure of a dependency.
 */
export function refusalPage(code: string, message: string, status: number): Response {
  const title = TITLES[code] ?? 'The login was refused'
  const body = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
    <p><code>${escapeHtml(code)}</code></p>
  </body>
</html>
`
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}

/**
 * Builds the page that asks for the address of the caller (spec §5.2.2).
 *
 * The page asks for an address and nothing else: it names no tenant of
 * the platform and no domain it knows, because an answer that says
 * whether a domain is known tells the caller which tenants the platform
 * holds.
 *
 * @param form the token of the form.
 */
export function discoveryPage(form: { token: string }): Response {
  const body = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Sign in</title>
  </head>
  <body>
    <h1>Sign in</h1>
    <form method="post" action="/oauth/discover">
      <input type="hidden" name="token" value="${escapeHtml(form.token)}" />
      <p>
        <label for="email">E-mail</label>
        <input id="email" name="email" type="email" required autocomplete="username" />
      </p>
      <p><button type="submit">Continue</button></p>
    </form>
  </body>
</html>
`
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}

/**
 * Builds the page of the choice of a provider (spec §5.2.1).
 *
 * The page lists the providers of the tenant and nothing else: every
 * entry is a link back to the authorization, with the same request and
 * the slug of the provider. The page carries no script and no style of
 * another site: the policy of the answers of the service forbids them.
 *
 * @param providers the providers the caller may sign in at.
 * @param links the address of the authorization of each provider.
 */
export function providerChooserPage(
  providers: { slug: string; displayName: string }[],
  links: Map<string, string>
): Response {
  const items = providers
    .map((provider) => {
      const href = links.get(provider.slug) ?? ''
      return `    <li><a href="${escapeHtml(href)}">${escapeHtml(provider.displayName)}</a></li>`
    })
    .join('\n')
  const body = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Choose a way to sign in</title>
  </head>
  <body>
    <h1>Choose a way to sign in</h1>
    <ul>
${items}
    </ul>
  </body>
</html>
`
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}
