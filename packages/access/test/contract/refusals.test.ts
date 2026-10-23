import { describe, expect, test } from 'bun:test'
import { generateKeyPairSync } from 'node:crypto'
import { createTestClient } from '../fixtures/client'
import {
  startProviderFixture,
  type FixtureOptions,
  type ProviderFixture,
} from '../fixtures/provider'
import { loginEnv, startTestRuntime } from '../fixtures/runtime'
import { tenantPayload } from '../fixtures/tenant'

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

/**
 * Starts a deployment with one tenant and runs a login against it.
 *
 * The answer of the callback is what the test asserts: a page of a
 * refusal, with its code.
 */
async function login(options: {
  provider?: FixtureOptions
  /** Whether the tenant creates the principals that it does not know. */
  autoProvision?: boolean
  /** Whether the principal of the tenant is disabled. */
  disabled?: boolean
  /** Whether the identity of the caller is known to the platform. */
  known?: boolean
}): Promise<{ status: number; body: string; headers: Headers }> {
  const provider = await startProviderFixture(options.provider)
  const service = await startTestRuntime(loginEnv(ADMIN_TOKEN, SIGNING_KEY))
  const base = service.base
  try {
    const admin = createTestClient(base, ADMIN_TOKEN)
    await admin.call(
      '/v1/admin/tenants',
      'POST',
      tenantPayload({
        issuer: provider.issuer,
        idpClientId: provider.clientId,
        idpClientSecret: provider.clientSecret,
        idpRedirectUri: `${base}/oauth/tenant/callback`,
        clientSecret: 'the-secret-of-the-gateway',
        clientRedirectUris: ['https://gateway-acme.example.com/auth/callback'],
        autoProvision: options.autoProvision ?? false,
      })
    )
    if (options.known) {
      await admin.call('/v1/admin/users', 'POST', {
        tenant: 'acme',
        externalSubject: provider.subject,
        status: options.disabled ? 'disabled' : 'active',
      })
    }

    const query = new URLSearchParams({
      client_id: 'gateway-acme',
      redirect_uri: GATEWAY_REDIRECT,
      response_type: 'code',
      scope: 'openid',
      state: 'the-state-of-the-gateway',
      nonce: 'the-nonce-of-the-gateway',
    })
    const authorize = await fetch(`${base}/oauth/authorize?${query.toString()}`, {
      redirect: 'manual',
    })
    // The refusal can happen at the authorization: the provider of the
    // tenant is refused before the browser leaves access.
    if (authorize.status !== 302) {
      return { status: authorize.status, body: await authorize.text(), headers: authorize.headers }
    }
    const cookie = (authorize.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
    const atProvider = await fetch(authorize.headers.get('location') ?? '', {
      redirect: 'manual',
    })
    const callback = await fetch(atProvider.headers.get('location') ?? '', {
      redirect: 'manual',
      headers: { cookie },
    })
    return { status: callback.status, body: await callback.text(), headers: callback.headers }
  } finally {
    await provider.stop()
    await service.stop()
  }
}

describe('the refusals of the login', () => {
  test('a page of a refusal carries the headers of a browser', async () => {
    const answer = await login({ provider: { signWith: 'another-key' } })
    expect(answer.headers.get('x-content-type-options')).toBe('nosniff')
    expect(answer.headers.get('x-frame-options')).toBe('DENY')
    expect(answer.headers.get('referrer-policy')).toBe('no-referrer')
    expect(answer.headers.get('content-security-policy')).toBe("default-src 'none'")
  })

  test('a token that is signed with another key is refused', async () => {
    const answer = await login({ provider: { signWith: 'another-key' } })
    expect(answer.status).toBe(403)
    expect(answer.body).toContain('identity_rejected')
  })

  test('a provider that names another issuer is refused', async () => {
    const answer = await login({ provider: { issuer: 'https://another.example.com' } })
    expect(answer.status).toBe(403)
    expect(answer.body).toContain('identity_rejected')
  })

  test('a token that is issued for another audience is refused', async () => {
    const answer = await login({ provider: { audience: 'another-client' } })
    expect(answer.status).toBe(403)
    expect(answer.body).toContain('identity_rejected')
  })

  test('a token that carries another nonce is refused', async () => {
    const answer = await login({ provider: { nonce: 'another-nonce' } })
    expect(answer.status).toBe(403)
    expect(answer.body).toContain('identity_rejected')
  })

  test('an identity that is not known is refused', async () => {
    const answer = await login({})
    expect(answer.status).toBe(403)
    expect(answer.body).toContain('identity_unknown')
  })

  test('a principal that is disabled is refused', async () => {
    const answer = await login({ known: true, disabled: true })
    expect(answer.status).toBe(403)
    expect(answer.body).toContain('principal_disabled')
  })

  test('an identity that is not known is created when the tenant allows it', async () => {
    const answer = await login({ autoProvision: true })
    // The login succeeds: the browser comes back with a code and the
    // principal exists with no grant at all.
    expect(answer.status).toBe(302)
  })
})

describe('the provider of a tenant that is down', () => {
  test('the provider that cannot be reached is a refusal', async () => {
    const provider: ProviderFixture = await startProviderFixture()
    const url = provider.url
    await provider.stop()
    const service = await startTestRuntime(loginEnv(ADMIN_TOKEN, SIGNING_KEY))
    const base = service.base
    try {
      await createTestClient(base, ADMIN_TOKEN).call(
        '/v1/admin/tenants',
        'POST',
        tenantPayload({
          issuer: url,
          idpRedirectUri: `${base}/oauth/tenant/callback`,
          clientRedirectUris: [GATEWAY_REDIRECT],
        })
      )
      const query = new URLSearchParams({
        client_id: 'gateway-acme',
        redirect_uri: GATEWAY_REDIRECT,
        response_type: 'code',
        scope: 'openid',
      })
      const authorize = await fetch(`${base}/oauth/authorize?${query.toString()}`, {
        redirect: 'manual',
      })
      expect(authorize.status).toBe(502)
      expect(await authorize.text()).toContain('upstream_unavailable')
    } finally {
      await service.stop()
    }
  })
})
