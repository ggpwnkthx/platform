import { describe, expect, test } from 'bun:test'
import { CONTEXT, TENANT, createFakes, serviceOf } from './fakes'
import { PLATFORM_SCOPE } from './index'

/**
 * The role that administers a tenant (spec §6.4).
 *
 * A tenant is created with the role that administers it: the role holds
 * the permission that opens the administration of the tenant, and the
 * first identity of the tenant is given the role.
 */

const fakes = createFakes()

/**
 * The permissions the role of the administration holds.
 *
 * The administration of a tenant needs the right to open it, the detail
 * of the status of the services, and the capabilities that administer a
 * workspace: its model and its audit.
 */
const ADMIN_PERMISSIONS = [
  'console.admin',
  'console.status',
  'data.audit.read',
  'data.model.read',
  'data.model.write',
  'data.workspace.create',
]

/** The roles of a tenant. */
async function rolesOf(
  administration: ReturnType<typeof serviceOf>,
  slug: string
): Promise<{ key: string; permissionKeys: string[] }[]> {
  const page = await administration.listRoles(PLATFORM_SCOPE, {
    tenant: slug,
    limit: '50',
    offset: '0',
  })
  return page.roles.map((role) => ({
    key: role.key,
    permissionKeys: role.permissionKeys,
  }))
}

describe('the role that administers a tenant', () => {
  test('a tenant that is created holds the role of the administration', async () => {
    const administration = serviceOf(fakes)
    await administration.upsertTenant(
      PLATFORM_SCOPE,
      {
        ...TENANT,
        slug: 'acme-created',
        displayName: 'Acme Created',
        clientId: 'gateway-acme-created',
        issuer: 'https://login.acme-created.example',
        emailDomain: null,
      },
      CONTEXT
    )

    const roles = await rolesOf(administration, 'acme-created')
    expect(roles.length).toBe(1)
    expect(roles[0]?.key).toBe('admin')
    // The role holds the permissions an administration needs: the right
    // to open it, the detail of the status of the services, and the
    // capabilities that administer a workspace.
    expect(roles[0]?.permissionKeys).toEqual(ADMIN_PERMISSIONS)
  })

  test('a tenant that is written again keeps one role of the administration', async () => {
    const administration = serviceOf(fakes)
    const registration = {
      ...TENANT,
      slug: 'acme-written',
      displayName: 'Acme Written',
      clientId: 'gateway-acme-written',
      issuer: 'https://login.acme-written.example',
      emailDomain: null,
    }
    await administration.upsertTenant(PLATFORM_SCOPE, registration, CONTEXT)
    await administration.upsertTenant(
      PLATFORM_SCOPE,
      { ...registration, displayName: 'Acme Written Again' },
      CONTEXT
    )

    const roles = await rolesOf(administration, 'acme-written')
    expect(roles.length).toBe(1)
    expect(roles[0]?.permissionKeys).toEqual(ADMIN_PERMISSIONS)
  })

  test('the role holds the permission the deployment names', async () => {
    const administration = serviceOf(fakes, { tenantAdminPermission: 'console.admin.custom' })
    await administration.upsertTenant(
      PLATFORM_SCOPE,
      {
        ...TENANT,
        slug: 'acme-named',
        displayName: 'Acme Named',
        clientId: 'gateway-acme-named',
        issuer: 'https://login.acme-named.example',
        emailDomain: null,
      },
      CONTEXT
    )

    const roles = await rolesOf(administration, 'acme-named')
    expect(roles[0]?.permissionKeys).toEqual([
      'console.admin.custom',
      'console.status',
      'data.audit.read',
      'data.model.read',
      'data.model.write',
      'data.workspace.create',
    ])
  })

  test('the role of the administration holds the permission again', async () => {
    const administration = serviceOf(fakes)
    const registration = {
      ...TENANT,
      slug: 'acme-restored',
      displayName: 'Acme Restored',
      clientId: 'gateway-acme-restored',
      issuer: 'https://login.acme-restored.example',
      emailDomain: null,
    }
    await administration.upsertTenant(PLATFORM_SCOPE, registration, CONTEXT)

    // The operator of the tenant takes the permissions away from the
    // role: the role that administers the tenant administers it, and the
    // permissions are given back when the tenant is written again.
    await administration.upsertRole(
      PLATFORM_SCOPE,
      { tenant: 'acme-restored', key: 'admin', permissionKeys: [] },
      CONTEXT
    )
    expect((await rolesOf(administration, 'acme-restored'))[0]?.permissionKeys).toEqual([])

    await administration.upsertTenant(
      PLATFORM_SCOPE,
      { ...registration, displayName: 'Acme Restored Again' },
      CONTEXT
    )
    expect((await rolesOf(administration, 'acme-restored'))[0]?.permissionKeys).toEqual(
      ADMIN_PERMISSIONS
    )
  })

  test('the role holds the capabilities that administer a workspace', async () => {
    const administration = serviceOf(fakes)
    await administration.upsertTenant(
      PLATFORM_SCOPE,
      {
        ...TENANT,
        slug: 'acme-workspace',
        displayName: 'Acme Workspace',
        clientId: 'gateway-acme-workspace',
        issuer: 'https://login.acme-workspace.example',
        emailDomain: null,
      },
      CONTEXT
    )

    const roles = await rolesOf(administration, 'acme-workspace')
    // The capabilities of a workspace are the ones of Data: its model
    // and its audit. They are granted on the workspaces where the role
    // is granted, and nowhere else.
    expect(roles[0]?.permissionKeys).toContain('data.model.write')
    expect(roles[0]?.permissionKeys).toContain('data.model.read')
    expect(roles[0]?.permissionKeys).toContain('data.audit.read')
    // The platform is never administered by a tenant administrator.
    expect(roles[0]?.permissionKeys).not.toContain('console.platform')
  })
})
