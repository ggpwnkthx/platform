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

  test('the tenants are listed', async () => {
    const administration = serviceOf(fakes)
    const listed = await administration.listTenants(PLATFORM_SCOPE)
    expect(listed.length).toBeGreaterThan(0)
    expect(listed.every((tenant) => typeof tenant.userCount === 'number')).toBe(true)
  })
})
