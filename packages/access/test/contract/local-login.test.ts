import { createHash, generateKeyPairSync } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createTestClient, type TestClient } from '../fixtures/client'
import { loginEnv, startTestRuntime, type TestRuntime } from '../fixtures/runtime'
import { tenantPayload } from '../fixtures/tenant'

/**
 * The sign-in at a local provider (spec §5.4).
 *
 * The caller signs in with an address and a password, the service checks
 * the password against the verifier of the credential, and the browser
 * comes back to the gateway with a code. The whole flow is walked here,
 * with the cookies of the browser and the form of the page.
 */

/** The token of the administration of the tests. */
const ADMIN_TOKEN = 'the-admin-token'

/** The redirect uri of the gateway of the tests. */
const GATEWAY_REDIRECT = 'https://gateway-acme.example.com/auth/callback'

/** The verifier of the PKCE of the gateway. */
const VERIFIER = 'the-verifier-of-the-gateway'

/** The challenge of the PKCE of the gateway. */
const CHALLENGE = createHash('sha256').update(VERIFIER, 'ascii').digest('base64url')

/** The password of the credential of the tests. */
const PASSWORD = 'the-password-of-the-account'

/** The private key of the service of the tests. */
const SIGNING_KEY = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
}).privateKey

let service: TestRuntime
let client: TestClient

/** Calls the administration of the tests. */
let admin: (
  path: string,
  method: string,
  body: Record<string, unknown>
) => Promise<Record<string, unknown>>

/** The cookies of the browser, by name. */
function cookiesOf(response: Response): Map<string, string> {
  const cookies = new Map<string, string>()
  for (const header of response.headers.getSetCookie()) {
    const [pair] = header.split(';')
    const [name, ...rest] = (pair ?? '').split('=')
    if (name) cookies.set(name, rest.join('='))
  }
  return cookies
}

/** The value of the cookie of the browser. */
function cookieHeader(cookies: Map<string, string>): string {
  return [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ')
}

beforeAll(async () => {
  service = await startTestRuntime(loginEnv(ADMIN_TOKEN, SIGNING_KEY))
  client = createTestClient(service.base, ADMIN_TOKEN)
  admin = async (path, method, body) => (await client.call(path, method, body)).body

  await admin(
    '/v1/admin/tenants',
    'POST',
    tenantPayload({
      clientSecret: 'the-secret-of-the-gateway',
      clientRedirectUris: ['https://gateway-acme.example.com/auth/callback'],
    })
  )
  await admin('/v1/admin/providers', 'POST', {
    tenant: 'acme',
    kind: 'local',
    slug: 'local',
    displayName: 'The accounts of the tenant',
  })
  await admin('/v1/admin/credentials', 'POST', {
    tenant: 'acme',
    provider: 'local',
    email: 'alice@acme.example',
    password: PASSWORD,
  })
})

afterAll(async () => {
  await service.stop()
})

describe('the sign-in at a local provider', () => {
  test('a caller signs in with its address and its password', async () => {
    // 1. The browser asks to sign in at the local provider.
    const query = new URLSearchParams({
      client_id: 'gateway-acme',
      redirect_uri: GATEWAY_REDIRECT,
      response_type: 'code',
      scope: 'openid profile email',
      state: 'the-state-of-the-gateway',
      nonce: 'the-nonce-of-the-gateway',
      code_challenge: CHALLENGE,
      code_challenge_method: 'S256',
      provider: 'local',
    })
    const authorize = await fetch(`${service.base}/oauth/authorize?${query.toString()}`, {
      redirect: 'manual',
    })
    expect(authorize.status).toBe(302)
    const cookies = cookiesOf(authorize)
    // The state of the login travels in two cookies: the one of the
    // callback and the one of the page.
    expect(cookies.has('access_login_state')).toBe(true)
    expect(cookies.has('access_local_state')).toBe(true)
    expect(authorize.headers.get('location')).toContain('/oauth/local/authorize')

    // 2. The browser reads the page of the password.
    const page = await fetch(`${service.base}/oauth/local/authorize`, {
      headers: { cookie: cookieHeader(cookies) },
    })
    expect(page.status).toBe(200)
    const form = await page.text()
    expect(form).toContain('name="email"')
    expect(form).toContain('name="password"')
    const token = /name="token" value="([^"]+)"/.exec(form)?.[1] ?? ''
    expect(token).toBeTruthy()

    // 3. The browser posts the form.
    const login = await fetch(`${service.base}/oauth/local/login`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        cookie: cookieHeader(cookies),
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        token,
        email: 'alice@acme.example',
        password: PASSWORD,
      }).toString(),
    })
    expect(login.status).toBe(302)
    const redirect = login.headers.get('location') ?? ''
    expect(redirect).toContain('/oauth/tenant/callback')
    expect(redirect).toContain('code=')
    // The redirect stays on the origin of the service.
    expect(redirect.startsWith('/')).toBe(true)
    const callback = new URL(redirect, service.base)

    // 4. The browser comes back to the callback, with the state of the
    // login.
    const finished = await fetch(callback, {
      redirect: 'manual',
      headers: { cookie: cookieHeader(cookies) },
    })
    expect(finished.status).toBe(302)
    const location = new URL(finished.headers.get('location') ?? '')
    expect(location.origin + location.pathname).toBe(GATEWAY_REDIRECT)
    expect(location.searchParams.get('code')).toBeTruthy()
    expect(location.searchParams.get('state')).toBe('the-state-of-the-gateway')
  })

  test('a wrong password is refused, and the answer says nothing about the accounts', async () => {
    const query = new URLSearchParams({
      client_id: 'gateway-acme',
      redirect_uri: GATEWAY_REDIRECT,
      response_type: 'code',
      scope: 'openid',
      state: 'the-state-of-the-gateway',
      nonce: 'the-nonce-of-the-gateway',
      code_challenge: CHALLENGE,
      code_challenge_method: 'S256',
      provider: 'local',
    })
    const authorize = await fetch(`${service.base}/oauth/authorize?${query.toString()}`, {
      redirect: 'manual',
    })
    const cookies = cookiesOf(authorize)
    const page = await fetch(`${service.base}/oauth/local/authorize`, {
      headers: { cookie: cookieHeader(cookies) },
    })
    const token = /name="token" value="([^"]+)"/.exec(await page.text())?.[1] ?? ''

    const wrong = await fetch(`${service.base}/oauth/local/login`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        cookie: cookieHeader(cookies),
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        token,
        email: 'alice@acme.example',
        password: 'the-wrong-password',
      }).toString(),
    })
    expect(wrong.status).toBe(403)
    const wrongBody = await wrong.text()
    expect(wrongBody).toContain('identity_rejected')

    // An address that names no account is refused the same way.
    const unknown = await fetch(`${service.base}/oauth/local/login`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        cookie: cookieHeader(cookies),
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        token,
        email: 'nobody@acme.example',
        password: PASSWORD,
      }).toString(),
    })
    expect(unknown.status).toBe(403)
    const unknownBody = await unknown.text()
    expect(unknownBody).toContain('identity_rejected')
  })

  test('a form that carries another token is refused', async () => {
    const query = new URLSearchParams({
      client_id: 'gateway-acme',
      redirect_uri: GATEWAY_REDIRECT,
      response_type: 'code',
      scope: 'openid',
      state: 'the-state-of-the-gateway',
      nonce: 'the-nonce-of-the-gateway',
      code_challenge: CHALLENGE,
      code_challenge_method: 'S256',
      provider: 'local',
    })
    const authorize = await fetch(`${service.base}/oauth/authorize?${query.toString()}`, {
      redirect: 'manual',
    })
    const cookies = cookiesOf(authorize)
    const login = await fetch(`${service.base}/oauth/local/login`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        cookie: cookieHeader(cookies),
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        token: 'a-token-of-another-login',
        email: 'alice@acme.example',
        password: PASSWORD,
      }).toString(),
    })
    expect(login.status).toBe(400)
  })

  test('the principal of a credential belongs to the local provider', async () => {
    const principals = await admin('/v1/admin/users?tenant=acme', 'GET', {})
    const rows = (principals.principals ?? []) as { provider: string }[]
    expect(rows.some((row) => row.provider === 'local')).toBe(true)
  })
})
