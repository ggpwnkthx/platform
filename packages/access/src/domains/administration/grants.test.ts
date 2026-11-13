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

describe('the capabilities of the platform', () => {
  test('the credential of a tenant may not give a capability of the platform', async () => {
    const administration = serviceOf(fakes, {
      adminCredentials: [{ token: 'the-token-of-acme', tenant: 'acme', operator: 'alice' }],
    })
    const principal = await administration.upsertPrincipal(
      PLATFORM_SCOPE,
      { tenant: 'acme', externalSubject: 'the-subject-of-a-platform-capability' },
      CONTEXT
    )
    await expect(
      administration.upsertGrant(
        { tenant: 'acme', operator: 'alice' },
        {
          tenant: 'acme',
          userId: principal.principal.id,
          permission: 'console.platform',
          workspaceId: 'acme',
          routeId: 'console',
        },
        CONTEXT
      )
    ).rejects.toThrow(/may not give a capability of the platform/)
    // Nothing was written: the capability of the platform is not a
    // permission of the tenant.
    expect(fakes.permissions.rows.some((row) => row.key === 'console.platform')).toBe(false)
  })

  test('the credential of the platform may give a capability of the platform', async () => {
    const administration = serviceOf(fakes)
    const principal = await administration.upsertPrincipal(
      PLATFORM_SCOPE,
      { tenant: 'acme', externalSubject: 'the-subject-of-a-platform-operator' },
      CONTEXT
    )
    const grant = await administration.upsertGrant(
      PLATFORM_SCOPE,
      {
        tenant: 'acme',
        userId: principal.principal.id,
        permission: 'console.platform',
        workspaceId: 'acme',
        routeId: 'console',
      },
      CONTEXT
    )
    expect(grant.grant.permission).toBe('console.platform')
    // The row of the capability is the one of the catalogue: it is not
    // relative to a tenant, and every tenant grants that row.
    const permission = fakes.permissions.rows.find((row) => row.key === 'console.platform')
    expect(permission?.tenantId).toBeNull()
  })

  test('a role of a tenant may not hold a capability of the platform', async () => {
    const administration = serviceOf(fakes, {
      adminCredentials: [{ token: 'the-token-of-acme', tenant: 'acme', operator: 'alice' }],
    })
    await expect(
      administration.upsertRole(
        { tenant: 'acme', operator: 'alice' },
        { tenant: 'acme', key: 'platform', permissionKeys: ['console.platform'] },
        CONTEXT
      )
    ).rejects.toThrow(/may not give a capability of the platform/)
  })

  test('the credential of a tenant may not grant a role that holds a capability of the platform', async () => {
    const administration = serviceOf(fakes)
    const ofAcme = { tenant: 'acme', operator: 'alice' }
    // The platform put the capability in a role of the tenant: the role
    // is the platform's to hand out from then on.
    await administration.upsertRole(
      PLATFORM_SCOPE,
      { tenant: 'acme', key: 'root', permissionKeys: ['console.platform'] },
      CONTEXT
    )
    // The role names the row of the catalogue, like a grant of the
    // capability: the tenant holds no row of its own for the key.
    expect(
      fakes.permissions.rows
        .filter((row) => row.key === 'console.platform')
        .map((row) => row.tenantId)
    ).toEqual([null])
    const principal = await administration.upsertPrincipal(
      PLATFORM_SCOPE,
      { tenant: 'acme', externalSubject: 'the-subject-of-a-colleague' },
      CONTEXT
    )
    const grant = {
      tenant: 'acme',
      userId: principal.principal.id,
      role: 'root',
      workspaceId: 'acme',
    }
    await expect(administration.upsertGrant(ofAcme, grant, CONTEXT)).rejects.toThrow(
      /may not give a capability of the platform: the role "root" holds "console.platform"/
    )
    // Nothing was written: the colleague holds no grant of the role.
    expect(fakes.grants.rows.some((row) => row.role === 'root')).toBe(false)

    // The credential of the platform grants the role it filled.
    const given = await administration.upsertGrant(PLATFORM_SCOPE, grant, CONTEXT)
    expect(given.grant.role).toBe('root')
  })

  test('a role that holds the capability through a role it names is not granted either', async () => {
    const administration = serviceOf(fakes)
    const ofAcme = { tenant: 'acme', operator: 'alice' }
    await administration.upsertRole(
      PLATFORM_SCOPE,
      { tenant: 'acme', key: 'chief', roleKeys: ['root'] },
      CONTEXT
    )
    await administration.upsertRole(
      PLATFORM_SCOPE,
      { tenant: 'acme', key: 'board', permissionKeys: ['workspace.read'], roleKeys: ['chief'] },
      CONTEXT
    )
    const principal = await administration.upsertPrincipal(
      PLATFORM_SCOPE,
      { tenant: 'acme', externalSubject: 'the-subject-of-the-board' },
      CONTEXT
    )
    // The capability is two roles deep: the grant gives it all the same.
    await expect(
      administration.upsertGrant(
        ofAcme,
        { tenant: 'acme', userId: principal.principal.id, role: 'board' },
        CONTEXT
      )
    ).rejects.toThrow(/the role "board" holds "console.platform"/)
    // A grant to a group is refused like a grant to a principal.
    await administration.upsertGroup(
      PLATFORM_SCOPE,
      { tenant: 'acme', key: 'directors', members: [] },
      CONTEXT
    )
    await expect(
      administration.upsertGrant(
        ofAcme,
        { tenant: 'acme', group: 'directors', role: 'chief' },
        CONTEXT
      )
    ).rejects.toThrow(/may not give a capability of the platform/)
  })

  test('a role of a tenant may not name a role that holds a capability of the platform', async () => {
    const administration = serviceOf(fakes)
    const ofAcme = { tenant: 'acme', operator: 'alice' }
    // Everybody who holds the role would hold the capability, without a
    // grant: the write of the role is the gift.
    await expect(
      administration.upsertRole(
        ofAcme,
        {
          tenant: 'acme',
          key: 'editors',
          permissionKeys: ['never.created'],
          roleKeys: ['chief'],
        },
        CONTEXT
      )
    ).rejects.toThrow(/may not give a capability of the platform: the role "chief" holds/)
    // Nothing was written: not the role, and not the permission it named.
    expect(fakes.roles.rows.some((row) => row.key === 'editors')).toBe(false)
    expect(fakes.permissions.rows.some((row) => row.key === 'never.created')).toBe(false)

    // The credential of the platform writes it.
    const written = await administration.upsertRole(
      PLATFORM_SCOPE,
      { tenant: 'acme', key: 'editors', roleKeys: ['chief'] },
      CONTEXT
    )
    expect(written.role.roleKeys).toEqual(['chief'])
  })

  test('the credential of a tenant takes a capability of the platform away', async () => {
    const administration = serviceOf(fakes)
    const ofAcme = { tenant: 'acme', operator: 'alice' }
    // The role that named the holder names it no more…
    const lighter = await administration.upsertRole(
      ofAcme,
      { tenant: 'acme', key: 'editors', permissionKeys: ['workspace.read'], roleKeys: [] },
      CONTEXT
    )
    expect(lighter.role.roleKeys).toEqual([])
    // …and the role is the tenant's again: it grants it.
    const principal = await administration.upsertPrincipal(
      PLATFORM_SCOPE,
      { tenant: 'acme', externalSubject: 'the-subject-of-an-editor' },
      CONTEXT
    )
    const grant = await administration.upsertGrant(
      ofAcme,
      { tenant: 'acme', userId: principal.principal.id, role: 'editors' },
      CONTEXT
    )
    expect(grant.grant.role).toBe('editors')
    // A grant of the capability is revoked by the tenant it belongs to.
    const held = fakes.grants.rows.find((row) => row.role === 'root')
    await administration.revokeGrant(ofAcme, held!.id, CONTEXT)
    expect(held?.revokedAt).not.toBeNull()
  })

  test('a group that holds a capability of the platform is filled by the platform', async () => {
    const administration = serviceOf(fakes)
    const ofAcme = { tenant: 'acme', operator: 'alice' }
    for (const subject of ['the-first-of-the-team', 'the-second-of-the-team']) {
      await administration.upsertPrincipal(
        PLATFORM_SCOPE,
        { tenant: 'acme', externalSubject: subject },
        CONTEXT
      )
    }
    const team = (members: string[]) => ({ tenant: 'acme', key: 'platform-team', members })
    // The group is the tenant's while it holds nothing of the platform.
    await administration.upsertGroup(ofAcme, team(['the-first-of-the-team']), CONTEXT)
    await administration.upsertGrant(
      PLATFORM_SCOPE,
      {
        tenant: 'acme',
        group: 'platform-team',
        permission: 'console.platform',
        workspaceId: 'acme',
      },
      CONTEXT
    )

    // A member of the group holds the capability: the credential of a
    // tenant adds none, whoever else it keeps or removes.
    await expect(
      administration.upsertGroup(
        ofAcme,
        team(['the-first-of-the-team', 'the-second-of-the-team']),
        CONTEXT
      )
    ).rejects.toThrow(
      /may not give a capability of the platform: the group "platform-team" holds "console.platform"/
    )
    await expect(
      administration.upsertGroup(ofAcme, team(['the-second-of-the-team']), CONTEXT)
    ).rejects.toThrow(/may not give a capability of the platform/)
    expect(fakes.groups.rows.find((row) => row.key === 'platform-team')?.memberIds).toHaveLength(1)

    // It keeps the members the group has, and it takes one away.
    const kept = await administration.upsertGroup(
      ofAcme,
      { ...team(['the-first-of-the-team']), displayName: 'The team of the platform' },
      CONTEXT
    )
    expect(kept.group.displayName).toBe('The team of the platform')
    // The credential of the platform adds the member.
    const filled = await administration.upsertGroup(
      PLATFORM_SCOPE,
      team(['the-first-of-the-team', 'the-second-of-the-team']),
      CONTEXT
    )
    expect(filled.group.memberIds).toHaveLength(2)
    const emptied = await administration.upsertGroup(ofAcme, team([]), CONTEXT)
    expect(emptied.group.memberIds).toEqual([])
  })

  test('a group holds the capability through a role, and until its grant ends', async () => {
    const administration = serviceOf(fakes)
    const ofAcme = { tenant: 'acme', operator: 'alice' }
    await administration.upsertGroup(
      PLATFORM_SCOPE,
      { tenant: 'acme', key: 'on-call', members: [] },
      CONTEXT
    )
    const grant = await administration.upsertGrant(
      PLATFORM_SCOPE,
      { tenant: 'acme', group: 'on-call', role: 'board' },
      CONTEXT
    )
    const joined = { tenant: 'acme', key: 'on-call', members: ['the-first-of-the-team'] }
    await expect(administration.upsertGroup(ofAcme, joined, CONTEXT)).rejects.toThrow(
      /the group "on-call" holds "console.platform"/
    )
    // The grant is revoked: the group gives nothing of the platform, and
    // it is the tenant's to fill again.
    await administration.revokeGrant(PLATFORM_SCOPE, grant.grant.id, CONTEXT)
    const filled = await administration.upsertGroup(ofAcme, joined, CONTEXT)
    expect(filled.group.memberIds).toHaveLength(1)
  })

  test('the deployment names the capabilities that are not relative to a tenant', async () => {
    const administration = serviceOf(fakes, { platformPermissions: ['data.platform'] })
    const principal = await administration.upsertPrincipal(
      PLATFORM_SCOPE,
      { tenant: 'acme', externalSubject: 'the-subject-of-a-named-capability' },
      CONTEXT
    )
    await expect(
      administration.upsertGrant(
        { tenant: 'acme', operator: 'alice' },
        {
          tenant: 'acme',
          userId: principal.principal.id,
          permission: 'data.platform',
        },
        CONTEXT
      )
    ).rejects.toThrow(/may not give a capability of the platform/)
    const grant = await administration.upsertGrant(
      PLATFORM_SCOPE,
      {
        tenant: 'acme',
        userId: principal.principal.id,
        permission: 'data.platform',
      },
      CONTEXT
    )
    expect(grant.grant.permission).toBe('data.platform')
    expect(fakes.permissions.rows.find((row) => row.key === 'data.platform')?.tenantId).toBeNull()
  })
})
