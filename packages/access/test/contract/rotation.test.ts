import { createHash, generateKeyPairSync } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createTestClient, type TestClient } from '../fixtures/client'
import { startProviderFixture, type ProviderFixture } from '../fixtures/provider'
import { loginEnv, startTestRuntime, type TestRuntime } from '../fixtures/runtime'
import { tenantPayload } from '../fixtures/tenant'

/**
 * The rotation of the keys of a provider (spec §6.6).
 *
 * A real provider rotates its signing key: it publishes a new key and it
 * signs with it. The keys of a provider are cached for ten minutes, so a
 * token that names a key that the cache does not have is the sign of a
 * rotation and not a bad token.
 */
const ADMIN_TOKEN = 'the-admin-token'
const GATEWAY_REDIRECT = 'https://gateway-acme.example.com/auth/callback'
const VERIFIER = 'the-verifier-of-the-gateway'
const CHALLENGE = createHash('sha256').update(VERIFIER, 'ascii').digest('base64url')
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

/** Starts a login and follows it until the callback. */
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
  const cookie = (authorize.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
  const atProvider = await fetch(authorize.headers.get('location') ?? '', { redirect: 'manual' })
  const callback = atProvider.headers.get('location') ?? ''
  return await fetch(callback, { redirect: 'manual', headers: { cookie } })
}

beforeAll(async () => {
  provider = await startProviderFixture()
  service = await startTestRuntime(loginEnv(ADMIN_TOKEN, SIGNING_KEY))
  client = createTestClient(service.base, ADMIN_TOKEN)
  admin = async (path, method, body) => (await client.call(path, method, body)).body

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
    })
  )
  await admin('/v1/admin/users', 'POST', {
    tenant: 'acme',
    externalSubject: provider.subject,
    email: 'alice@acme.example',
    displayName: 'Alice',
  })
})

afterAll(async () => {
  await provider.stop()
  await service.stop()
})

describe('the rotation of the keys of a provider', () => {
  test('a login works before the rotation', async () => {
    const response = await startLogin()
    expect(response.status).toBe(302)
    expect(new URL(response.headers.get('location') ?? '').searchParams.get('code')).toBeTruthy()
  })

  test('a login works after the rotation of the key of the provider', async () => {
    // The provider publishes a new key and signs with it.
    provider.rotate()
    const response = await startLogin()
    expect(response.status).toBe(302)
    const location = new URL(response.headers.get('location') ?? '')
    expect(location.searchParams.get('code')).toBeTruthy()
    // The login was not refused: the page of a refusal is not a
    // redirection.
    expect(location.origin + location.pathname).toBe(GATEWAY_REDIRECT)
  })

  test('the keys of the provider are not read on every login', async () => {
    const reads = provider.keyReads()
    const discoveries = provider.discoveries()
    await startLogin()
    await startLogin()
    // The discovery document and the keys are cached for ten minutes: two
    // logins do not call the provider twice.
    expect(provider.keyReads()).toBe(reads)
    expect(provider.discoveries()).toBe(discoveries)
  })
})
