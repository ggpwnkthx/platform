/**
 * The HTTP boundary of the service (spec §9).
 *
 * The module owns the shell of the service: the request id of every
 * request, the mapping of the failures to the answers, the operational
 * endpoints and the registration of the routes of the API. It
 * establishes the context of a request before a domain operation runs:
 * no domain operation starts without a verified principal and a
 * resolved workspace.
 */

import { Hono } from 'hono'
import { ServiceError } from '../protocol/errors'
import { envelopeFor } from './errors'
import { registerRoutes } from './routes'
import { secretsMatch } from './secrets'
import type { AppDependencies, AppEnv } from './types'

/** The methods of every route of the service. */
const ROUTES: readonly { pattern: RegExp; methods: readonly string[] }[] = [
  { pattern: /^\/ws\/[^/]+\/v1\/me$/, methods: ['GET'] },
  { pattern: /^\/ws\/[^/]+\/v1\/schema$/, methods: ['GET'] },
  { pattern: /^\/ws\/[^/]+\/v1\/schema\/[^/]+$/, methods: ['GET'] },
  { pattern: /^\/ws\/[^/]+\/v1\/aggregate\/[^/]+$/, methods: ['GET'] },
  { pattern: /^\/ws\/[^/]+\/v1\/items\/[^/]+$/, methods: ['GET', 'POST'] },
  { pattern: /^\/ws\/[^/]+\/v1\/items\/[^/]+\/[^/]+$/, methods: ['GET', 'PATCH', 'DELETE'] },
  { pattern: /^\/ws\/[^/]+\/v1\/items\/[^/]+\/[^/]+\/versions$/, methods: ['GET'] },
  { pattern: /^\/ws\/[^/]+\/v1\/items\/[^/]+\/[^/]+\/versions\/[^/]+$/, methods: ['GET'] },
  { pattern: /^\/ws\/[^/]+\/v1\/items\/[^/]+\/[^/]+\/rollback$/, methods: ['POST'] },
  { pattern: /^\/ws\/[^/]+\/v1\/audit$/, methods: ['GET'] },
  { pattern: /^\/ws\/[^/]+\/v1\/model$/, methods: ['GET'] },
  { pattern: /^\/ws\/[^/]+\/v1\/model\/collections$/, methods: ['POST'] },
  { pattern: /^\/ws\/[^/]+\/v1\/model\/collections\/[^/]+$/, methods: ['PATCH', 'DELETE'] },
  { pattern: /^\/ws\/[^/]+\/v1\/model\/collections\/[^/]+\/fields$/, methods: ['POST'] },
  {
    pattern: /^\/ws\/[^/]+\/v1\/model\/collections\/[^/]+\/fields\/[^/]+$/,
    methods: ['PATCH', 'DELETE'],
  },
  { pattern: /^\/ws\/[^/]+\/v1\/model\/collections\/[^/]+\/relations$/, methods: ['POST'] },
  {
    pattern: /^\/ws\/[^/]+\/v1\/model\/collections\/[^/]+\/relations\/[^/]+$/,
    methods: ['PATCH', 'DELETE'],
  },
  { pattern: /^\/ws\/[^/]+\/v1\/openapi\.json$/, methods: ['GET'] },
]

/** Builds the application. */
export function createApp(dependencies: AppDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.use('*', async (c, next) => {
    const requestId = c.req.header('x-request-id') ?? crypto.randomUUID()
    c.set('requestId', requestId)
    c.header('x-request-id', requestId)
    const started = Date.now()
    try {
      await next()
    } finally {
      const status = c.res.status
      const duration = Date.now() - started
      dependencies.metrics.increment('data_requests_total', {
        route: normalizeRoute(c.req.path),
        method: c.req.method,
        status: String(status),
      })
      dependencies.metrics.observe('data_request_duration_ms', duration, {
        route: normalizeRoute(c.req.path),
        method: c.req.method,
      })
    }
  })

  app.onError((error, c) => {
    const requestId = c.get('requestId') ?? 'unknown'
    if (error instanceof ServiceError) {
      if (error.code === 'FORBIDDEN') {
        dependencies.metrics.increment('data_authorization_denials_total', { reason: error.code })
      }
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        ...error.headers,
      }
      return new Response(JSON.stringify(envelopeFor(error, requestId)), {
        status: error.status,
        headers,
      })
    }
    dependencies.logger.error('the request could not be completed', {
      requestId,
      route: normalizeRoute(c.req.path),
      error: error instanceof Error ? error.message : 'unknown error',
      stack: error instanceof Error ? (error.stack ?? '').split('\n').slice(0, 4).join(' | ') : '',
      // The cause of the error holds the reason of the driver: it is
      // never sent to the caller, and it is the only place where the
      // reason of a failure of the database is written down.
      cause:
        error instanceof Error && error.cause instanceof Error ? error.cause.message : undefined,
    })
    const failure = new ServiceError('INTERNAL_ERROR')
    return new Response(JSON.stringify(envelopeFor(failure, requestId)), {
      status: failure.status,
      headers: { 'content-type': 'application/json' },
    })
  })

  app.notFound((c) => {
    const requestId = c.get('requestId') ?? 'unknown'
    const path = new URL(c.req.url).pathname
    for (const route of ROUTES) {
      if (!route.pattern.test(path)) continue
      if (route.methods.includes(c.req.method)) continue
      const error = new ServiceError('INVALID_REQUEST', {
        message: 'the method is not allowed here',
      })
      return new Response(JSON.stringify(envelopeFor(error, requestId)), {
        status: 405,
        headers: { 'content-type': 'application/json', allow: route.methods.join(', ') },
      })
    }
    const error = new ServiceError('NOT_FOUND')
    return new Response(JSON.stringify(envelopeFor(error, requestId)), {
      status: error.status,
      headers: { 'content-type': 'application/json' },
    })
  })

  // The operational endpoints are not routed through the authorization of
  // a workspace.
  app.get('/healthz', (c) =>
    c.json({
      status: 'ok',
      service: 'data-backend',
      version: dependencies.serviceVersion,
      schemaVersion: dependencies.schemaVersion,
    })
  )

  app.get('/readyz', async (c) => {
    // A service that drains does not accept new work: the readiness
    // probe takes it out of the rotation. The vocabulary of the status
    // is the one of the three services: `ready`, `draining` and
    // `not-ready`.
    if (dependencies.isDraining?.() ?? false) {
      return c.json({ status: 'draining' }, 503)
    }
    const state = await dependencies.readiness.check()
    if (!state.ready) {
      return c.json({ status: 'not-ready', reason: state.reason ?? 'unknown' }, 503)
    }
    return c.json({ status: 'ready' })
  })

  app.get('/metrics', (c) => {
    const token = dependencies.settings.observability.metricsToken
    if (!token) {
      return new Response('not found', { status: 404 })
    }
    const presented = c.req.header('authorization') ?? ''
    if (!secretsMatch(presented, `Bearer ${token}`)) {
      return new Response('unauthorized', { status: 401 })
    }
    return new Response(dependencies.metrics.render(), {
      status: 200,
      headers: { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' },
    })
  })

  registerRoutes(app, dependencies)

  return app
}

/**
 * The normalized name of a route.
 *
 * The name is a pattern and not a path: a path carries the identifiers
 * of the records and it would grow the metrics without a bound.
 */
export function normalizeRoute(path: string): string {
  for (const route of ROUTES) {
    if (route.pattern.test(path)) {
      return route.pattern.source
    }
  }
  if (path === '/healthz') return '/healthz'
  if (path === '/readyz') return '/readyz'
  if (path === '/metrics') return '/metrics'
  return 'other'
}
