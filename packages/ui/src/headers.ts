/**
 * The headers the interface is served with. One place, so that the CDN, the development
 * server and the deployment's own web server cannot drift apart: a page that works on one
 * must work on the others.
 *
 * The pages are static files, so these headers belong to the deployment that serves them.
 * They are written as a `_headers` file (the format Cloudflare Pages and Netlify read) next
 * to the built site, and the same values are used by the development server here.
 */

export type Origins = {
  /** The address the pages are served from, such as `https://platform.example.com`. */
  public: string
  /** The issuer the pages sign in against, such as `https://idp.platform.example.com`. */
  issuer: string
  /** The relay the pages open their database sessions through, such as `wss://relay.example.com`. */
  relay: string
}

const originOf = (url: string): string => {
  try {
    return new URL(url).origin
  } catch {
    return url.replace(/\/+$/, '')
  }
}

/**
 * The policy the pages live under. The pages load only their own files, talk only to the
 * relay and the issuer, and may not be framed or used as a form's target.
 */
export function contentSecurityPolicy(origins: Origins): string {
  const issuer = originOf(origins.issuer)
  const relay = originOf(origins.relay)
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "font-src 'self'",
    "img-src 'self' data:",
    `connect-src 'self' ${issuer} ${relay}`.replace(/\s+/g, ' ').trim(),
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; ')
}

/** The headers that go with the policy, in the order a `_headers` file lists them. */
export function securityHeaders(origins: Origins): Record<string, string> {
  return {
    'Content-Security-Policy': contentSecurityPolicy(origins),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  }
}

/**
 * The `_headers` file a CDN reads beside the site. The fonts never change and are kept for a
 * year; the pages and the bundle are revalidated, so that a new build is seen at once.
 */
export function headersFile(origins: Origins): string {
  const lines: string[] = []
  const block = (path: string, headers: Record<string, string>) => {
    lines.push(path)
    for (const [name, value] of Object.entries(headers)) lines.push(`  ${name}: ${value}`)
    lines.push('')
  }
  block('/*', securityHeaders(origins))
  block(
    '/fonts/*',
    Object.fromEntries(
      Object.entries(securityHeaders(origins)).filter(
        ([name]) => name !== 'Content-Security-Policy'
      )
    )
  )
  return `${lines.join('\n')}\n`
}
