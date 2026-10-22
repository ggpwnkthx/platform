import { beforeAll, describe, expect, test } from 'bun:test'
import { CONTEXT, TENANT, createFakes, serviceOf } from './fakes'
import { PLATFORM_SCOPE } from './index'

/**
 * The grants of the administration (spec §10.2).
 *
 * A grant names one subject — a principal or a group — one permission,
 * and the scope of the access it gives.
 */

const fakes = createFakes()

beforeAll(async () => {
  // The grant of a test needs its tenant: the file writes it once, and
  // every test of the file works on it.
  await serviceOf(fakes).upsertTenant(PLATFORM_SCOPE, TENANT, CONTEXT)
})

describe('the grants of the administration', () => {
  test('a grant is created and the permission is created on demand', async () => {
    const administration = serviceOf(fakes)
    const principal = await administration.upsertPrincipal(
      PLATFORM_SCOPE,
      {
        tenant: 'acme',
        externalSubject: 'the-subject-of-a-grant',
      },
      CONTEXT
    )
    const grant = await administration.upsertGrant(
      PLATFORM_SCOPE,
      {
        tenant: 'acme',
        userId: principal.principal.id,
        permission: 'workspace.read',
        workspaceId: '11111111-1111-4111-8111-111111111111',
        routeId: 'workspace-api',
      },
      CONTEXT
    )
    expect(grant.grant.permission).toBe('workspace.read')
    expect(grant.audit.action).toBe('grant.created')
    expect(fakes.permissions.rows.some((row) => row.key === 'workspace.read')).toBe(true)
  })

  test('a permission of the catalogue is reused', async () => {
    const administration = serviceOf(fakes)
    await fakes.permissions.create({ tenantId: null, key: 'platform.read' })
    const principal = await administration.upsertPrincipal(
      PLATFORM_SCOPE,
      {
        tenant: 'acme',
        externalSubject: 'the-subject-of-the-catalogue',
      },
      CONTEXT
    )
    const grant = await administration.upsertGrant(
      PLATFORM_SCOPE,
      {
        tenant: 'acme',
        userId: principal.principal.id,
        permission: 'platform.read',
      },
      CONTEXT
    )
    expect(grant.grant.permission).toBe('platform.read')
    expect(fakes.permissions.rows.filter((row) => row.key === 'platform.read')).toHaveLength(1)
  })

  test('a key is a name inside a tenant: two tenants hold the same key', async () => {
    // The permission of another tenant is not the permission of this
    // one: the tenant creates its own row, and the grant names that
    // row. A key that another tenant owns never becomes a permission
    // of this tenant.
    const administration = serviceOf(fakes)
    await fakes.permissions.create({ tenantId: 'another-tenant', key: 'workspace.write' })
    const principal = await administration.upsertPrincipal(
      PLATFORM_SCOPE,
      {
        tenant: 'acme',
        externalSubject: 'the-subject-of-another-tenant',
      },
      CONTEXT
    )
    const grant = await administration.upsertGrant(
      PLATFORM_SCOPE,
      {
        tenant: 'acme',
        userId: principal.principal.id,
        permission: 'workspace.write',
      },
      CONTEXT
    )
    expect(grant.grant.permission).toBe('workspace.write')
    const rows = fakes.permissions.rows.filter((row) => row.key === 'workspace.write')
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.tenantId).sort()).toEqual(['another-tenant', 'tenant-1'])
  })

  test('a principal of another tenant is refused', async () => {
    const administration = serviceOf(fakes)
    await administration.upsertTenant(
      PLATFORM_SCOPE,
      {
        ...TENANT,
        slug: 'another',
        clientId: 'gateway-another',
      },
      CONTEXT
    )
    const principal = await administration.upsertPrincipal(
      PLATFORM_SCOPE,
      {
        tenant: 'acme',
        externalSubject: 'the-subject-of-another-tenant',
      },
      CONTEXT
    )
    await expect(
      administration.upsertGrant(
        PLATFORM_SCOPE,
        {
          tenant: 'another',
          userId: principal.principal.id,
          permission: 'workspace.read',
        },
        CONTEXT
      )
    ).rejects.toThrow(/belongs to another tenant/)
  })

  test('a grant is revoked and the revocation is idempotent', async () => {
    const administration = serviceOf(fakes)
    const principal = await administration.upsertPrincipal(
      PLATFORM_SCOPE,
      {
        tenant: 'acme',
        externalSubject: 'the-subject-of-a-revocation',
      },
      CONTEXT
    )
    const grant = await administration.upsertGrant(
      PLATFORM_SCOPE,
      {
        tenant: 'acme',
        userId: principal.principal.id,
        permission: 'workspace.read',
      },
      CONTEXT
    )
    const audit = await administration.revokeGrant(PLATFORM_SCOPE, grant.grant.id, CONTEXT)
    expect(audit.action).toBe('grant.revoked')
    await expect(
      administration.revokeGrant(PLATFORM_SCOPE, grant.grant.id, CONTEXT)
    ).resolves.toBeTruthy()
  })

  test('a grant that does not exist is a not found', async () => {
    const administration = serviceOf(fakes)
    await expect(
      administration.revokeGrant(PLATFORM_SCOPE, 'grant-does-not-exist', CONTEXT)
    ).rejects.toThrow(/the grant does not exist/)
  })
})
