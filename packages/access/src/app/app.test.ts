import { describe, expect, test } from 'bun:test'
import { createAccessApp } from './app'
import type { AccessDependencies } from './dependencies'
import { createSilentLogger } from '../observability'

/** The dependencies of the tests. */
function dependencies(): AccessDependencies {
  return {
    version: '1.0.0',
    logger: createSilentLogger(),
    observer: {
      recordDecision: () => undefined,
      recordAdminRequest: () => undefined,
      recordStoreError: () => undefined,
      recordLogin: () => undefined,
      render: async () => '',
      contentType: 'text/plain',
    },
    probe: { ready: async () => true },
    isDraining: () => false,
    administration: {} as AccessDependencies['administration'],
    provider: {} as AccessDependencies['provider'],
    decisions: { decide: async () => ({}) as never },
    accessContexts: { context: async () => ({}) as never },
    accessContextCredentials: [],
    login: {} as AccessDependencies['login'],
    codes: {} as AccessDependencies['codes'],
    tenants: {} as AccessDependencies['tenants'],
    cookieSecure: false,
    publicUrl: 'https://access.example.com',
    peerAddress: () => '127.0.0.1',
    sharedTokenNoticeWritten: false,
  }
}

describe('the application of Access', () => {
  test('the application answers a request', async () => {
    const app = createAccessApp(dependencies())
    const response = await app.fetch(new Request('http://access.example.com/healthz'))
    expect(response.status).toBe(200)
  })
})

describe('the administration of the application', () => {
  test('a store that is down refuses the call', async () => {
    const deps = dependencies()
    deps.administration = {
      authenticate: async () => {
        throw new Error('the shared store is not reachable')
      },
    } as unknown as AccessDependencies['administration']
    const app = createAccessApp(deps)
    const response = await app.fetch(
      new Request('http://access.example.com/v1/admin/tenants', {
        method: 'POST',
        headers: { authorization: 'Bearer the-admin-token', 'content-type': 'application/json' },
        body: JSON.stringify({ slug: 'acme' }),
      })
    )
    expect(response.status).toBe(503)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.error).toBe('service_unavailable')
  })
})
