import { describe, expect, test } from 'bun:test'
import { CONTEXT, TENANT, createFakes, serviceOf } from './fakes'
import { PLATFORM_SCOPE } from './index'

/**
 * The tenants of the administration (spec §10.1).
 *
 * The slug is the key of the row: the call is an upsert. A client id
 * belongs to one tenant and a default belongs to one tenant: both are a
 * conflict.
 */

const fakes = createFakes()

describe('the tenants of the administration', () => {
  test('a tenant is created and then changed', async () => {
    const administration = serviceOf(fakes)
    const created = await administration.upsertTenant(PLATFORM_SCOPE, TENANT, CONTEXT)
    expect(created.created).toBe(true)
    expect(created.audit.action).toBe('tenant.created')

    const updated = await administration.upsertTenant(
      PLATFORM_SCOPE,
      { ...TENANT, displayName: 'Another name' },
      CONTEXT
    )
    expect(updated.created).toBe(false)
    expect(updated.audit.action).toBe('tenant.updated')
    expect(updated.tenant.displayName).toBe('Another name')
  })

  test('a credential of a tenant may not change the shared client of its tenant', async () => {
    const administration = serviceOf(fakes, {
      credentials: [{ token: 'the-token-of-acme', tenant: 'acme', operator: 'alice' }],
    })
    await administration.upsertTenant(PLATFORM_SCOPE, TENANT, CONTEXT)
    const scope = { tenant: 'acme', operator: 'alice' }
    // The shared client moves the logins of the platform and lifts the
    // scope of the decisions of the gateway: it belongs to the operator
    // of the platform.
    await expect(
      administration.upsertTenant(scope, { ...TENANT, sharedClient: true }, CONTEXT)
    ).rejects.toThrow(/may not change the shared client/)
    // The tenant with the value it already has is changed.
    const changed = await administration.upsertTenant(
      scope,
      { ...TENANT, displayName: 'Another name' },
      CONTEXT
    )
    expect(changed.tenant.displayName).toBe('Another name')
    // The operator of the platform may change it.
    const byPlatform = await administration.upsertTenant(
      PLATFORM_SCOPE,
      { ...TENANT, sharedClient: true },
      CONTEXT
    )
    expect(byPlatform.tenant.sharedClient).toBe(true)
  })

  test('a credential of a tenant may not change the default tenant of the platform', async () => {
    const administration = serviceOf(fakes, {
      credentials: [{ token: 'the-token-of-acme', tenant: 'acme', operator: 'alice' }],
    })
    await administration.upsertTenant(PLATFORM_SCOPE, TENANT, CONTEXT)
    const scope = { tenant: 'acme', operator: 'alice' }
    await expect(
      administration.upsertTenant(scope, { ...TENANT, isDefault: true }, CONTEXT)
    ).rejects.toThrow(/may not change the default tenant/)
    await expect(
      administration.upsertTenant(scope, { ...TENANT, isDefault: false }, CONTEXT)
    ).resolves.toBeTruthy()
  })

  test('a client id belongs to one tenant', async () => {
    const administration = serviceOf(fakes)
    await expect(
      administration.upsertTenant(
        PLATFORM_SCOPE,
        { ...TENANT, slug: 'another', clientId: 'gateway-acme' },
        CONTEXT
      )
    ).rejects.toThrow(/belongs to another tenant/)
  })

  test('at most one tenant is the default', async () => {
    const administration = serviceOf(fakes)
    await administration.upsertTenant(
      PLATFORM_SCOPE,
      {
        ...TENANT,
        slug: 'first',
        clientId: 'gateway-first',
        isDefault: true,
      },
      CONTEXT
    )
    await expect(
      administration.upsertTenant(
        PLATFORM_SCOPE,
        {
          ...TENANT,
          slug: 'second',
          clientId: 'gateway-second',
          isDefault: true,
        },
        CONTEXT
      )
    ).rejects.toThrow(/already the default/)
  })

  test('a tenant is created with the provider of its identity', async () => {
    const administration = serviceOf(fakes)
    // A tenant that is created is created with the provider of its
    // identity: a registration that names no provider creates no
    // tenant.
    await expect(
      administration.upsertTenant(
        PLATFORM_SCOPE,
        {
          ...TENANT,
          slug: 'without-provider',
          clientId: 'gateway-without-provider',
          issuer: undefined,
          idpClientId: undefined,
          idpClientSecret: undefined,
        },
        CONTEXT
      )
    ).rejects.toThrow(/the issuer of the provider is needed/)
    await expect(
      administration.upsertTenant(
        PLATFORM_SCOPE,
        {
          ...TENANT,
          slug: 'without-client',
          clientId: 'gateway-without-client',
          idpClientId: undefined,
        },
        CONTEXT
      )
    ).rejects.toThrow(/the client of Access at the provider is needed/)
    await expect(
      administration.upsertTenant(
        PLATFORM_SCOPE,
        {
          ...TENANT,
          slug: 'without-secret',
          clientId: 'gateway-without-secret',
          idpClientSecret: undefined,
        },
        CONTEXT
      )
    ).rejects.toThrow(/the secret of Access at the provider is needed/)
  })

  test('a change that names no provider keeps the provider of the tenant', async () => {
    const administration = serviceOf(fakes)
    await administration.upsertTenant(PLATFORM_SCOPE, TENANT, CONTEXT)
    // The provider of a tenant is the tenant's own: a change that names
    // none of it keeps the one the tenant has.
    const changed = await administration.upsertTenant(
      PLATFORM_SCOPE,
      {
        slug: TENANT.slug,
        displayName: 'Another name',
        issuer: undefined,
        idpClientId: undefined,
        idpClientSecret: undefined,
        idpRedirectUri: undefined,
        idpScopes: undefined,
        idpAlgorithms: undefined,
        emailDomain: null,
        clientId: TENANT.clientId,
        clientSecret: TENANT.clientSecret,
        clientRedirectUris: TENANT.clientRedirectUris,
        autoProvision: false,
        autoProvisionAdmin: false,
        sharedClient: false,
        isDefault: false,
        enabled: true,
      },
      CONTEXT
    )
    expect(changed.tenant.displayName).toBe('Another name')
    expect(changed.tenant.issuer).toBe(TENANT.issuer)
  })

  test('a change of the provider that names no secret is refused', async () => {
    const administration = serviceOf(fakes)
    await administration.upsertTenant(PLATFORM_SCOPE, TENANT, CONTEXT)
    // The secret of a provider belongs to that provider: a change that
    // names another issuer and no secret would leave the tenant with
    // the secret of the old one, and the login at the new provider
    // would be refused.
    await expect(
      administration.upsertTenant(
        PLATFORM_SCOPE,
        { ...TENANT, issuer: 'https://login.another.example', idpClientSecret: undefined },
        CONTEXT
      )
    ).rejects.toThrow(/the secret of a provider belongs to its provider/)
    // The same goes for another client at the same provider.
    await expect(
      administration.upsertTenant(
        PLATFORM_SCOPE,
        { ...TENANT, idpClientId: 'access-another', idpClientSecret: undefined },
        CONTEXT
      )
    ).rejects.toThrow(/the secret of a provider belongs to its provider/)
    // The change that names the secret of the new provider is kept.
    const changed = await administration.upsertTenant(
      PLATFORM_SCOPE,
      {
        ...TENANT,
        issuer: 'https://login.another.example',
        idpClientId: 'access-another',
        idpClientSecret: 'the-secret-of-the-other-provider',
      },
      CONTEXT
    )
    expect(changed.tenant.issuer).toBe('https://login.another.example')
  })

  test('the tenants are listed', async () => {
    const administration = serviceOf(fakes)
    const listed = await administration.listTenants(PLATFORM_SCOPE)
    expect(listed.length).toBeGreaterThan(0)
    expect(listed.every((tenant) => typeof tenant.userCount === 'number')).toBe(true)
  })
})
