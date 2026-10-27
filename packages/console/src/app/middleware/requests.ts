/**
 * What every request of the console goes through: its identifier, its
 * log line, the headers of the answer, the guard of the forms and the
 * session of the caller.
 */

import type { MiddlewareHandler } from 'hono'
import { createMiddleware } from 'hono/factory'
import { secureHeaders } from 'hono/secure-headers'
import { services } from '../../runtime/services'
import { readSession, writeSessionCookie } from './session'

const REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/

/** The identifier, the services and the log line of a request. */
export const requestContext: MiddlewareHandler = createMiddleware(async (c, next) => {
  const composed = services()
  c.set('services', composed)
  const presented = c.req.header('x-request-id')
  const requestId = presented && REQUEST_ID.test(presented) ? presented : crypto.randomUUID()
  c.set('requestId', requestId)
  const started = performance.now()
  await next()
  c.header('x-request-id', requestId)
  const path = new URL(c.req.url).pathname
  if (path === '/healthz' || path === '/readyz') return
  composed.log.info('request', {
    requestId,
    method: c.req.method,
    path,
    status: c.res.status,
    durationMs: Math.round(performance.now() - started),
  })
})

/** The headers of the answers: the page is never framed and never sniffed. */
export const securityHeaders: MiddlewareHandler = createMiddleware(async (c, next) => {
  const production = c.get('services').config.environment === 'production'
  const handler = secureHeaders({
    xFrameOptions: 'DENY',
    referrerPolicy: 'same-origin',
    crossOriginResourcePolicy: 'same-origin',
    // The server of the development injects the scripts of Vite inline:
    // the policy of the content is the one of a build.
    contentSecurityPolicy: production
      ? {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          objectSrc: ["'none'"],
        }
      : undefined,
    strictTransportSecurity: c.get('services').config.publicUrl.protocol === 'https:',
  })
  return handler(c, next)
})

/**
 * The guard of the forms: a request that changes something comes from a
 * page of the console. The browser names the origin of a form; a form
 * of another site is refused before it reaches the session.
 */
export const sameOrigin: MiddlewareHandler = createMiddleware(async (c, next) => {
  const method = c.req.method
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next()
  const allowed = new Set([c.get('services').config.publicUrl.origin, new URL(c.req.url).origin])
  const origin = c.req.header('origin')
  const site = c.req.header('sec-fetch-site')
  const fromHere = origin ? allowed.has(origin) : site === undefined || site === 'same-origin'
  if (!fromHere) {
    return c.text('the request does not come from a page of the console', 403)
  }
  await next()
})

/** The session of the caller, and its cookie, refreshed on every answer. */
export const sessionCookie: MiddlewareHandler = createMiddleware(async (c, next) => {
  const session = readSession(c)
  c.set('session', session)
  await next()
  const current = c.get('session')
  if (current && current === session) writeSessionCookie(c, current)
})
