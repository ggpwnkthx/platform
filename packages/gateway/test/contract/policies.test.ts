import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { WebSocket as NodeWebSocket } from 'ws'
import { createHarness, WORKSPACE_ID, type Harness } from '../support/contract-harness'

/**
 * The policies of a route.
 *
 * A route may refuse the navigations from another site, may not forward the
 * token of the caller to its upstream and may ask the access service for
 * every request, so a revocation on that route is immediate.
 */

/** The routes of the tests: one route per policy. */
function routes(context: { upstreamA: string; upstreamB: string }): unknown[] {
  return [
    {
      id: 'public-site',
      match: { host: 'public.gateway.test', path: '/' },
      upstream: context.upstreamA,
      auth: { mode: 'none' },
    },
    {
      id: 'strict-site',
      match: { host: 'strict.gateway.test', path: '/' },
      upstream: context.upstreamA,
      auth: { mode: 'session' },
      crossSite: 'strict',
    },
    {
      id: 'api',
      match: { host: 'api.gateway.test', path: '/' },
      upstream: context.upstreamA,
      auth: { mode: 'jwt' },
    },
    {
      id: 'quiet-api',
      match: { host: 'quiet.gateway.test', path: '/' },
      upstream: context.upstreamA,
      auth: { mode: 'jwt' },
      forwardAuthorization: false,
    },
    {
      id: 'workspace-api',
      match: { host: 'workspace.gateway.test', path: '/ws/{workspaceId}/' },
      upstream: context.upstreamA,
      auth: { mode: 'jwt', workspace: { param: 'workspaceId', requireUuid: true } },
    },
    {
      id: 'uncached-workspace-api',
      match: { host: 'uncached.gateway.test', path: '/ws/{workspaceId}/' },
      upstream: context.upstreamA,
      auth: { mode: 'jwt', workspace: { param: 'workspaceId', requireUuid: true } },
      accessCacheTtlMs: 0,
    },
    {
      id: 'socket',
      match: { host: 'socket.gateway.test', path: '/socket/' },
      upstream: context.upstreamB,
      auth: { mode: 'any' },
      websocket: true,
    },
  ]
}

/** The port of the gateway, as a number. */
function portOf(url: string): number {
  return Number(new URL(url).port)
}

describe('the policies of a route', () => {
  let harness: Harness

  beforeAll(async () => {
    harness = await createHarness({ routes })
  })

  afterAll(async () => {
    await harness.stop()
  })

  test('a route that refuses the navigations refuses a request from another site', async () => {
    const login = await harness.login()
    const response = await fetch(`${harness.gatewayUrl}/`, {
      headers: {
        host: 'strict.gateway.test',
        cookie: login.cookie,
        'sec-fetch-site': 'cross-site',
        origin: 'https://evil.example',
      },
    })
    expect(response.status).toBe(403)
    const body = (await response.json()) as { error: string }
    expect(body.error).toBe('cross_site_request')
  })

  test('the other routes still allow a navigation from another site', async () => {
    const login = await harness.login()
    const response = await fetch(`${harness.gatewayUrl}/`, {
      headers: {
        host: 'public.gateway.test',
        cookie: login.cookie,
        'sec-fetch-site': 'cross-site',
        origin: 'https://evil.example',
      },
    })
    expect(response.status).toBe(200)
  })

  test('the token of the caller reaches the upstream by default', async () => {
    const token = await harness.token()
    const response = await fetch(`${harness.gatewayUrl}/echo`, {
      headers: { host: 'api.gateway.test', authorization: `Bearer ${token}` },
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { headers: Record<string, string> }
    expect(body.headers.authorization).toBe(`Bearer ${token}`)
  })

  test('a route that does not need the token does not forward it', async () => {
    const token = await harness.token()
    const response = await fetch(`${harness.gatewayUrl}/echo`, {
      headers: { host: 'quiet.gateway.test', authorization: `Bearer ${token}` },
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { headers: Record<string, string> }
    expect(body.headers.authorization).toBeUndefined()
    // The identity of the caller still reaches the upstream.
    expect(body.headers['x-gateway-user']).toBe('user-alice')
  })

  test('the decision of the access service is cached by default', async () => {
    const token = await harness.token()
    const before = harness.access.requests.length
    for (let index = 0; index < 3; index++) {
      const response = await fetch(`${harness.gatewayUrl}/ws/${WORKSPACE_ID}/`, {
        headers: { host: 'workspace.gateway.test', authorization: `Bearer ${token}` },
      })
      expect(response.status).toBe(200)
    }
    // The service answered once: the decision was reused.
    expect(harness.access.requests.length - before).toBe(1)
  })

  test('a route that asks for no cache asks the service for every request', async () => {
    const token = await harness.token()
    const before = harness.access.requests.length
    for (let index = 0; index < 3; index++) {
      const response = await fetch(`${harness.gatewayUrl}/ws/${WORKSPACE_ID}/`, {
        headers: { host: 'uncached.gateway.test', authorization: `Bearer ${token}` },
      })
      expect(response.status).toBe(200)
    }
    // The revocation of that route is immediate: the service answered for
    // every request.
    expect(harness.access.requests.length - before).toBe(3)
  })

  test('the cookie of the gateway does not reach the upstream of a websocket', async () => {
    const login = await harness.login()
    const socket = new NodeWebSocket(`ws://localhost:${portOf(harness.gatewayUrl)}/socket/`, {
      headers: {
        host: 'socket.gateway.test',
        cookie: login.cookie,
        origin: 'http://socket.gateway.test',
      },
    })

    const message = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('the connection did not answer')), 5_000)
      socket.on('message', (data: Buffer) => {
        clearTimeout(timer)
        resolve(data.toString('utf8'))
      })
      socket.on('error', (error: Error) => {
        clearTimeout(timer)
        reject(error)
      })
    })
    socket.close()

    const greeting = JSON.parse(message) as { headers: Record<string, string> }
    // The session of the caller is a credential of the gateway: it never
    // reaches an upstream.
    expect(greeting.headers.cookie).toBeUndefined()
    // The identity of the caller does, written by the gateway.
    expect(greeting.headers['x-gateway-user']).toBe('user-alice')
  })
})
