/**
 * The application of the gateway.
 *
 * The application is thin on purpose: it holds the order of the pipeline,
 * it maps the failures of the domains to the answers of the protocol and it
 * writes the headers and the cookies of the answers. Every rule lives in a
 * domain.
 */

import { randomUUID } from 'node:crypto'
import { Hono, type Context, type ExecutionContext } from 'hono'
import { serializeCookie } from '../domains/authentication'
import { GATEWAY_ENDPOINTS } from '../domains/configuration'
import { gatewayDocument } from './openapi'
import { resolveForwardingContext } from '../domains/forwarding'
import { normalizeHost } from '../domains/routing'
import { coversName } from '../domains/tls'
import { UNMATCHED_ROUTE } from '../observability'
import type { GatewayDependencies } from './dependencies'
import { dispatch } from './dispatcher'
import {
  callbackHandler,
  healthHandler,
  loginHandler,
  logoutHandler,
  metricsHandler,
  readyHandler,
} from './endpoints'
import { jsonError } from './errors'
import type { GatewayEnv, GatewayState } from './state'

/** The shape of the identifier of a request. */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/

/**
 * The identifier of a request.
 *
 * The identifier of the request is reused when it is valid: a client that
 * sends one can follow its request in the logs. An identifier that is not
 * valid is replaced by a generated one: the identifier ends up in a log
 * line and in a header, so it may not carry anything else.
 */
function resolveRequestId(request: Request): string {
  const incoming = request.headers.get('x-request-id')
  if (incoming && REQUEST_ID_PATTERN.test(incoming)) return incoming
  return randomUUID()
}

/** The state of a request that has just arrived. */
function initialState(request: Request, processStartedAt: number): GatewayState {
  return {
    requestId: resolveRequestId(request),
    startedAt: Date.now(),
    processStartedAt,
    snapshot: null,
    forwarding: null,
    routeId: null,
    cookies: [],
  }
}

/**
 * The forwarding context of a request.
 *
 * The endpoints of the gateway compute it themselves: the limiter of the
 * logins is keyed by the address of the caller, and the guard of the
 * logout compares the origin of the browser with the host the caller used.
 */
function forwardingOf(
  context: Context<GatewayEnv>,
  dependencies: GatewayDependencies
): ReturnType<typeof resolveForwardingContext> {
  const snapshot = dependencies.config.snapshot
  return resolveForwardingContext({
    peerAddress: dependencies.peerAddress(context.req.raw),
    headers: context.req.raw.headers,
    trustedProxies: snapshot?.trustedProxies ?? [],
    trustedProxyHops: dependencies.trustedProxyHops,
    ingressOnly: dependencies.ingressOnly,
    externalProto: dependencies.externalProto,
  })
}

/**
 * The names of the gateway itself.
 *
 * A deployment where the gateway is the only service of the platform has
 * no name of its own to answer on: every name is its name. A deployment
 * where the gateway is the front door of a platform names its names, and
 * the endpoints of the gateway answer on those names and on no other: the
 * console has an endpoint of its own at the same place, and a route of the
 * table claims the paths of the gateway on the names it owns.
 *
 * The names are read from the configuration: the table of the routes is
 * the one place that knows the names of the deployment.
 */
function isOwnHost(host: string, ownHosts: readonly string[]): boolean {
  if (ownHosts.length === 0) return true
  const normalized = normalizeHost(host)
  return ownHosts.some((own) => normalizeHost(own) === normalized)
}

/**
 * The application, as the listener of the platform sees it.
 *
 * The platform does not know the framework of the application: the
 * application answers the requests itself and hands the platform the
 * capabilities it needs.
 */
export interface GatewayHandler {
  handle(request: Request, env: GatewayEnv['Bindings']): Response | Promise<Response>
}

/**
 * Wraps the application of the gateway for the listener of the platform.
 */
export function createGatewayHandler(app: Hono<GatewayEnv>): GatewayHandler {
  const executionCtx: ExecutionContext = {
    waitUntil: () => undefined,
    passThroughOnException: () => undefined,
    props: {},
  }
  return {
    handle: (request, env) => app.fetch(request, env, executionCtx),
  }
}

/**
 * Builds the application of the gateway.
 */
export function createGatewayApp(dependencies: GatewayDependencies): Hono<GatewayEnv> {
  const app = new Hono<GatewayEnv>()
  // The moment the gateway started: the health of the gateway reports
  // the age of the process, and not the age of the request.
  const processStartedAt = Date.now()

  // The identifier of the request is the first thing: it is in every log
  // line of the request and in the answer.
  app.use('*', async (context, next) => {
    const state = initialState(context.req.raw, processStartedAt)
    context.set('requestId', state.requestId)
    context.set('startedAt', state.startedAt)
    context.set('processStartedAt', state.processStartedAt)
    context.set('snapshot', state.snapshot)
    context.set('forwarding', state.forwarding)
    context.set('routeId', state.routeId)
    context.set('cookies', state.cookies)
    await next()
    try {
      context.res.headers.set('x-request-id', state.requestId)
      for (const cookie of context.get('cookies')) {
        context.res.headers.append('set-cookie', serializeCookie(cookie))
      }
    } catch {
      // The headers of the answer are immutable, there is nothing to do.
    }
  })

  // The challenges of the authority of the certificates. The authority
  // asks the deployment to prove that it owns a name, and the answer is
  // the key authorization of the challenge: the deployment publishes it
  // when the authority asks for a certificate.
  app.get('/.well-known/acme-challenge/:token', async (context) => {
    const store = dependencies.tls?.store
    if (!store) return new Response('not found', { status: 404 })
    const authorization = await store.challenge(context.req.param('token'))
    if (authorization === null) return new Response('not found', { status: 404 })
    return new Response(authorization, {
      headers: { 'content-type': 'application/octet-stream' },
    })
  })

  // The redirect of the plain listener. A caller that asks for a name of
  // the certificate of the deployment over plain HTTP is sent to the same
  // name over TLS: the certificate is the reason the deployment has a
  // name, and the name is served over TLS.
  app.use('*', async (context, next) => {
    const certificate = dependencies.tls?.current()
    if (certificate === null || certificate === undefined) {
      await next()
      return
    }
    if (context.env.protocol === 'https') {
      await next()
      return
    }
    const host = context.req.header('host') ?? ''
    if (!coversName(certificate, host)) {
      await next()
      return
    }
    const url = new URL(context.req.url)
    return new Response(null, {
      status: 301,
      headers: { location: `https://${host}${url.pathname}${url.search}` },
    })
  })

  // The endpoints of the gateway. They are matched before the route table
  // is consulted.
  //
  // The endpoints that the callers reach — the login, the callback, the
  // logout, the document of the API — answer on the names of the gateway
  // and on no other name. On another name, the path belongs to the
  // service that is reached under that name: the request goes to the route
  // table, and the route of the console claims the path of the console.
  const ownName = (context: Context<GatewayEnv>): boolean => {
    const snapshot = dependencies.config.snapshot
    if (!snapshot || snapshot.hosts.length === 0) return true
    const forwarding = forwardingOf(context, dependencies)
    return isOwnHost(forwarding.host, snapshot.hosts)
  }

  app.get(GATEWAY_ENDPOINTS.health, (context) => healthHandler(context, dependencies))
  app.get(GATEWAY_ENDPOINTS.ready, (context) => readyHandler(context, dependencies))
  app.get(GATEWAY_ENDPOINTS.metrics, (context) => metricsHandler(context, dependencies))
  app.get(GATEWAY_ENDPOINTS.login, async (context, next) => {
    if (!ownName(context)) return await next()
    context.set('forwarding', forwardingOf(context, dependencies))
    return await loginHandler(context, dependencies)
  })
  app.get(GATEWAY_ENDPOINTS.callback, async (context, next) => {
    if (!ownName(context)) return await next()
    context.set('forwarding', forwardingOf(context, dependencies))
    return callbackHandler(context, dependencies)
  })
  app.get(GATEWAY_ENDPOINTS.logout, async (context, next) => {
    if (!ownName(context)) return await next()
    context.set('forwarding', forwardingOf(context, dependencies))
    return logoutHandler(context, dependencies)
  })
  app.get(GATEWAY_ENDPOINTS.openapi, async (context, next) => {
    if (!ownName(context)) return await next()
    return context.json(gatewayDocument(dependencies.version), 200, {
      'cache-control': 'public, max-age=300',
    })
  })

  // Everything else is dispatched.
  app.all('*', async (context) => {
    const requestId = context.get('requestId')
    const started = context.get('startedAt')
    dependencies.observer.requestStarted()
    try {
      return await dispatch(context, dependencies, requestId, started)
    } catch (error) {
      dependencies.logger.error('the gateway failed to handle the request', { requestId, error })
      // The request failed in the gateway itself: it is counted like every
      // other request the gateway answered.
      dependencies.observer.recordRequest({
        routeId: context.get('routeId') ?? UNMATCHED_ROUTE,
        method: context.req.method,
        status: 500,
        durationMs: Date.now() - started,
        bytesIn: 0,
        bytesOut: 0,
      })
      return jsonError(500, 'internal_error', 'the gateway failed to handle the request')
    } finally {
      dependencies.observer.requestFinished()
    }
  })

  app.onError((error, context) => {
    dependencies.logger.error('the gateway failed to handle the request', {
      requestId: context.get('requestId'),
      error,
    })
    dependencies.observer.recordRequest({
      routeId: context.get('routeId') ?? UNMATCHED_ROUTE,
      method: context.req.method,
      status: 500,
      durationMs: Date.now() - context.get('startedAt'),
      bytesIn: 0,
      bytesOut: 0,
    })
    return jsonError(500, 'internal_error', 'the gateway failed to handle the request')
  })

  return app
}
