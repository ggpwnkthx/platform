import { createHash, generateKeyPairSync } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { cookieOf, createTestClient, type TestClient } from '../fixtures/client'
import { startProviderFixture, type ProviderFixture } from '../fixtures/provider'
import { loginEnv, startTestRuntime, type TestRuntime } from '../fixtures/runtime'
import { tenantPayload } from '../fixtures/tenant'

/**
 * The administration of a tenant, handed to its first identity
 * (spec §6.4).
 *
 * A tenant that provisions the identities that sign in may hand the
 * administration of the tenant to the first one of them: the principal
 * that is created first is given the right to administer the tenant, and
 * the ones that come after are given nothing.
 */

/** The token of the administration of the tests. */
const ADMIN_TOKEN = 'the-admin-token'
/** The token of the metrics of the tests. */
const METRICS_TOKEN = 'the-metrics-token'
/** The redirect uri of the gateway of the tests. */
const GATEWAY_REDIRECT = 'https://gateway-acme.example.com/auth/callback'

/** The challenge of the PKCE of the gateway of the tests. */
const CHALLENGE = createHash('sha256')
  .update('the-verifier-of-the-gateway', 'ascii')
  .digest('base64url')

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
  body?: Record<string, unknown>
) => Promise<{ status: number; body: Record<string, unknown> }>

/**
 * Starts a login and follows it until the callback.
 *
 * The browser goes to the authorization of Access, then to the provider
 * and then back to the callback of Access.
 */
async function startLogin(): Promise<Response> {
  const query = new URLSearchParams({
    client_id: 'gateway-acme',
    redirect_uri: GATEWAY_REDIRECT,
    response_type: 'code',
    scope: 'openid profile email',
    state: 'the-state-of-the-gateway',
    nonce: 'the-nonce-of-the-gateway',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
  })
  const authorize = await fetch(`${service.base}/oauth/authorize?${query.toString()}`, {
    redirect: 'manual',
  })
  const cookie = cookieOf(authorize)
  if (authorize.status !== 302) return authorize
  const atProvider = await fetch(authorize.headers.get('location') ?? '', { redirect: 'manual' })
  const callback = await fetch(atProvider.headers.get('location') ?? '', {
    redirect: 'manual',
    headers: { cookie },
  })
  return callback
}

/** The grants of the tenant of the tests. */
async function grantsOfTenant(): Promise<Record<string, unknown>[]> {
  const answer = await admin('/v1/admin/grants?tenant=acme', 'GET')
  return (answer.body.grants ?? []) as Record<string, unknown>[]
}

/**
 * The value of a metric of the service.
 *
 * The value is the sum of the samples of the metric.
 */
async function metric(name: string): Promise<number> {
  const response = await fetch(`${service.base}/metrics`, {
    headers: { authorization: `Bearer ${METRICS_TOKEN}` },
  })
  const text = await response.text()
  let total = 0
  for (const line of text.split('\n')) {
    if (!line.startsWith(name)) continue
    const value = Number(line.trim().split(/\s+/).at(-1))
    if (Number.isFinite(value)) total += value
  }
  return total
}

beforeAll(async () => {
  provider = await startProviderFixture()
  service = await startTestRuntime({
    ...loginEnv(ADMIN_TOKEN, SIGNING_KEY),
    ACCESS_METRICS_TOKEN: METRICS_TOKEN,
  })
  client = createTestClient(service.base, ADMIN_TOKEN)
  admin = async (path, method, body) => await client.call(path, method, body)

  await admin(
    '/v1/admin/tenants',
    'POST',
    tenantPayload({
      issuer: provider.issuer,
      idpClientId: provider.clientId,
      idpClientSecret: provider.clientSecret,
      idpRedirectUri: `${service.base}/oauth/tenant/callback`,
      clientSecret: 'the-secret-of-the-gateway',
      clientRedirectUris: ['https://gateway-acme.example.com/auth/callback'],
      autoProvision: true,
      // The tenant names no flag for the administration of itself: the
      // default gives the administration of the tenant to the first
      // identity that signs in at it (§6.4).
    })
  )
})

afterAll(async () => {
  await provider.stop()
  await service.stop()
})

describe('the administration of a tenant', () => {
  test('the first identity that signs in is given the administration of the tenant', async () => {
    const response = await startLogin()
    expect(response.status).toBe(302)

    const grants = await grantsOfTenant()
    expect(grants.length).toBe(1)
    // The grant names the role that administers the tenant, and the role
    // holds the permission that opens the administration (§6.4).
    expect(grants[0]?.role).toBe('admin')
    expect(grants[0]?.permission).toBeNull()
    expect(grants[0]?.workspaceId).toBe('acme')
    expect(grants[0]?.routeId).toBeNull()
    expect(grants[0]?.userId).toBeTruthy()
  })

  test('the tenant holds the role that administers it', async () => {
    const roles = await admin('/v1/admin/roles?tenant=acme', 'GET')
    const rows = (roles.body.roles ?? []) as Record<string, unknown>[]
    expect(rows.length).toBe(1)
    expect(rows[0]?.key).toBe('admin')
    expect(rows[0]?.permissions).toEqual([
      'console.admin',
      'console.status',
      'data.audit.read',
      'data.model.read',
      'data.model.write',
      'data.workspace.create',
    ])
  })

  test('the identities that come after it are given nothing', async () => {
    // The tenant has an administrator already: the second identity of
    // the tenant is given nothing.
    provider.authenticateAs('the-second-subject')
    const response = await startLogin()
    expect(response.status).toBe(302)

    const grants = await grantsOfTenant()
    expect(grants.length).toBe(1)
  })

  test('the principal of the first identity is the one that holds the administration', async () => {
    const principals = await admin('/v1/admin/users?tenant=acme', 'GET')
    const rows = (principals.body.principals ?? []) as Record<string, unknown>[]
    expect(rows.length).toBe(2)

    const grants = await grantsOfTenant()
    const holder = rows.find((row) => row.id === grants[0]?.userId)
    expect(holder?.email).toBe('alice@acme.example')
  })

  test('the login is counted and the principal it created is audited', async () => {
    // The login is a fact of the tenant: the metric counts it, and the
    // audit of the tenant holds the principal it created.
    expect(await metric('access_logins_total{result="success"')).toBe(2)

    const audit = await admin('/v1/admin/audit?tenant=acme', 'GET')
    const rows = (audit.body.records ?? []) as Record<string, unknown>[]
    const created = rows.filter((row) => row.action === 'principal.created')
    expect(created.length).toBe(2)
    expect(created[0]?.operator).toBe('alice@acme.example')
  })
})
