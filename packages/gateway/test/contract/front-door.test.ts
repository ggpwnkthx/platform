import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createHarness, type Harness } from '../support/contract-harness'

/**
 * The gateway as the front door of the platform.
 *
 * A deployment where the gateway is the only public service of the
 * platform serves more than one name, and the names belong to the
 * services behind it: the name of the console, the name of the issuer.
 *
 * Two things follow from it, and they are what these tests prove:
 *
 * - the endpoints of the gateway answer on the names of the gateway and on
 *   no other name: the path of the callback of the console belongs to the
 *   console, and the route table claims it;
 * - a route that forwards to a service of the platform sends the name the
 *   caller asked for: the service is reached under the name it is reached
 *   under by the caller.
 */
let harness: Harness

beforeAll(async () => {
  harness = await createHarness({
    config: (context) => ({
      version: 2,
      hosts: ['api.gateway.test'],
      defaults: {
        auth: { mode: 'none' },
        timeouts: { responseMs: 5000, firstByteMs: 30000, bodyMs: 300000 },
        maxBodyBytes: 1024 * 1024,
      },
      trustedProxies: ['127.0.0.1/32'],
      routes: [
        {
          id: 'api',
          match: { host: 'api.gateway.test', path: '/ws/{workspaceId}/v1/{rest}' },
          upstream: context.upstreamA,
          auth: { mode: 'none' },
        },
        {
          id: 'console',
          match: { host: 'console.gateway.test', path: '/auth/callback' },
          upstream: context.upstreamB,
          auth: { mode: 'none' },
          upstreamHost: 'original',
        },
        {
          id: 'issuer',
          match: { host: 'issuer.gateway.test', path: '/.well-known/{rest}' },
          upstream: context.upstreamB,
          auth: { mode: 'none' },
          upstreamHost: 'original',
        },
        {
          id: 'internal',
          match: { host: 'internal.gateway.test', path: '/thing' },
          upstream: context.upstreamA,
          auth: { mode: 'none' },
        },
      ],
    }),
  })
})

afterAll(async () => {
  await harness.stop()
})

describe('the gateway as the front door of the platform', () => {
  test('the login answers on the name of the gateway', async () => {
    const response = await fetch(`${harness.gatewayUrl}/auth/login`, {
      headers: { host: 'api.gateway.test' },
      redirect: 'manual',
    })
    expect(response.status).toBe(302)
  })

  test('the login does not answer on another name', async () => {
    const response = await fetch(`${harness.gatewayUrl}/auth/login`, {
      headers: { host: 'console.gateway.test' },
      redirect: 'manual',
    })
    expect(response.status).toBe(404)
  })

  test('the document of the api answers on the name of the gateway', async () => {
    const response = await fetch(`${harness.gatewayUrl}/openapi.json`, {
      headers: { host: 'api.gateway.test' },
    })
    expect(response.status).toBe(200)
  })

  test('the document of the api does not answer on another name', async () => {
    const response = await fetch(`${harness.gatewayUrl}/openapi.json`, {
      headers: { host: 'console.gateway.test' },
    })
    expect(response.status).toBe(404)
  })

  test('the health of the gateway answers on every name', async () => {
    const response = await fetch(`${harness.gatewayUrl}/healthz`, {
      headers: { host: 'console.gateway.test' },
    })
    expect(response.status).toBe(200)
  })

  test('the path of the callback belongs to the service of the name', async () => {
    const response = await fetch(`${harness.gatewayUrl}/auth/callback`, {
      headers: { host: 'console.gateway.test' },
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { service: string }
    expect(body.service).toBe('upstream-b')
  })

  test('the upstream receives the name the caller asked for', async () => {
    const response = await fetch(`${harness.gatewayUrl}/.well-known/openid-configuration`, {
      headers: { host: 'issuer.gateway.test' },
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { headers: Record<string, string> }
    expect(body.headers.host).toBe('issuer.gateway.test')
  })

  test('the upstream receives its own address by default', async () => {
    const response = await fetch(`${harness.gatewayUrl}/thing`, {
      headers: { host: 'internal.gateway.test' },
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { headers: Record<string, string> }
    expect(body.headers.host).not.toBe('internal.gateway.test')
    expect(body.headers.host).toContain('127.0.0.1')
  })
})
