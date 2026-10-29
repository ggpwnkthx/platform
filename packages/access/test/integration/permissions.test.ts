import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { PermissionRepository, type Database } from '../../src/platform/postgres'
import { platformScope, tenantScope } from '../../src/domains/administration'
import { OTHER_TENANT, seedTenant } from '../fixtures/tenant'
import { openTestDatabase } from './database'

let database: Database
let permissions: PermissionRepository
let tenantId: string

beforeAll(async () => {
  database = await openTestDatabase()
  const seeded = await seedTenant(database)
  tenantId = seeded.tenantId
  permissions = new PermissionRepository(database)
})

afterAll(async () => {
  await database.close()
})

describe('the permissions of Access', () => {
  test('a permission of a tenant is created and read back', async () => {
    const created = await permissions.create(
      { tenantId, key: 'workspace.read' },
      tenantScope(tenantId)
    )
    expect(created.enabled).toBe(true)
    expect(created.tenantId).toBe(tenantId)
    expect((await permissions.findByTenantAndKey(tenantId, 'workspace.read'))?.id).toBe(created.id)
  })

  test('a permission of the catalogue belongs to every tenant', async () => {
    const created = await permissions.create({ key: 'platform.read' }, platformScope())
    expect(created.tenantId).toBeNull()
    expect((await permissions.findCataloguePermission('platform.read', platformScope()))?.id).toBe(
      created.id
    )

    const listed = await permissions.findByTenant(tenantId)
    expect(listed.some((row) => row.key === 'platform.read')).toBe(true)
    expect(listed.some((row) => row.key === 'workspace.read')).toBe(true)
  })

  test('the catalogue holds one row per key', async () => {
    await expect(permissions.create({ key: 'platform.read' }, platformScope())).rejects.toThrow()
  })

  test('a permission is disabled and enabled again', async () => {
    const created = await permissions.create(
      { tenantId, key: 'workspace.write' },
      tenantScope(tenantId)
    )
    const disabled = await permissions.setEnabled(created.id, false, tenantScope(tenantId))
    expect(disabled?.enabled).toBe(false)
    const enabled = await permissions.setEnabled(created.id, true, tenantScope(tenantId))
    expect(enabled?.enabled).toBe(true)
  })

  test('two tenants hold a permission of the same key', async () => {
    // A key is a name inside a tenant: the rows live side by side, and
    // the row of one tenant is never the row of the other.
    const other = await seedTenant(database, { tenant: OTHER_TENANT })

    const mine = await permissions.createOrFind(
      { tenantId, key: 'workspace.shared' },
      tenantScope(tenantId)
    )
    const theirs = await permissions.createOrFind(
      { tenantId: other.tenantId, key: 'workspace.shared' },
      tenantScope(other.tenantId)
    )
    expect(theirs.id).not.toBe(mine.id)
    expect(theirs.tenantId).toBe(other.tenantId)

    // The call that finds the row that is already there returns it.
    const again = await permissions.createOrFind(
      { tenantId: other.tenantId, key: 'workspace.shared' },
      tenantScope(other.tenantId)
    )
    expect(again.id).toBe(theirs.id)
  })
})
