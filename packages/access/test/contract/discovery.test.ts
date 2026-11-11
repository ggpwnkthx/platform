import { createHash, generateKeyPairSync } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { cookieOf, createTestClient, type TestClient } from '../fixtures/client'
import { startProviderFixture, type ProviderFixture } from '../fixtures/provider'
import { loginEnv, startTestRuntime, type TestRuntime } from '../fixtures/runtime'
import { tenantPayload } from '../fixtures/tenant'

/**
 * The address of the caller (spec §5.2.2).
 *
 * A shared client serves several tenants, and the tenant of a login is the
 * one the address of the caller belongs to. This file proves that the
 * caller is asked for the address, that the answer names the tenant, and
 * that the browser is sent to the provider of that tenant.
 */

/** The token of the administration of the tests. */
const ADMIN_TOKEN = 'the-admin-token'
/** The redirect uri of the gateway of the tests. */
const GATEWAY_REDIRECT = 'https://gateway-acme.example.com/auth/callback'

/** The verifier of the PKCE of the gateway of the tests. */
const VERIFIER = 'the-verifier-of-the-gateway'

/** The challenge of the PKCE of the gateway of the tests. */
const CHALLENGE = createHash('sha256').update(VERIFIER, 'ascii').digest('base64url')

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

/** The query of an authorization of the tests. */
function queryOf(overrides: Record<string, string> = {}): URLSearchParams {
  return new URLSearchParams({
    client_id: 'gateway-acme',
    redirect_uri: GATEWAY_REDIRECT,
    response_type: 'code',
    scope: 'openid profile email',
    state: 'the-state-of-the-gateway',
    nonce: 'the-nonce-of-the-gateway',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    ...overrides,
  })
}

/** Starts a login and returns the answer of the authorization. */
async function authorize(
  overrides: Record<string, string> = {}
): Promise<{ response: Response; cookie: string }> {
  const response = await fetch(`${service.base}/oauth/authorize?${queryOf(overrides).toString()}`, {
    redirect: 'manual',
  })
  return { response, cookie: cookieOf(response) }
}

beforeAll(async () => {
  provider = await startProviderFixture()
  service = await startTestRuntime(loginEnv(ADMIN_TOKEN, SIGNING_KEY))
  client = createTestClient(service.base, ADMIN_TOKEN)
  admin = async (path, method, body) => (await client.call(path, method, body)).body

  // The tenant that owns the client: the one the gateway is registered
  // with, and the one whose client is shared.
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
      sharedClient: true,
      emailDomain: 'acme.example',
    })
  )
  // The tenant the domain of the address names.
  await admin(
    '/v1/admin/tenants',
    'POST',
    tenantPayload({
      slug: 'other',
      displayName: 'Other Inc',
      issuer: provider.issuer,
      idpClientId: provider.clientId,
      idpClientSecret: provider.clientSecret,
      idpRedirectUri: `${service.base}/oauth/tenant/callback`,
      clientId: 'gateway-other',
      clientSecret: 'the-secret-of-the-other-gateway',
      clientRedirectUris: [],
      emailDomain: 'other.example',
    })
  )
  await admin('/v1/admin/users', 'POST', {
    tenant: 'other',
    externalSubject: provider.subject,
    email: 'alice@other.example',
    displayName: 'Alice',
  })
})

afterAll(async () => {
  await provider.stop()
  await service.stop()
})

describe('the address of the caller', () => {
  test('a shared client that names no tenant asks for the address', async () => {
    const { response } = await authorize()
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/oauth/discover')
  })

  test('the page asks for an address and for nothing else', async () => {
    const { cookie } = await authorize()
    const page = await fetch(`${service.base}/oauth/discover`, {
      redirect: 'manual',
      headers: { cookie },
    })
    expect(page.status).toBe(200)
    const body = await page.text()
    expect(body).toContain('name="email"')
    expect(body).toContain('action="/oauth/discover"')
    // The page names no tenant of the platform.
    expect(body).not.toContain('acme')
    expect(body).not.toContain('other')
  })

  test('a page without a login in flight is a refusal', async () => {
    const page = await fetch(`${service.base}/oauth/discover`, { redirect: 'manual' })
    expect(page.status).toBe(400)
    expect(await page.text()).toContain('login_state_invalid')
  })

  test('the address names the tenant of the login', async () => {
    const { cookie } = await authorize()
    const page = await fetch(`${service.base}/oauth/discover`, {
      redirect: 'manual',
      headers: { cookie },
    })
    const body = await page.text()
    const token = /name="token" value="([^"]+)"/.exec(body)?.[1] ?? ''
    expect(token).toBeTruthy()
    const answer = await fetch(`${service.base}/oauth/discover`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        cookie,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ email: 'alice@other.example', token }).toString(),
    })
    expect(answer.status).toBe(302)
    // The browser is sent to the provider of the tenant the domain of
    // the address names.
    const location = answer.headers.get('location') ?? ''
    expect(location).toContain(provider.issuer)
    // The state of the discovery is deleted: it is single use.
    const deleted = answer.headers.get('set-cookie') ?? ''
    expect(deleted).toContain('access_discovery_state=')
    expect(deleted).toContain('Max-Age=0')
  })

  test('an address that names no tenant is the default tenant of the platform', async () => {
    const { cookie } = await authorize()
    const page = await fetch(`${service.base}/oauth/discover`, {
      redirect: 'manual',
      headers: { cookie },
    })
    const body = await page.text()
    const token = /name="token" value="([^"]+)"/.exec(body)?.[1] ?? ''
    const answer = await fetch(`${service.base}/oauth/discover`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        cookie,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ email: 'alice@nowhere.example', token }).toString(),
    })
    expect(answer.status).toBe(302)
    // The browser is sent to the provider of the tenant of the client.
    expect(answer.headers.get('location') ?? '').toContain(provider.issuer)
  })

  test('an answer that carries no token is a refusal', async () => {
    const { cookie } = await authorize()
    const answer = await fetch(`${service.base}/oauth/discover`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        cookie,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        email: 'alice@other.example',
        token: 'the-token-of-nobody',
      }).toString(),
    })
    expect(answer.status).toBe(400)
    expect(await answer.text()).toContain('login_state_invalid')
  })

  test('a hint of the gateway names the tenant without a page', async () => {
    // The gateway knows the address of the caller: the login goes on
    // without asking for it.
    const { response } = await authorize({ login_hint: 'alice@other.example' })
    expect(response.status).toBe(302)
    expect(response.headers.get('location') ?? '').toContain(provider.issuer)
  })
})
