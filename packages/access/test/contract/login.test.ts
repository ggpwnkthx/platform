import { createHash, generateKeyPairSync } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { cookieOf, createTestClient, type TestClient } from '../fixtures/client'
import { startProviderFixture, type ProviderFixture } from '../fixtures/provider'
import { loginEnv, startTestRuntime, type TestRuntime } from '../fixtures/runtime'
import { tenantPayload } from '../fixtures/tenant'

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

/**
 * Starts a login and follows it until the callback.
 *
 * The browser goes to the authorization of the access service, then to the provider and
 * then back to the callback of the access service.
 */
async function startLogin(
  options: { clientId?: string; tenant?: string; scope?: string } = {}
): Promise<{ response: Response; cookie: string }> {
  const query = new URLSearchParams({
    client_id: options.clientId ?? 'gateway-acme',
    redirect_uri: GATEWAY_REDIRECT,
    response_type: 'code',
    scope: options.scope ?? 'openid profile email',
    state: 'the-state-of-the-gateway',
    nonce: 'the-nonce-of-the-gateway',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    ...(options.tenant ? { tenant: options.tenant } : {}),
  })
  const authorize = await fetch(`${service.base}/oauth/authorize?${query.toString()}`, {
    redirect: 'manual',
  })
  const cookie = cookieOf(authorize)
  if (authorize.status !== 302) return { response: authorize, cookie }
  const location = authorize.headers.get('location') ?? ''
  const atProvider = await fetch(location, { redirect: 'manual' })
  const callback = atProvider.headers.get('location') ?? ''
  const response = await fetch(callback, {
    redirect: 'manual',
    headers: { cookie },
  })
  return { response, cookie }
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

describe('the login of the access service', () => {
  test('a browser logs in at the provider and comes back with a code', async () => {
    const { response } = await startLogin()
    expect(response.status).toBe(302)
    const location = new URL(response.headers.get('location') ?? '')
    expect(location.origin + location.pathname).toBe(GATEWAY_REDIRECT)
    expect(location.searchParams.get('code')).toBeTruthy()
    expect(location.searchParams.get('state')).toBe('the-state-of-the-gateway')
  })

  test('a redirect uri that is not registered is refused', async () => {
    // The url the browser comes back to is a value the caller controls:
    // one that is not registered for the client is never sent a code, and
    // the browser is not sent to it either.
    const query = new URLSearchParams({
      client_id: 'gateway-acme',
      redirect_uri: 'https://evil.example/steal',
      response_type: 'code',
      scope: 'openid',
      state: 'the-state-of-the-gateway',
    })
    const response = await fetch(`${service.base}/oauth/authorize?${query.toString()}`, {
      redirect: 'manual',
    })
    expect(response.status).toBe(400)
    expect(response.headers.get('location')).toBeNull()
    expect(await response.text()).toContain('invalid_request')
  })

  test('the state cookie is deleted by the callback', async () => {
    const { response } = await startLogin()
    const cookie = response.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('access_login_state=')
    expect(cookie).toContain('Max-Age=0')
  })

  test('the gateway exchanges the code for the tokens', async () => {
    const { response } = await startLogin()
    const location = new URL(response.headers.get('location') ?? '')
    const code = location.searchParams.get('code') ?? ''
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
    expect(token.status).toBe(200)
    const body = (await token.json()) as Record<string, unknown>
    expect(typeof body.id_token).toBe('string')
    expect(typeof body.access_token).toBe('string')
    expect(body.token_type).toBe('Bearer')
    expect(body.expires_in).toBe(300)
  })

  test('the tokens are never stored by a cache', async () => {
    const { response } = await startLogin()
    const location = new URL(response.headers.get('location') ?? '')
    const token = await fetch(`${service.base}/oauth/token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${Buffer.from('gateway-acme:the-secret-of-the-gateway').toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: location.searchParams.get('code') ?? '',
        redirect_uri: GATEWAY_REDIRECT,
        code_verifier: VERIFIER,
      }).toString(),
    })
    expect(token.status).toBe(200)
    expect(token.headers.get('cache-control')).toBe('no-store')
    expect(token.headers.get('pragma')).toBe('no-cache')
  })

  test('a cookie that is not readable refuses the login', async () => {
    const response = await fetch(`${service.base}/oauth/tenant/callback?code=whatever`, {
      redirect: 'manual',
      headers: { cookie: 'access_login_state=%' },
    })
    expect(response.status).toBe(400)
    expect(await response.text()).toContain('login_state_invalid')
  })

  test('the same code exchanged twice is refused', async () => {
    const { response } = await startLogin()
    const location = new URL(response.headers.get('location') ?? '')
    const code = location.searchParams.get('code') ?? ''
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: GATEWAY_REDIRECT,
      code_verifier: VERIFIER,
    }).toString()
    const headers = {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from('gateway-acme:the-secret-of-the-gateway').toString('base64')}`,
    }
    expect(
      (await fetch(`${service.base}/oauth/token`, { method: 'POST', headers, body })).status
    ).toBe(200)
    const second = await fetch(`${service.base}/oauth/token`, { method: 'POST', headers, body })
    expect(second.status).toBe(400)
    expect(((await second.json()) as Record<string, unknown>).error).toBe('invalid_grant')
  })

  test('a client with a wrong secret is refused', async () => {
    const { response } = await startLogin()
    const location = new URL(response.headers.get('location') ?? '')
    const token = await fetch(`${service.base}/oauth/token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${Buffer.from('gateway-acme:wrong').toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: location.searchParams.get('code') ?? '',
        redirect_uri: GATEWAY_REDIRECT,
      }).toString(),
    })
    expect(token.status).toBe(401)
  })

  test('a code exchanged with another redirect uri is refused', async () => {
    const { response } = await startLogin()
    const location = new URL(response.headers.get('location') ?? '')
    const token = await fetch(`${service.base}/oauth/token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${Buffer.from('gateway-acme:the-secret-of-the-gateway').toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: location.searchParams.get('code') ?? '',
        redirect_uri: 'https://gateway-acme.example.com/auth/other',
      }).toString(),
    })
    expect(token.status).toBe(400)
    expect(((await token.json()) as Record<string, unknown>).error).toBe('invalid_grant')
  })

  test('a login without the state cookie is refused', async () => {
    const query = new URLSearchParams({
      client_id: 'gateway-acme',
      redirect_uri: GATEWAY_REDIRECT,
      response_type: 'code',
      scope: 'openid',
      state: 'the-state-of-the-gateway',
    })
    const authorize = await fetch(`${service.base}/oauth/authorize?${query.toString()}`, {
      redirect: 'manual',
    })
    const atProvider = await fetch(authorize.headers.get('location') ?? '', { redirect: 'manual' })
    const callback = await fetch(atProvider.headers.get('location') ?? '', { redirect: 'manual' })
    expect(callback.status).toBe(400)
    expect(await callback.text()).toContain('login_state_invalid')
  })

  test('a client that names no tenant is refused', async () => {
    const query = new URLSearchParams({
      client_id: 'gateway-unknown',
      redirect_uri: GATEWAY_REDIRECT,
      response_type: 'code',
      scope: 'openid',
    })
    const authorize = await fetch(`${service.base}/oauth/authorize?${query.toString()}`, {
      redirect: 'manual',
    })
    expect(authorize.status).toBe(400)
    expect(await authorize.text()).toContain('invalid_request')
  })
})
