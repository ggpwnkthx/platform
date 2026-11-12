import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createTestClient } from '../fixtures/client'
import { startTestRuntime, TEST_ENCRYPTION_KEY, type TestRuntime } from '../fixtures/runtime'

/**
 * The capabilities that are not relative to a tenant (spec §3.3).
 *
 * `console.platform` opens the administration of every tenant, and it
 * is the platform's: the credential of a tenant may not grant it, and
 * only the platform gives it.
 */

/** The token of the administration of the platform. */
const ADMIN_TOKEN = 'the-admin-token'
/** The token of the operator of the tenant. */
const TENANT_TOKEN = 'the-token-of-acme-00000001'

let service: TestRuntime

beforeAll(async () => {
  service = await startTestRuntime({
    ACCESS_ADMIN_TOKEN: ADMIN_TOKEN,
    ACCESS_SECRET_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
    ACCESS_ADMIN_TOKENS: JSON.stringify({
      [TENANT_TOKEN]: { tenant: 'acme', operator: 'alice' },
    }),
  })

  const admin = createTestClient(service.base, ADMIN_TOKEN).call
  await admin('/v1/admin/tenants', 'POST', {
    slug: 'acme',
    displayName: 'Acme',
    issuer: 'https://login.acme.example',
    idpClientId: 'access-acme',
    idpClientSecret: 'the-secret-of-the-provider',
    clientId: 'gateway-acme',
    clientSecret: 'the-secret-of-the-gateway',
    clientRedirectUris: ['https://gateway-acme.example.com/auth/callback'],
  })
})

afterAll(async () => {
  await service.stop()
})

describe('the capabilities of the platform', () => {
  test('the credential of a tenant may not grant a capability of the platform', async () => {
    const admin = createTestClient(service.base, ADMIN_TOKEN).call
    const principal = await admin('/v1/admin/users', 'POST', {
      tenant: 'acme',
      externalSubject: 'the-subject-of-a-tenant-operator',
    })

    const ofAcme = createTestClient(service.base, TENANT_TOKEN).call
    const grant = await ofAcme('/v1/admin/grants', 'PUT', {
      tenant: 'acme',
      userId: principal.body.id,
      permission: 'console.platform',
      workspaceId: 'acme',
      routeId: 'console',
    })
    expect(grant.status).toBe(403)
    expect(grant.body.error).toBe('forbidden')

    // The right of the tenant is untouched: nothing was written.
    const grants = await admin('/v1/admin/grants?tenant=acme', 'GET')
    expect(grants.body.grants ?? []).toEqual([])
  })

  test('the credential of the platform grants a capability of the platform', async () => {
    const admin = createTestClient(service.base, ADMIN_TOKEN).call
    const principal = await admin('/v1/admin/users', 'POST', {
      tenant: 'acme',
      externalSubject: 'the-subject-of-a-platform-operator',
    })
    const grant = await admin('/v1/admin/grants', 'PUT', {
      tenant: 'acme',
      userId: principal.body.id,
      permission: 'console.platform',
      workspaceId: 'acme',
      routeId: 'console',
    })
    expect(grant.status).toBe(200)
    expect(grant.body.permission).toBe('console.platform')
    // The grant is the one of the tenant: the holder is a principal of
    // it, and the capability is the platform's.
    expect(grant.body.tenant).toBe('acme')
  })

  test('the role of a tenant may not hold a capability of the platform', async () => {
    const ofAcme = createTestClient(service.base, TENANT_TOKEN).call
    const role = await ofAcme('/v1/admin/roles', 'PUT', {
      tenant: 'acme',
      key: 'platform',
      permissions: ['console.platform'],
    })
    expect(role.status).toBe(403)
    expect(role.body.error).toBe('forbidden')
  })
})
