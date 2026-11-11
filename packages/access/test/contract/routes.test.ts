import { generateKeyPairSync } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { cookieOf, createTestClient, type TestClient } from '../fixtures/client'
import { startProviderFixture, type ProviderFixture } from '../fixtures/provider'
import { loginEnv, startTestRuntime, type TestRuntime } from '../fixtures/runtime'
import { tenantPayload } from '../fixtures/tenant'

/**
 * The routes of the logins (spec §3.13, §10.18).
 *
 * A route names the tenant of a login and the provider the login signs in
 * at. A route is a hint that the platform proves before it routes
 * anything: a route that waits for its proof routes nothing, and the
 * login of an address that names no verified route goes on with the
 * default tenant of the platform.
 *
 * This file proves that the routes are written, that they wait for their
 * proof, that the proof of a domain is the record its owner publishes,
 * and that a verified route names the tenant and the provider of a login.
 */

/** The token of the administration of the tests. */
const ADMIN_TOKEN = 'the-admin-token'
/** The redirect uri of the gateway of the tests. */
const GATEWAY_REDIRECT = 'https://gateway-acme.example.com/auth/callback'

/** The private key of the service of the tests. */
const SIGNING_KEY = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
}).privateKey

let service: TestRuntime
let client: TestClient
let provider: ProviderFixture

/** Calls the administration of the tests. */
let admin: (
  path: string,
  method: string,
  body: Record<string, unknown>
) => Promise<Record<string, unknown>>

/** Calls the administration of the tests and answers the status. */
let call: (
  path: string,
  method: string,
  body?: Record<string, unknown>
) => Promise<{ status: number; body: Record<string, unknown> }>

beforeAll(async () => {
  provider = await startProviderFixture()
  service = await startTestRuntime(loginEnv(ADMIN_TOKEN, SIGNING_KEY))
  client = createTestClient(service.base, ADMIN_TOKEN)
  admin = async (path, method, body) => (await client.call(path, method, body)).body
  call = async (path, method, body) => await client.call(path, method, body)

  await admin(
    '/v1/admin/tenants',
    'POST',
    tenantPayload({
      issuer: provider.issuer,
      idpClientId: provider.clientId,
      idpClientSecret: provider.clientSecret,
      idpRedirectUri: `${service.base}/oauth/tenant/callback`,
      clientSecret: 'the-secret-of-the-gateway',
      clientRedirectUris: [GATEWAY_REDIRECT],
      emailDomain: 'acme.example',
    })
  )
})

afterAll(async () => {
  await provider.stop()
  await service.stop()
})

describe('the routes of the logins', () => {
  test('a route that is created waits for its proof', async () => {
    const written = await admin('/v1/admin/routes', 'POST', {
      tenant: 'acme',
      kind: 'domain',
      key: 'routes.example',
    })
    const route = written.route as { id: string; status: string; challenge: string }
    expect(route.status).toBe('pending')
    // The challenge is the token the owner of the domain publishes.
    expect(route.challenge).toBeTruthy()
  })

  test('the routes of the tenant are listed', async () => {
    const listed = await admin('/v1/admin/routes?tenant=acme', 'GET', {})
    const routes = (listed.routes ?? []) as { key: string; status: string }[]
    expect(routes.some((route) => route.key === 'routes.example')).toBe(true)
  })

  test('a route of the same tenant is changed', async () => {
    // The key of a route is unique: a domain names one route, and the
    // call that names it again changes it.
    const changed = await call('/v1/admin/routes', 'POST', {
      tenant: 'acme',
      kind: 'domain',
      key: 'routes.example',
    })
    expect(changed.status).toBe(200)
    const route = changed.body.route as { status: string }
    // The route waits for its proof again.
    expect(route.status).toBe('pending')
  })

  test('the operator of the platform vouches for a domain', async () => {
    const listed = await admin('/v1/admin/routes?tenant=acme', 'GET', {})
    const routes = (listed.routes ?? []) as { id: string; key: string }[]
    const route = routes.find((row) => row.key === 'routes.example')!
    const verified = await admin(`/v1/admin/routes/${route.id}/verify`, 'POST', {
      status: 'verified',
      verification: 'operator',
    })
    const answer = verified.route as { status: string; verification: string }
    expect(answer.status).toBe('verified')
    expect(answer.verification).toBe('operator')
  })

  test('the proof of a domain is the record its owner publishes', async () => {
    const written = await admin('/v1/admin/routes', 'POST', {
      tenant: 'acme',
      kind: 'domain',
      key: 'unproven.example',
    })
    const route = written.route as { id: string; challenge: string }
    // The record of the domain does not carry the challenge: the owner of
    // the domain has not published it yet.
    const answer = await call(`/v1/admin/routes/${route.id}/verify`, 'POST', {
      status: 'verified',
      verification: 'dns',
    })
    expect(answer.status).toBe(409)
    expect(answer.body.message).toContain('challenge')
  })

  test('the proof of an address is the operator of the platform', async () => {
    const written = await admin('/v1/admin/routes', 'POST', {
      tenant: 'acme',
      kind: 'address',
      key: 'alice@partner.example',
    })
    const route = written.route as { id: string }
    const answer = await call(`/v1/admin/routes/${route.id}/verify`, 'POST', {
      status: 'verified',
      verification: 'dns',
    })
    expect(answer.status).toBe(400)
    expect(answer.body.message).toContain('domain')
  })

  test('a key that is neither a domain nor an address is refused', async () => {
    const answer = await call('/v1/admin/routes', 'POST', {
      tenant: 'acme',
      kind: 'domain',
      key: 'not a domain',
    })
    expect(answer.status).toBe(400)
  })

  test('a verified route names the provider of the login', async () => {
    // The tenant signs its people in at a second provider, and the
    // domain of the route names it.
    await admin('/v1/admin/providers', 'POST', {
      tenant: 'acme',
      slug: 'okta',
      displayName: 'Okta',
      issuer: provider.issuer,
      idpClientId: provider.clientId,
      idpClientSecret: provider.clientSecret,
      idpRedirectUri: `${service.base}/oauth/tenant/callback`,
    })
    const written = await admin('/v1/admin/routes', 'POST', {
      tenant: 'acme',
      kind: 'domain',
      key: 'partners.example',
      provider: 'okta',
    })
    const route = written.route as { id: string }
    await admin(`/v1/admin/routes/${route.id}/verify`, 'POST', {
      status: 'verified',
      verification: 'operator',
    })

    // The login of an address of that domain goes to the provider of the
    // route, and it does not ask the caller for its address.
    const query = new URLSearchParams({
      client_id: 'gateway-acme',
      redirect_uri: GATEWAY_REDIRECT,
      response_type: 'code',
      scope: 'openid profile email',
      state: 'the-state-of-the-gateway',
      nonce: 'the-nonce-of-the-gateway',
      login_hint: 'alice@partners.example',
    })
    const authorize = await fetch(`${service.base}/oauth/authorize?${query.toString()}`, {
      redirect: 'manual',
    })
    expect(authorize.status).toBe(302)
    expect(authorize.headers.get('location') ?? '').not.toBe('/oauth/discover')

    // The provider is removed again: the tests that follow log in at the
    // only provider of the tenant.
    const providers = await admin('/v1/admin/providers?tenant=acme&slug=okta', 'GET', {})
    const rows = (providers.providers ?? []) as { id: string }[]
    await client.call(`/v1/admin/providers/${rows[0]!.id}`, 'DELETE', undefined)
  })

  test('a route that waits for its proof routes nothing', async () => {
    // The domain of the route is not proven: the address of the caller
    // names no tenant, and the login goes on with the default one.
    const query = new URLSearchParams({
      client_id: 'gateway-acme',
      redirect_uri: GATEWAY_REDIRECT,
      response_type: 'code',
      scope: 'openid profile email',
      state: 'the-state-of-the-gateway',
      nonce: 'the-nonce-of-the-gateway',
      login_hint: 'alice@unproven.example',
    })
    const authorize = await fetch(`${service.base}/oauth/authorize?${query.toString()}`, {
      redirect: 'manual',
    })
    expect(authorize.status).toBe(302)
    expect(authorize.headers.get('location') ?? '').not.toBe('/oauth/discover')
    expect(cookieOf(authorize)).toBeTruthy()
  })
})
