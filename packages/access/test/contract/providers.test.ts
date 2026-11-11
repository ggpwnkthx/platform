import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { startTestRuntime, TEST_ENCRYPTION_KEY, type TestRuntime } from '../fixtures/runtime'

/**
 * The providers of a tenant (spec §10.16).
 *
 * The default provider of a tenant is the registration of the tenant: it
 * is written with it, and it is not administered here. The other
 * providers of the tenant are the ones this file proves.
 */

const TOKEN = 'the-admin-token'

let service: TestRuntime

/** Calls the administration. */
async function call(
  path: string,
  method: string,
  body?: unknown
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${service.base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  const text = await response.text()
  let parsed: unknown = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = text
  }
  return { status: response.status, body: (parsed ?? {}) as Record<string, unknown> }
}

beforeAll(async () => {
  service = await startTestRuntime({
    ACCESS_ADMIN_TOKEN: TOKEN,
    ACCESS_SECRET_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
  })
  await call('/v1/admin/tenants', 'POST', {
    slug: 'acme',
    displayName: 'Acme Inc',
    issuer: 'https://login.acme.example',
    idpClientId: 'access-acme',
    idpClientSecret: 'the-secret-of-the-provider',
    idpRedirectUri: 'https://access.example.com/oauth/tenant/callback',
    clientId: 'gateway-acme',
    clientSecret: 'the-secret-of-the-gateway',
    clientRedirectUris: ['https://gateway-acme.example.com/auth/callback'],
  })
})

afterAll(async () => {
  await service.stop()
})

describe('the providers of a tenant', () => {
  test('a provider is created and the answer carries no secret', async () => {
    const response = await call('/v1/admin/providers', 'POST', {
      tenant: 'acme',
      slug: 'okta',
      displayName: 'Okta',
      issuer: 'https://login.okta.example',
      idpClientId: 'access-acme-okta',
      idpClientSecret: 'the-secret-of-okta',
      idpRedirectUri: 'https://access.example.com/oauth/tenant/callback',
      idpScopes: ['openid', 'email'],
    })
    expect(response.status).toBe(201)
    const provider = response.body.provider as Record<string, unknown>
    expect(provider.slug).toBe('okta')
    expect(provider.tenant).toBe('acme')
    expect(provider.enabled).toBe(true)
    expect(provider.issuer).toBe('https://login.okta.example')
    expect(provider.idpScopes).toEqual(['openid', 'email'])
    expect(JSON.stringify(response.body)).not.toContain('the-secret-of-okta')
  })

  test('the same slug changes the provider', async () => {
    const response = await call('/v1/admin/providers', 'POST', {
      tenant: 'acme',
      slug: 'okta',
      displayName: 'Okta, the second one',
    })
    expect(response.status).toBe(200)
    const provider = response.body.provider as Record<string, unknown>
    expect(provider.displayName).toBe('Okta, the second one')
    // The registration the change did not name is the one the provider
    // had.
    expect(provider.issuer).toBe('https://login.okta.example')
  })

  test('the providers of a tenant are listed, the default one included', async () => {
    const response = await call('/v1/admin/providers?tenant=acme', 'GET')
    expect(response.status).toBe(200)
    const providers = response.body.providers as { slug: string }[]
    expect(providers.map((provider) => provider.slug).sort()).toEqual(['default', 'okta'])
  })

  test('the default provider of a tenant is not administered here', async () => {
    const response = await call('/v1/admin/providers', 'POST', {
      tenant: 'acme',
      slug: 'default',
      issuer: 'https://login.other.example',
    })
    expect(response.status).toBe(400)
    expect(response.body.error).toBe('invalid_request')
  })

  test('a provider that is created carries its registration', async () => {
    const response = await call('/v1/admin/providers', 'POST', {
      tenant: 'acme',
      slug: 'keycloak',
      displayName: 'Keycloak',
    })
    expect(response.status).toBe(400)
    expect(response.body.error).toBe('invalid_request')
  })

  test('a change that names another provider and no secret is refused', async () => {
    const response = await call('/v1/admin/providers', 'POST', {
      tenant: 'acme',
      slug: 'okta',
      issuer: 'https://login.other.example',
    })
    expect(response.status).toBe(400)
    expect(response.body.error).toBe('invalid_request')
  })

  test('a provider of a tenant that does not exist is refused', async () => {
    const response = await call('/v1/admin/providers', 'POST', {
      tenant: 'other',
      slug: 'okta',
      issuer: 'https://login.okta.example',
      idpClientId: 'access-other-okta',
      idpClientSecret: 'the-secret-of-okta',
      idpRedirectUri: 'https://access.example.com/oauth/tenant/callback',
    })
    expect(response.status).toBe(404)
    expect(response.body.error).toBe('not_found')
  })

  test('a provider that holds a principal is not removed', async () => {
    const principal = await call('/v1/admin/users', 'POST', {
      tenant: 'acme',
      provider: 'okta',
      externalSubject: 'the-subject-of-okta',
    })
    expect(principal.status).toBe(201)
    expect((principal.body as Record<string, unknown>).provider).toBe('okta')

    const providers = await call('/v1/admin/providers?tenant=acme&slug=okta', 'GET')
    const provider = (providers.body.providers as { id: string }[])[0]!
    const removed = await call(`/v1/admin/providers/${provider.id}`, 'DELETE')
    expect(removed.status).toBe(409)
    expect(removed.body.error).toBe('conflict')
  })

  test('a provider that holds no principal is removed', async () => {
    await call('/v1/admin/providers', 'POST', {
      tenant: 'acme',
      slug: 'keycloak',
      issuer: 'https://login.keycloak.example',
      idpClientId: 'access-acme-keycloak',
      idpClientSecret: 'the-secret-of-keycloak',
      idpRedirectUri: 'https://access.example.com/oauth/tenant/callback',
    })
    const providers = await call('/v1/admin/providers?tenant=acme&slug=keycloak', 'GET')
    const provider = (providers.body.providers as { id: string }[])[0]!
    const removed = await call(`/v1/admin/providers/${provider.id}`, 'DELETE')
    expect(removed.status).toBe(204)
    const after = await call('/v1/admin/providers?tenant=acme&slug=keycloak', 'GET')
    expect((after.body.providers as unknown[]).length).toBe(0)
  })

  test('an identifier that names no provider is refused', async () => {
    const removed = await call('/v1/admin/providers/11111111-1111-4111-8111-111111111111', 'DELETE')
    expect(removed.status).toBe(404)
    expect(removed.body.error).toBe('not_found')
  })
})
