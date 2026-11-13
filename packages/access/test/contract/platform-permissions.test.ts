import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createTestClient } from '../fixtures/client'
import { startTestRuntime, TEST_ENCRYPTION_KEY, type TestRuntime } from '../fixtures/runtime'

/**
 * The capabilities that are not relative to a tenant (spec §3.3).
 *
 * `console.platform` opens the administration of every tenant, and it
 * is the platform's: the credential of a tenant may not grant it, and
 * only the platform gives it.
 */

/** The token of the administration of the platform. */
const ADMIN_TOKEN = 'the-admin-token'
/** The token of the operator of the tenant. */
const TENANT_TOKEN = 'the-token-of-acme-00000001'

let service: TestRuntime

beforeAll(async () => {
  service = await startTestRuntime({
    ACCESS_ADMIN_TOKEN: ADMIN_TOKEN,
    ACCESS_SECRET_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
    ACCESS_ADMIN_TOKENS: JSON.stringify({
      [TENANT_TOKEN]: { tenant: 'acme', operator: 'alice' },
    }),
  })

  const admin = createTestClient(service.base, ADMIN_TOKEN).call
  await admin('/v1/admin/tenants', 'POST', {
    slug: 'acme',
    displayName: 'Acme',
    issuer: 'https://login.acme.example',
    idpClientId: 'access-acme',
    idpClientSecret: 'the-secret-of-the-provider',
    clientId: 'gateway-acme',
    clientSecret: 'the-secret-of-the-gateway',
    clientRedirectUris: ['https://gateway-acme.example.com/auth/callback'],
  })
})

afterAll(async () => {
  await service.stop()
})

describe('the capabilities of the platform', () => {
  test('the credential of a tenant may not grant a capability of the platform', async () => {
    const admin = createTestClient(service.base, ADMIN_TOKEN).call
    const principal = await admin('/v1/admin/users', 'POST', {
      tenant: 'acme',
      externalSubject: 'the-subject-of-a-tenant-operator',
    })

    const ofAcme = createTestClient(service.base, TENANT_TOKEN).call
    const grant = await ofAcme('/v1/admin/grants', 'PUT', {
      tenant: 'acme',
      userId: principal.body.id,
      permission: 'console.platform',
      workspaceId: 'acme',
      routeId: 'console',
    })
    expect(grant.status).toBe(403)
    expect(grant.body.error).toBe('forbidden')

    // The right of the tenant is untouched: nothing was written.
    const grants = await admin('/v1/admin/grants?tenant=acme', 'GET')
    expect(grants.body.grants ?? []).toEqual([])
  })

  test('the credential of the platform grants a capability of the platform', async () => {
    const admin = createTestClient(service.base, ADMIN_TOKEN).call
    const principal = await admin('/v1/admin/users', 'POST', {
      tenant: 'acme',
      externalSubject: 'the-subject-of-a-platform-operator',
    })
    const grant = await admin('/v1/admin/grants', 'PUT', {
      tenant: 'acme',
      userId: principal.body.id,
      permission: 'console.platform',
      workspaceId: 'acme',
      routeId: 'console',
    })
    expect(grant.status).toBe(200)
    expect(grant.body.permission).toBe('console.platform')
    // The grant is the one of the tenant: the holder is a principal of
    // it, and the capability is the platform's.
    expect(grant.body.tenant).toBe('acme')
  })

  test('the role of a tenant may not hold a capability of the platform', async () => {
    const ofAcme = createTestClient(service.base, TENANT_TOKEN).call
    const role = await ofAcme('/v1/admin/roles', 'PUT', {
      tenant: 'acme',
      key: 'platform',
      permissions: ['console.platform'],
    })
    expect(role.status).toBe(403)
    expect(role.body.error).toBe('forbidden')
  })
})

/**
 * The other ways a principal comes to hold a capability (spec §3.3.1).
 *
 * The platform may put a capability in a role of a tenant, and grant it
 * to a group of a tenant. From then on the role and the group hand the
 * capability out: the credential of a tenant grants neither, names
 * neither in a role of its own, and adds no member to the group.
 */
describe('the capabilities of the platform, held by a role or by a group', () => {
  const admin = (path: string, method: string, body?: Record<string, unknown>) =>
    createTestClient(service.base, ADMIN_TOKEN).call(path, method, body)
  const ofAcme = (path: string, method: string, body?: Record<string, unknown>) =>
    createTestClient(service.base, TENANT_TOKEN).call(path, method, body)
  const principalOf = async (externalSubject: string): Promise<string> =>
    String((await admin('/v1/admin/users', 'POST', { tenant: 'acme', externalSubject })).body.id)

  test('the credential of a tenant may not grant a role that holds one', async () => {
    const root = await admin('/v1/admin/roles', 'PUT', {
      tenant: 'acme',
      key: 'root',
      permissions: ['console.platform'],
    })
    expect(root.status).toBe(201)

    const colleague = await principalOf('the-subject-of-a-colleague')
    const grant = { tenant: 'acme', userId: colleague, role: 'root', workspaceId: 'acme' }
    const refused = await ofAcme('/v1/admin/grants', 'PUT', grant)
    expect(refused.status).toBe(403)
    expect(refused.body.error).toBe('forbidden')
    expect(refused.body.message).toContain('the role "root" holds "console.platform"')
    // Nothing was written: the colleague holds no grant.
    const held = await admin(`/v1/admin/grants?tenant=acme&userId=${colleague}`, 'GET')
    expect(held.body.grants).toEqual([])

    // The platform grants the role it filled.
    const given = await admin('/v1/admin/grants', 'PUT', grant)
    expect(given.status).toBe(200)
    expect(given.body.role).toBe('root')
  })

  test('a role of a tenant may not name a role that holds one, however deep', async () => {
    // Everybody who holds the role would hold the capability, without a grant.
    const named = await ofAcme('/v1/admin/roles', 'PUT', {
      tenant: 'acme',
      key: 'chief',
      permissions: ['workspace.read'],
      roles: ['root'],
    })
    expect(named.status).toBe(403)
    expect(named.body.message).toContain('the role "root" holds "console.platform"')
    const roles = await admin('/v1/admin/roles?tenant=acme&key=chief', 'GET')
    expect(roles.body.roles).toEqual([])

    // The platform names it, and the capability is now two roles deep.
    const chief = await admin('/v1/admin/roles', 'PUT', {
      tenant: 'acme',
      key: 'chief',
      roles: ['root'],
    })
    expect(chief.status).toBe(201)
    const board = await admin('/v1/admin/roles', 'PUT', {
      tenant: 'acme',
      key: 'board',
      roles: ['chief'],
    })
    expect(board.status).toBe(201)

    const deeper = await ofAcme('/v1/admin/roles', 'PUT', {
      tenant: 'acme',
      key: 'editors',
      roles: ['board'],
    })
    expect(deeper.status).toBe(403)
    const granted = await ofAcme('/v1/admin/grants', 'PUT', {
      tenant: 'acme',
      userId: await principalOf('the-subject-of-the-board'),
      role: 'board',
    })
    expect(granted.status).toBe(403)
    expect(granted.body.message).toContain('the role "board" holds "console.platform"')
  })

  test('the credential of a tenant takes the capability away from a role', async () => {
    // The role names the holder no more: it is the tenant's again.
    const lighter = await ofAcme('/v1/admin/roles', 'PUT', {
      tenant: 'acme',
      key: 'board',
      permissions: ['workspace.read'],
      roles: [],
    })
    expect(lighter.status).toBe(200)
    expect(lighter.body.roles).toEqual([])
    const granted = await ofAcme('/v1/admin/grants', 'PUT', {
      tenant: 'acme',
      userId: await principalOf('the-subject-of-a-reader'),
      role: 'board',
    })
    expect(granted.status).toBe(200)
  })

  test('a group that holds one is filled by the platform', async () => {
    await principalOf('the-first-of-the-team')
    await principalOf('the-second-of-the-team')
    const team = (members: string[], displayName?: string) => ({
      tenant: 'acme',
      key: 'platform-team',
      ...(displayName ? { displayName } : {}),
      members,
    })
    // The group is the tenant's while it holds nothing of the platform.
    expect((await ofAcme('/v1/admin/groups', 'POST', team(['the-first-of-the-team']))).status).toBe(
      201
    )
    const grant = await admin('/v1/admin/grants', 'PUT', {
      tenant: 'acme',
      group: 'platform-team',
      permission: 'console.platform',
      workspaceId: 'acme',
      routeId: 'console',
    })
    expect(grant.status).toBe(200)

    // A member of the group holds the capability: the credential of the
    // tenant adds none, whoever else the call keeps or removes.
    const both = team(['the-first-of-the-team', 'the-second-of-the-team'])
    const refused = await ofAcme('/v1/admin/groups', 'POST', both)
    expect(refused.status).toBe(403)
    expect(refused.body.error).toBe('forbidden')
    expect(refused.body.message).toContain('the group "platform-team" holds "console.platform"')
    const swapped = await ofAcme('/v1/admin/groups', 'POST', team(['the-second-of-the-team']))
    expect(swapped.status).toBe(403)
    const read = await admin('/v1/admin/groups?tenant=acme&key=platform-team', 'GET')
    const [group] = read.body.groups as { members: string[] }[]
    expect(group?.members).toEqual(['the-first-of-the-team'])

    // It keeps the members the group has, and renames it.
    const kept = await ofAcme(
      '/v1/admin/groups',
      'POST',
      team(['the-first-of-the-team'], 'The team of the platform')
    )
    expect(kept.status).toBe(200)
    expect(kept.body.displayName).toBe('The team of the platform')

    // The platform adds the member, and the tenant takes one away.
    const filled = await admin('/v1/admin/groups', 'POST', both)
    expect(filled.status).toBe(200)
    expect(filled.body.members).toHaveLength(2)
    const smaller = await ofAcme('/v1/admin/groups', 'POST', team(['the-second-of-the-team']))
    expect(smaller.status).toBe(200)
    expect(smaller.body.members).toEqual(['the-second-of-the-team'])

    // The grant is revoked: the group gives nothing of the platform, and
    // it is the tenant's to fill again.
    const revoked = await admin(`/v1/admin/grants/${grant.body.id}`, 'DELETE')
    expect(revoked.status).toBe(204)
    const again = await ofAcme('/v1/admin/groups', 'POST', both)
    expect(again.status).toBe(200)
    expect(again.body.members).toHaveLength(2)
  })

  test('a group holds the capability through a role as well', async () => {
    expect(
      (await admin('/v1/admin/groups', 'POST', { tenant: 'acme', key: 'on-call', members: [] }))
        .status
    ).toBe(201)
    // The role names the role that holds the capability.
    const grant = await admin('/v1/admin/grants', 'PUT', {
      tenant: 'acme',
      group: 'on-call',
      role: 'chief',
    })
    expect(grant.status).toBe(200)
    const joined = await ofAcme('/v1/admin/groups', 'POST', {
      tenant: 'acme',
      key: 'on-call',
      members: ['the-first-of-the-team'],
    })
    expect(joined.status).toBe(403)
    expect(joined.body.message).toContain('the group "on-call" holds "console.platform"')
  })
})
