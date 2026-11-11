import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  ProviderRepository,
  TenantRepository,
  createSecretCipher,
  type Database,
} from '../../src/platform/postgres'
import { OTHER_TENANT, seedTenant } from '../fixtures/tenant'
import { openTestDatabase } from './database'

/**
 * The providers of the tenants (spec §3.11).
 *
 * The registry of the providers is what the logins read: the row of the
 * tenant carries the registration of its **default** provider, and the
 * row of `tenant_providers` carries the same registration. The two are
 * written by the same statements.
 */
let database: Database
let tenants: TenantRepository
let providers: ProviderRepository

const KEY = 'the-key-of-the-deployment'

/** The registration of a tenant of the tests. */
function registration(slug: string) {
  return {
    slug,
    displayName: 'Acme Inc',
    issuer: 'https://login.acme.example',
    idpClientId: 'access-acme',
    idpClientSecret: 'the-secret-of-the-provider',
    idpRedirectUri: 'https://access.example.com/oauth/tenant/callback',
    idpScopes: ['openid'],
    idpAlgorithms: ['RS256'],
    clientId: `gateway-${slug}`,
    clientSecret: 'the-secret-of-the-gateway',
  }
}

beforeAll(async () => {
  database = await openTestDatabase()
  tenants = new TenantRepository(database, createSecretCipher(KEY))
  providers = new ProviderRepository(database, createSecretCipher(KEY))
})

afterAll(async () => {
  await database.close()
})

describe('the providers of a tenant', () => {
  test('a tenant is created with its default provider', async () => {
    const tenant = await tenants.create(registration('acme-one'))

    const rows = await providers.listByTenant(tenant.id)
    expect(rows).toHaveLength(1)
    const provider = rows[0]!
    expect(provider.slug).toBe('default')
    expect(provider.kind).toBe('oidc')
    expect(provider.enabled).toBe(true)
    expect(provider.issuer).toBe('https://login.acme.example')
    expect(provider.idpClientId).toBe('access-acme')
    expect(provider.idpRedirectUri).toBe('https://access.example.com/oauth/tenant/callback')
    expect(provider.idpScopes).toEqual(['openid'])
    expect(provider.idpAlgorithms).toEqual(['RS256'])
  })

  test('the secret of the provider is encrypted at rest', async () => {
    const tenant = await tenants.create(registration('acme-two'))
    const row = (await providers.listByTenant(tenant.id))[0]!
    // The secret is not readable in the row, and it is readable through
    // the method that needs it.
    expect(Buffer.from(row.idpClientSecret ?? new Uint8Array()).toString('utf8')).not.toContain(
      'the-secret-of-the-provider'
    )
    expect(await providers.readSecret(row.id)).toBe('the-secret-of-the-provider')
  })

  test('the default provider follows the registration of the tenant', async () => {
    const tenant = await tenants.create(registration('acme-three'))
    await tenants.update(tenant.id, {
      issuer: 'https://login2.acme.example',
      idpClientId: 'access-acme-2',
      idpClientSecret: 'another-secret-of-the-provider',
    })

    const provider = (await providers.listByTenant(tenant.id))[0]!
    expect(provider.issuer).toBe('https://login2.acme.example')
    expect(provider.idpClientId).toBe('access-acme-2')
    expect(await providers.readSecret(provider.id)).toBe('another-secret-of-the-provider')
  })

  test('a tenant has a provider of its own and no other', async () => {
    const first = await seedTenant(database, {
      tenant: { slug: 'seeded-one', clientId: 'gateway-seeded-one' },
      subject: null,
    })
    const other = await seedTenant(database, {
      tenant: { ...OTHER_TENANT, slug: 'seeded-two', clientId: 'gateway-seeded-two' },
      subject: null,
    })

    const mine = await providers.listByTenant(first.tenantId)
    const theirs = await providers.listByTenant(other.tenantId)
    expect(mine).toHaveLength(1)
    expect(theirs).toHaveLength(1)
    expect(mine[0]!.id).not.toBe(theirs[0]!.id)
  })

  test('a tenant signs in at a second provider', async () => {
    const tenant = await seedTenant(database, {
      tenant: { slug: 'seeded-three', clientId: 'gateway-seeded-three' },
      subject: null,
    })
    const created = await providers.create({
      tenantId: tenant.tenantId,
      kind: 'oidc',
      slug: 'okta',
      displayName: 'Okta',
      issuer: 'https://login.okta.example',
      idpClientId: 'access-okta',
      idpClientSecret: new Uint8Array([1, 2, 3]),
      idpRedirectUri: 'https://access.example.com/oauth/tenant/callback',
      idpScopes: ['openid'],
      idpAlgorithms: ['RS256'],
    })

    const rows = await providers.listByTenant(tenant.tenantId)
    expect(rows.map((row) => row.slug)).toEqual(['default', 'okta'])
    expect((await providers.findByTenantAndSlug(tenant.tenantId, 'okta'))?.id).toBe(created.id)
    expect(await providers.findByTenantAndSlug(tenant.tenantId, 'keycloak')).toBeNull()
  })

  test('a provider is disabled and enabled again', async () => {
    const tenant = await seedTenant(database, {
      tenant: { slug: 'seeded-four', clientId: 'gateway-seeded-four' },
      subject: null,
    })
    const provider = (await providers.listByTenant(tenant.tenantId))[0]!
    const disabled = await providers.update(provider.id, { enabled: false })
    expect(disabled?.enabled).toBe(false)
    const enabled = await providers.update(provider.id, { enabled: true })
    expect(enabled?.enabled).toBe(true)
  })
})
