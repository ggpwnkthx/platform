/**
 * The cookies of the login (spec §5.3).
 *
 * The state of a login travels in cookies, and every cookie of the login
 * has a path of its own: the state of the login is sent to the callback
 * and to nothing else, the state of a local sign-in is sent to the page of
 * the password, and the state of a discovery is sent to the page of the
 * address.
 *
 * The cookies are `HttpOnly`, `SameSite=Lax` and `Secure` in production.
 * `SameSite=Lax` is what keeps a form of another site from answering: a
 * cross-site POST carries no cookie of the login, and the answer of such
 * a form is a refusal.
 */

/** The name of the cookie of the state of a login. */
export const STATE_COOKIE = 'access_login_state'

/** The name of the cookie of the state of a local sign-in. */
export const LOCAL_STATE_COOKIE = 'access_local_state'

/** The name of the cookie of the state of a discovery. */
export const DISCOVERY_STATE_COOKIE = 'access_discovery_state'

/** The life of the state of a login, in seconds. */
export const STATE_TTL_SECONDS = 600

/** The attributes of a cookie of the login. */
function cookieOf(name: string, path: string, value: string, secure: boolean, maxAge: number) {
  const parts = [
    `${name}=${value}`,
    `Path=${path}`,
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

/**
 * The cookie of the state of a login.
 *
 * @param value the value of the cookie: the encrypted state of the login.
 * @param secure true when the cookie carries the `Secure` attribute.
 * @param maxAgeSeconds the life of the cookie, in seconds.
 */
export function stateCookie(value: string, secure: boolean, maxAgeSeconds: number): string {
  return cookieOf(STATE_COOKIE, '/oauth/tenant/callback', value, secure, maxAgeSeconds)
}

/** The cookie that deletes the state of a login. */
export function deletedStateCookie(secure: boolean): string {
  return stateCookie('', secure, 0)
}

/**
 * The cookie of the state of a local sign-in.
 *
 * @param value the value of the cookie: the encrypted state of the login.
 * @param secure true when the cookie carries the `Secure` attribute.
 * @param maxAgeSeconds the life of the cookie, in seconds.
 */
export function localStateCookie(value: string, secure: boolean, maxAgeSeconds: number): string {
  return cookieOf(LOCAL_STATE_COOKIE, '/oauth/local', value, secure, maxAgeSeconds)
}

/**
 * The cookie of the state of a discovery.
 *
 * @param value the value of the cookie: the encrypted state of the login.
 * @param secure true when the cookie carries the `Secure` attribute.
 * @param maxAgeSeconds the life of the cookie, in seconds.
 */
export function discoveryStateCookie(
  value: string,
  secure: boolean,
  maxAgeSeconds: number
): string {
  return cookieOf(DISCOVERY_STATE_COOKIE, '/oauth/discover', value, secure, maxAgeSeconds)
}

/** The cookie that deletes the state of a discovery. */
export function deletedDiscoveryStateCookie(secure: boolean): string {
  return discoveryStateCookie('', secure, 0)
}

/** Reads a cookie of a request. */
export function readCookie(request: Request, name: string): string | undefined {
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
