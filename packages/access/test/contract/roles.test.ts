import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { tenantScope } from '../../src/domains/administration'
import { RoleRepository } from '../../src/platform/postgres'
import { createTestClient } from '../fixtures/client'
import { startTestRuntime, TEST_ENCRYPTION_KEY, type TestRuntime } from '../fixtures/runtime'
import { tenantPayload } from '../fixtures/tenant'

/**
 * The roles of the administration, over http (spec §10.11).
 *
 * The call replaces the memberships of a role: the permissions and the
 * roles it names are the ones the role holds, and what the call does
 * not name is taken away. An operator that takes a permission out of a
 * role and reads `200` has taken it out: the role is read back from the
 * database of the deployment, and not from the answer of the call.
 */
const ADMIN_TOKEN = 'the-admin-token'

let service: TestRuntime
let admin: (
  path: string,
  method: string,
  body?: Record<string, unknown>
) => Promise<{ status: number; body: Record<string, unknown> }>

/** The role of a key, as the list of the administration names it. */
async function roleOf(key: string): Promise<{ permissions: string[]; roles: string[] }> {
  const read = await admin(`/v1/admin/roles?tenant=acme&key=${key}`, 'GET')
  const [role] = read.body.roles as { permissions: string[]; roles: string[] }[]
  if (!role) throw new Error(`the role ${key} does not exist`)
  return role
}

beforeAll(async () => {
  service = await startTestRuntime({
    ACCESS_ADMIN_TOKEN: ADMIN_TOKEN,
    ACCESS_SECRET_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
  })
  admin = createTestClient(service.base, ADMIN_TOKEN).call

  await admin(
    '/v1/admin/tenants',
    'POST',
    tenantPayload({
      idpClientSecret: 'the-secret-of-the-provider',
      clientSecret: 'the-secret-of-the-gateway',
      clientRedirectUris: ['https://gateway-acme.example.com/auth/callback'],
    })
  )
  await admin('/v1/admin/roles', 'PUT', {
    tenant: 'acme',
    key: 'reader',
    permissions: ['content.read'],
  })
})

afterAll(async () => {
  await service.stop()
})

describe('the roles of the administration', () => {
  test('a role is created with the permissions and the roles it names', async () => {
    const created = await admin('/v1/admin/roles', 'PUT', {
      tenant: 'acme',
      key: 'editor',
      displayName: 'Editors',
      permissions: ['content.write', 'content.delete'],
      roles: ['reader'],
    })
    expect(created.status).toBe(201)
    expect(created.body.permissions).toEqual(['content.delete', 'content.write'])
    expect(created.body.roles).toEqual(['reader'])
  })

  test('the second call replaces the memberships: what it does not name is taken away', async () => {
    const updated = await admin('/v1/admin/roles', 'PUT', {
      tenant: 'acme',
      key: 'editor',
      displayName: 'Editors',
      permissions: ['content.write', 'content.publish'],
      roles: [],
    })
    expect(updated.status).toBe(200)
    // The answer names the role as it is, and so does the list: the
    // permission that was not named is gone, and so is the role.
    expect(updated.body.permissions).toEqual(['content.publish', 'content.write'])
    expect(updated.body.roles).toEqual([])
    expect(await roleOf('editor')).toMatchObject({
      permissions: ['content.publish', 'content.write'],
      roles: [],
    })
  })

  test('a call that names the same memberships changes nothing', async () => {
    const same = await admin('/v1/admin/roles', 'PUT', {
      tenant: 'acme',
      key: 'editor',
      permissions: ['content.publish', 'content.write'],
      roles: [],
    })
    expect(same.status).toBe(200)
    expect(await roleOf('editor')).toMatchObject({
      permissions: ['content.publish', 'content.write'],
      roles: [],
    })
  })

  test('a call that names nothing empties the role', async () => {
    const emptied = await admin('/v1/admin/roles', 'PUT', { tenant: 'acme', key: 'editor' })
    expect(emptied.status).toBe(200)
    expect(await roleOf('editor')).toMatchObject({ permissions: [], roles: [] })
  })

  test('what a call takes away is audited, like what it gives', async () => {
    const audit = await admin('/v1/admin/audit?tenant=acme&limit=200', 'GET')
    const actions = (audit.body.records as { action: string }[]).map((record) => record.action)
    expect(actions).toContain('role.permission.granted')
    expect(actions).toContain('role.permission.revoked')
    expect(actions).toContain('role.role.nested')
    expect(actions).toContain('role.role.unnested')
  })

  test('a principal that holds the role holds what the role holds now', async () => {
    await admin('/v1/admin/roles', 'PUT', {
      tenant: 'acme',
      key: 'publisher',
      permissions: ['content.publish', 'content.write'],
    })
    const principal = await admin('/v1/admin/users', 'POST', {
      tenant: 'acme',
      externalSubject: 'the-subject-of-a-publisher',
    })
    const grant = await admin('/v1/admin/grants', 'PUT', {
      tenant: 'acme',
      userId: principal.body.id,
      role: 'publisher',
    })
    expect(grant.status).toBe(200)
    // The permission leaves the role: the next expansion of the role
    // does not hold it, whoever holds the role.
    await admin('/v1/admin/roles', 'PUT', {
      tenant: 'acme',
      key: 'publisher',
      permissions: ['content.write'],
    })
    const keys = await service.runtime.repositories.grants.findLivePermissionKeys(
      String(principal.body.id)
    )
    expect(keys).toEqual(['content.write'])
  })

  test('a role the platform writes with a capability of the platform names the row of the catalogue', async () => {
    const written = await admin('/v1/admin/roles', 'PUT', {
      tenant: 'acme',
      key: 'root',
      permissions: ['console.platform'],
    })
    expect(written.status).toBe(201)
    // The row is the one every tenant grants (spec §3.3): the tenant
    // holds no row of its own for the key.
    const { permissions, tenants } = service.runtime.repositories
    const tenant = await tenants.findBySlug('acme')
    expect(await permissions.findByTenantAndKey(tenant!.id, 'console.platform')).toBeNull()
    const catalogue = await permissions.findCataloguePermission(
      'console.platform',
      tenantScope(tenant!.id)
    )
    expect(catalogue?.tenantId).toBeNull()
  })

  test('a key is taken away from a role whichever row gave it', async () => {
    // A role that was written with a key of the platform before the
    // catalogue held its row was given a row of the tenant for it, and
    // the catalogue holds the key since: the tenant sees two rows of one
    // key. The state is written here the way the storage held it.
    const { permissions, tenants } = service.runtime.repositories
    const tenant = await tenants.findBySlug('acme')
    const scope = tenantScope(tenant!.id)
    const created = await admin('/v1/admin/roles', 'PUT', {
      tenant: 'acme',
      key: 'legacy',
      permissions: ['content.read'],
    })
    const own = await permissions.create({ tenantId: tenant!.id, key: 'console.platform' }, scope)
    await new RoleRepository(service.runtime.database).grantPermission(
      String(created.body.id),
      own.id,
      scope
    )
    // The platform grants the capability as it is: the catalogue holds
    // the row of the key from then on, if it did not before.
    const operator = await admin('/v1/admin/users', 'POST', {
      tenant: 'acme',
      externalSubject: 'the-subject-of-an-operator-of-the-platform',
    })
    await admin('/v1/admin/grants', 'PUT', {
      tenant: 'acme',
      userId: operator.body.id,
      permission: 'console.platform',
      workspaceId: 'acme',
      routeId: 'console',
    })
    expect(await permissions.findCataloguePermission('console.platform', scope)).not.toBeNull()
    expect((await roleOf('legacy')).permissions).toEqual(['console.platform', 'content.read'])

    // The role is written without the key: it does not hold the key any
    // more, and a principal that holds the role does not either.
    const principal = await admin('/v1/admin/users', 'POST', {
      tenant: 'acme',
      externalSubject: 'the-subject-of-a-holder-of-the-legacy-role',
    })
    await admin('/v1/admin/grants', 'PUT', {
      tenant: 'acme',
      userId: principal.body.id,
      role: 'legacy',
    })
    const written = await admin('/v1/admin/roles', 'PUT', {
      tenant: 'acme',
      key: 'legacy',
      permissions: ['content.read'],
    })
    expect(written.status).toBe(200)
    expect(written.body.permissions).toEqual(['content.read'])
    expect((await roleOf('legacy')).permissions).toEqual(['content.read'])
    expect(
      await service.runtime.repositories.grants.findLivePermissionKeys(String(principal.body.id))
    ).toEqual(['content.read'])
  })
})
