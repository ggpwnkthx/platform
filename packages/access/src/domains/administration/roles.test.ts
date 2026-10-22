import { beforeAll, describe, expect, test } from 'bun:test'
import { CONTEXT, TENANT, createFakes, serviceOf } from './fakes'
import { PLATFORM_SCOPE } from './index'

/**
 * The roles of the administration (spec §10.7).
 *
 * A role is a named set of permissions of a tenant. A role may name
 * another role: the permissions of the named role are the permissions of
 * the naming role. The memberships are replaced by every call, and a
 * cycle is refused.
 */

const fakes = createFakes()

beforeAll(async () => {
  // The roles of a test need their tenant: the file writes it once, and
  // every test of the file works on it.
  await serviceOf(fakes).upsertTenant(PLATFORM_SCOPE, TENANT, CONTEXT)
})

describe('the roles of the administration', () => {
  test('a role is created with its permissions', async () => {
    const administration = serviceOf(fakes)
    const result = await administration.upsertRole(
      PLATFORM_SCOPE,
      {
        tenant: 'acme',
        key: 'role-reader',
        displayName: 'The readers',
        permissionKeys: ['workspace.read'],
      },
      CONTEXT
    )
    expect(result.created).toBe(true)
    expect(result.role.key).toBe('role-reader')
    expect(result.role.permissionKeys).toEqual(['workspace.read'])
    expect(result.audit.action).toBe('role.created')
  })

  test('the memberships are replaced by the second call', async () => {
    const administration = serviceOf(fakes)
    await administration.upsertRole(
      PLATFORM_SCOPE,
      {
        tenant: 'acme',
        key: 'role-replaced',
        permissionKeys: ['workspace.first', 'workspace.second'],
      },
      CONTEXT
    )
    const second = await administration.upsertRole(
      PLATFORM_SCOPE,
      {
        tenant: 'acme',
        key: 'role-replaced',
        permissionKeys: ['workspace.second'],
      },
      CONTEXT
    )
    expect(second.created).toBe(false)
    expect(second.role.permissionKeys).toEqual(['workspace.second'])
    expect(second.audit.action).toBe('role.updated')
  })

  test('a role names another role, and the permissions follow', async () => {
    const administration = serviceOf(fakes)
    await administration.upsertRole(
      PLATFORM_SCOPE,
      {
        tenant: 'acme',
        key: 'role-editor',
        permissionKeys: ['workspace.write'],
      },
      CONTEXT
    )
    const parent = await administration.upsertRole(
      PLATFORM_SCOPE,
      {
        tenant: 'acme',
        key: 'role-chief',
        roleKeys: ['role-editor'],
      },
      CONTEXT
    )
    expect(parent.role.roleKeys).toEqual(['role-editor'])
    // The permissions of the named role are the permissions of the role
    // that names it.
    const expansion = await fakes.roles.expand(parent.role.id)
    expect(expansion).toEqual(['workspace.write'])
  })

  test('a role that names itself is refused', async () => {
    const administration = serviceOf(fakes)
    await administration.upsertRole(
      PLATFORM_SCOPE,
      { tenant: 'acme', key: 'role-loop', permissionKeys: [] },
      CONTEXT
    )
    await expect(
      administration.upsertRole(
        PLATFORM_SCOPE,
        { tenant: 'acme', key: 'role-loop', roleKeys: ['role-loop'] },
        CONTEXT
      )
    ).rejects.toThrow(/does not name itself/)
  })

  test('a cycle of the roles is refused', async () => {
    const administration = serviceOf(fakes)
    await administration.upsertRole(
      PLATFORM_SCOPE,
      { tenant: 'acme', key: 'role-first', permissionKeys: [] },
      CONTEXT
    )
    await administration.upsertRole(
      PLATFORM_SCOPE,
      { tenant: 'acme', key: 'role-second', roleKeys: ['role-first'] },
      CONTEXT
    )
    // The second role names the first one, and the first one may not
    // name the second one: the cycle would hold the roles forever.
    await expect(
      administration.upsertRole(
        PLATFORM_SCOPE,
        { tenant: 'acme', key: 'role-first', roleKeys: ['role-second'] },
        CONTEXT
      )
    ).rejects.toThrow(/names the role/)
  })

  test('a role that does not exist is a not found', async () => {
    const administration = serviceOf(fakes)
    await expect(
      administration.upsertRole(
        PLATFORM_SCOPE,
        { tenant: 'acme', key: 'role-unknown', roleKeys: ['role-that-does-not-exist'] },
        CONTEXT
      )
    ).rejects.toThrow(/does not exist/)
  })

  test('the roles of a tenant are listed', async () => {
    const administration = serviceOf(fakes)
    await administration.upsertRole(
      PLATFORM_SCOPE,
      { tenant: 'acme', key: 'role-listed', permissionKeys: [] },
      CONTEXT
    )
    const page = await administration.listRoles(PLATFORM_SCOPE, { tenant: 'acme' })
    expect(page.total).toBeGreaterThan(0)
    expect(page.roles.some((row) => row.key === 'role-listed')).toBe(true)
    expect(page.limit).toBe(50)
    expect(page.offset).toBe(0)
  })

  test('the list of the roles is filtered by the key', async () => {
    const administration = serviceOf(fakes)
    await administration.upsertRole(
      PLATFORM_SCOPE,
      { tenant: 'acme', key: 'role-filtered', permissionKeys: [] },
      CONTEXT
    )
    const page = await administration.listRoles(PLATFORM_SCOPE, {
      tenant: 'acme',
      key: 'role-filtered',
    })
    expect(page.roles.length).toBe(1)
    expect(page.roles[0]!.key).toBe('role-filtered')
    expect(page.total).toBe(1)
  })

  test('a grant of a role is created for the principal', async () => {
    const administration = serviceOf(fakes)
    const principal = await administration.upsertPrincipal(
      PLATFORM_SCOPE,
      { tenant: 'acme', externalSubject: 'the-subject-of-a-role' },
      CONTEXT
    )
    await administration.upsertRole(
      PLATFORM_SCOPE,
      { tenant: 'acme', key: 'role-granted', permissionKeys: ['workspace.granted'] },
      CONTEXT
    )
    const grant = await administration.upsertGrant(
      PLATFORM_SCOPE,
      {
        tenant: 'acme',
        userId: principal.principal.id,
        role: 'role-granted',
      },
      CONTEXT
    )
    expect(grant.grant.role).toBe('role-granted')
    expect(grant.grant.permission).toBeNull()
    expect(grant.grant.userId).toBe(principal.principal.id)
    expect(grant.audit.action).toBe('grant.created')
  })

  test('a grant names a permission or a role, and not both', async () => {
    const administration = serviceOf(fakes)
    const principal = await administration.upsertPrincipal(
      PLATFORM_SCOPE,
      { tenant: 'acme', externalSubject: 'the-subject-of-an-ambiguous-grant' },
      CONTEXT
    )
    await administration.upsertRole(
      PLATFORM_SCOPE,
      { tenant: 'acme', key: 'role-ambiguous', permissionKeys: [] },
      CONTEXT
    )
    await expect(
      administration.upsertGrant(
        PLATFORM_SCOPE,
        {
          tenant: 'acme',
          userId: principal.principal.id,
          permission: 'workspace.ambiguous',
          role: 'role-ambiguous',
        },
        CONTEXT
      )
    ).rejects.toThrow(/names a permission or a role/)
    await expect(
      administration.upsertGrant(
        PLATFORM_SCOPE,
        { tenant: 'acme', userId: principal.principal.id },
        CONTEXT
      )
    ).rejects.toThrow(/names a permission or a role/)
  })

  test('a grant of a role that does not exist is a not found', async () => {
    const administration = serviceOf(fakes)
    const principal = await administration.upsertPrincipal(
      PLATFORM_SCOPE,
      { tenant: 'acme', externalSubject: 'the-subject-of-a-missing-role' },
      CONTEXT
    )
    await expect(
      administration.upsertGrant(
        PLATFORM_SCOPE,
        { tenant: 'acme', userId: principal.principal.id, role: 'role-nowhere' },
        CONTEXT
      )
    ).rejects.toThrow(/does not exist/)
  })

  test('a role that a grant names is not removed', async () => {
    const administration = serviceOf(fakes)
    const principal = await administration.upsertPrincipal(
      PLATFORM_SCOPE,
      { tenant: 'acme', externalSubject: 'the-subject-of-a-kept-role' },
      CONTEXT
    )
    const role = await administration.upsertRole(
      PLATFORM_SCOPE,
      { tenant: 'acme', key: 'role-kept', permissionKeys: [] },
      CONTEXT
    )
    await administration.upsertGrant(
      PLATFORM_SCOPE,
      { tenant: 'acme', userId: principal.principal.id, role: 'role-kept' },
      CONTEXT
    )
    await expect(administration.removeRole(PLATFORM_SCOPE, role.role.id, CONTEXT)).rejects.toThrow(
      /named by a grant/
    )
  })

  test('a role that no grant names is removed', async () => {
    const administration = serviceOf(fakes)
    const role = await administration.upsertRole(
      PLATFORM_SCOPE,
      { tenant: 'acme', key: 'role-removed', permissionKeys: [] },
      CONTEXT
    )
    const audit = await administration.removeRole(PLATFORM_SCOPE, role.role.id, CONTEXT)
    expect(audit.action).toBe('role.removed')
    const found = await administration.listRoles(PLATFORM_SCOPE, {
      tenant: 'acme',
      key: 'role-removed',
    })
    expect(found.total).toBe(0)
  })
})
