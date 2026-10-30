/**
 * The session of the caller, as a request of the console carries it.
 *
 * The browser holds the signed identifier of a session in the cookie
 * `console_session`, and nothing else: the token of the caller stays on
 * the server of the console.
 */

import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { type Draft, type Flash, type Session, sign, unsign } from '../../domains/session'
import '../context'

/** The cookie of the session. */
export const SESSION_COOKIE = 'console_session'

/** The cookie of a login in flight. */
export const LOGIN_COOKIE = 'console_login'

/** Reads the session of a request, when it is alive. */
export function readSession(c: Context): Session | null {
  const services = c.get('services')
  const id = unsign(getCookie(c, SESSION_COOKIE), services.config.sessionSecret)
  if (!id) return null
  return services.sessions.read(id)
}

/** Writes the cookie of a session: it never outlives the session it names. */
export function writeSessionCookie(c: Context, session: Session): void {
  const services = c.get('services')
  setCookie(c, SESSION_COOKIE, sign(session.id, services.config.sessionSecret), {
    httpOnly: true,
    secure: services.config.cookieSecure,
    sameSite: 'Lax',
    path: '/',
    maxAge: Math.max(1, Math.floor(services.sessions.remainingMs(session) / 1000)),
  })
}

/** Removes the cookie of the session. */
export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: c.get('services').config.cookieSecure })
}

/** The session of a request that requires one. */
export function sessionOf(c: Context): Session {
  const session = c.get('session')
  if (!session) throw new Error('the page requires a session and the request has none')
  return session
}

/** Leaves a message for the next page the caller reads. */
export function flash(c: Context, message: Flash): void {
  const session = c.get('session')
  if (session) session.flash = message
}

/** Takes the message of the page, once. */
export function takeFlash(c: Context): Flash | null {
  const session = c.get('session')
  if (!session?.flash) return null
  const message = session.flash
  session.flash = null
  return message
}

/** Keeps a refused form for the page it came from. */
export function keepDraft(c: Context, draft: Draft): void {
  const session = c.get('session')
  if (session) session.draft = draft
}

/** Takes the refused form of that name, once; another form's draft stays. */
export function takeDraft(c: Context, form: string): Draft | null {
  const session = c.get('session')
  if (!session?.draft || session.draft.form !== form) return null
  const draft = session.draft
  session.draft = null
  return draft
}

/** Reports whether the access token of a session is still accepted by the gateway. */
export function tokenIsAlive(session: Session, marginMs = 5000): boolean {
  return session.accessTokenExpiresAt - marginMs > Date.now()
}

/** The url of the login that brings the caller back to a page. */
export function loginUrl(path: string): string {
  return `/auth/login?redirect=${encodeURIComponent(path)}`
}

/** The path and the query of a request: where a login brings the caller back. */
export function hereOf(c: Context): string {
  const url = new URL(c.req.url)
  return `${url.pathname}${url.search}`
}
