import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  DecisionRepository,
  GrantRepository,
  PermissionRepository,
  RoleRepository,
  UserRepository,
  type Database,
} from '../../src/platform/postgres'
import { seedTenant } from '../fixtures/tenant'
import { openTestDatabase } from './database'

/**
 * The roles of Access, against the database (spec §3.6).
 *
 * A role holds permissions, and it may name another role: the
 * permissions of the named role are the permissions of the role that
 * names it. The grant of a role holds the role for the subject, and the
 * decision expands it.
 *
 * The test does not trust the application: the cycle of the roles is
 * written with a statement of its own, and the database refuses it.
 */
let database: Database
let tenantId: string
let userId: string
let permissionId: string
let secondPermissionId: string

beforeAll(async () => {
  database = await openTestDatabase()
  const seeded = await seedTenant(database)
  tenantId = seeded.tenantId
  userId = seeded.userId as string
  const permissions = new PermissionRepository(database)
  permissionId = (await permissions.create({ tenantId, key: 'workspace.read' })).id
  secondPermissionId = (await permissions.create({ tenantId, key: 'workspace.write' })).id
})

afterAll(async () => {
  await database.close()
})

describe('the roles of Access', () => {
  test('a role holds the permission it is given', async () => {
    const roles = new RoleRepository(database)
    const role = await roles.create({ tenantId, key: 'role-reader' })
    await roles.grantPermission(role.id, permissionId)
    expect(await roles.permissionsOf(role.id)).toEqual(['workspace.read'])
    expect(await roles.expandedPermissionsOf(role.id)).toEqual(['workspace.read'])
  })

  test('a role holds the permissions of the role it names', async () => {
    const roles = new RoleRepository(database)
    const editor = await roles.create({ tenantId, key: 'role-editor' })
    await roles.grantPermission(editor.id, secondPermissionId)
    const chief = await roles.create({ tenantId, key: 'role-chief' })
    await roles.nest(chief.id, editor.id)
    expect(await roles.descendants(chief.id)).toEqual(['role-editor'])
    expect(await roles.expandedPermissionsOf(chief.id)).toEqual(['workspace.write'])
  })

  test('the nesting is transitive', async () => {
    const roles = new RoleRepository(database)
    const reader = await roles.create({ tenantId, key: 'role-transitive-reader' })
    await roles.grantPermission(reader.id, permissionId)
    const editor = await roles.create({ tenantId, key: 'role-transitive-editor' })
    await roles.nest(editor.id, reader.id)
    const chief = await roles.create({ tenantId, key: 'role-transitive-chief' })
    await roles.nest(chief.id, editor.id)
    expect(await roles.expandedPermissionsOf(chief.id)).toEqual(['workspace.read'])
  })

  test('a cycle of the roles is refused by the database', async () => {
    const roles = new RoleRepository(database)
    const first = await roles.create({ tenantId, key: 'role-cycle-first' })
    const second = await roles.create({ tenantId, key: 'role-cycle-second' })
    await roles.nest(first.id, second.id)
    // The first role names the second one, and the second one may not
    // name the first one: the check is deferred to the end of the
    // transaction, and the statement that writes it fails.
    await expect(roles.nest(second.id, first.id)).rejects.toThrow(/names a role that names it back/)
  })

  test('a grant of a role holds the role for the principal', async () => {
    const roles = new RoleRepository(database)
    const grants = new GrantRepository(database)
    const role = await roles.create({ tenantId, key: 'role-granted' })
    await roles.grantPermission(role.id, permissionId)
    const grant = await grants.create({
      tenantId,
      userId,
      groupId: null,
      permissionId: null,
      roleId: role.id,
    })
    expect(grant.roleKey).toBe('role-granted')
    expect(grant.permissionKey).toBeNull()
    const found = await grants.findLive(
      tenantId,
      { userId, groupId: null },
      null,
      role.id,
      null,
      null
    )
    expect(found?.id).toBe(grant.id)
  })

  test('the decision sees the permission of the role', async () => {
    const roles = new RoleRepository(database)
    const grants = new GrantRepository(database)
    const decisions = new DecisionRepository(database, 2000)
    const principal = await new UserRepository(database).create({
      tenantId,
      externalSubject: 'the-subject-of-a-role',
    })
    const role = await roles.create({ tenantId, key: 'role-decided' })
    await roles.grantPermission(role.id, permissionId)
    await grants.create({
      tenantId,
      userId: principal.id,
      groupId: null,
      permissionId: null,
      roleId: role.id,
    })
    const facts = await decisions.decide({
      subject: principal.id,
      workspaceId: '11111111-1111-4111-8111-111111111111',
      routeId: 'workspace-api',
      roles: [],
      tenantId,
    })
    expect(facts.liveGrant).toBe(true)
  })

  test('the keys of the permissions of the token hold the role', async () => {
    const roles = new RoleRepository(database)
    const grants = new GrantRepository(database)
    const principal = await new UserRepository(database).create({
      tenantId,
      externalSubject: 'the-subject-of-the-keys',
    })
    const role = await roles.create({ tenantId, key: 'role-of-the-keys' })
    await roles.grantPermission(role.id, secondPermissionId)
    await grants.create({
      tenantId,
      userId: principal.id,
      groupId: null,
      permissionId: null,
      roleId: role.id,
    })
    const keys = await grants.findLivePermissionKeys(principal.id)
    expect(keys).toContain('workspace.write')
  })
})
