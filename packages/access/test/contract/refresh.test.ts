import { createHash, generateKeyPairSync } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { cookieOf, createTestClient, type TestClient } from '../fixtures/client'
import { startProviderFixture, type ProviderFixture } from '../fixtures/provider'
import { loginEnv, startTestRuntime, type TestRuntime } from '../fixtures/runtime'
import { tenantPayload } from '../fixtures/tenant'

/** The token of the administration of the tests. */
const ADMIN_TOKEN = 'the-admin-token'
/** The redirect uri of the client of the tests. */
const GATEWAY_REDIRECT = 'https://gateway-acme.example.com/auth/callback'

/** The verifier of the PKCE of the client of the tests. */
const VERIFIER = 'the-verifier-of-the-gateway'

/** The challenge of the PKCE of the client of the tests. */
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

/**
 * Starts a login and follows it until the callback.
 *
 * The browser goes to the authorization of Access, then to the provider and
 * then back to the callback of Access.
 */
async function startLogin(scope: string): Promise<string> {
  const query = new URLSearchParams({
    client_id: 'gateway-acme',
    redirect_uri: GATEWAY_REDIRECT,
    response_type: 'code',
    scope,
    state: 'the-state-of-the-gateway',
    nonce: 'the-nonce-of-the-gateway',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
  })
  const authorize = await fetch(`${service.base}/oauth/authorize?${query.toString()}`, {
    redirect: 'manual',
  })
  const cookie = cookieOf(authorize)
  const atProvider = await fetch(authorize.headers.get('location') ?? '', { redirect: 'manual' })
  const callback = atProvider.headers.get('location') ?? ''
  const response = await fetch(callback, { redirect: 'manual', headers: { cookie } })
  const location = new URL(response.headers.get('location') ?? '')
  return location.searchParams.get('code') ?? ''
}

/** Exchanges a code for the tokens of the client of the tests. */
async function exchange(code: string): Promise<Record<string, unknown>> {
  const token = await fetch(`${service.base}/oauth/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from('gateway-acme:the-secret-of-the-gateway').toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: GATEWAY_REDIRECT,
      code_verifier: VERIFIER,
    }).toString(),
  })
  return (await token.json()) as Record<string, unknown>
}

/** Exchanges a refresh token for new tokens. */
async function refresh(refreshToken: string, clientId = 'gateway-acme'): Promise<Response> {
  return await fetch(`${service.base}/oauth/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${clientId}:the-secret-of-the-gateway`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }).toString(),
  })
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

describe('the refresh tokens of Access', () => {
  test('a login that asks for the scope is given a refresh token', async () => {
    const code = await startLogin('openid profile email groups offline_access')
    const body = await exchange(code)
    expect(typeof body.refresh_token).toBe('string')
    expect(typeof body.access_token).toBe('string')
    expect(body.expires_in).toBe(300)
  })

  test('a login that asks for no scope is given no refresh token', async () => {
    const code = await startLogin('openid profile email groups')
    const body = await exchange(code)
    expect(body.refresh_token).toBeUndefined()
  })

  test('a refresh token is exchanged for new tokens', async () => {
    const code = await startLogin('openid profile email groups offline_access')
    const body = await exchange(code)
    const answer = await refresh(String(body.refresh_token))
    expect(answer.status).toBe(200)
    const tokens = (await answer.json()) as Record<string, unknown>
    expect(typeof tokens.access_token).toBe('string')
    expect(tokens.expires_in).toBe(300)
    // The token that was presented is spent: the exchange issues
    // another one.
    expect(typeof tokens.refresh_token).toBe('string')
    expect(tokens.refresh_token).not.toBe(body.refresh_token)
  })

  test('the new token is accepted by the service', async () => {
    const code = await startLogin('openid profile email groups offline_access')
    const body = await exchange(code)
    const answer = await refresh(String(body.refresh_token))
    const tokens = (await answer.json()) as Record<string, unknown>
    const userinfo = await fetch(`${service.base}/oauth/userinfo`, {
      headers: { authorization: `Bearer ${String(tokens.access_token)}` },
    })
    expect(userinfo.status).toBe(200)
    expect(typeof ((await userinfo.json()) as Record<string, unknown>).sub).toBe('string')
  })

  test('the tokens are never stored by a cache', async () => {
    const code = await startLogin('openid profile email groups offline_access')
    const body = await exchange(code)
    const answer = await refresh(String(body.refresh_token))
    expect(answer.headers.get('cache-control')).toBe('no-store')
    expect(answer.headers.get('pragma')).toBe('no-cache')
  })

  test('a refresh token is single use: the second exchange is refused', async () => {
    const code = await startLogin('openid profile email groups offline_access')
    const body = await exchange(code)
    const token = String(body.refresh_token)
    expect((await refresh(token)).status).toBe(200)
    const second = await refresh(token)
    expect(second.status).toBe(400)
    expect(((await second.json()) as Record<string, unknown>).error).toBe('invalid_grant')
  })

  test('an unknown refresh token is refused', async () => {
    const answer = await refresh('the-token-of-nobody')
    expect(answer.status).toBe(400)
    expect(((await answer.json()) as Record<string, unknown>).error).toBe('invalid_grant')
  })

  test('a refresh token without the grant type is refused', async () => {
    const code = await startLogin('openid profile email groups offline_access')
    const body = await exchange(code)
    const answer = await fetch(`${service.base}/oauth/token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${Buffer.from('gateway-acme:the-secret-of-the-gateway').toString('base64')}`,
      },
      body: new URLSearchParams({ refresh_token: String(body.refresh_token) }).toString(),
    })
    expect(answer.status).toBe(400)
    expect(((await answer.json()) as Record<string, unknown>).error).toBe('invalid_request')
  })

  test('a client with a wrong secret is refused', async () => {
    const code = await startLogin('openid profile email groups offline_access')
    const body = await exchange(code)
    const answer = await fetch(`${service.base}/oauth/token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${Buffer.from('gateway-acme:wrong').toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: String(body.refresh_token),
      }).toString(),
    })
    expect(answer.status).toBe(401)
  })
})
