import { describe, expect, test } from 'bun:test'
import type { Grant, Group, Principal } from '../src/domains/access'
import {
  CONSOLE_KEYS,
  credentialFor,
  DATA_KEYS,
  groupsOf,
  isLive,
  mayCreateWorkspaces,
  memberNameOf,
  rightsOf,
  scopeOf,
  signerOfUnreadJoin,
  workspacesOf,
} from '../src/domains/operators'

const credentials = {
  platform: 'the-platform-token-0001',
  tenants: { acme: 'the-acme-token-00001' },
}

const grant = (extra: Partial<Grant>): Grant => ({
  id: 'g',
  tenant: 'acme',
  permission: 'content.reader',
  workspaceId: null,
  routeId: null,
  expiresAt: null,
  revokedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...extra,
})

const alice: Principal = {
  id: 'u-alice',
  tenant: 'acme',
  provider: 'default',
  externalSubject: 'user-alice',
  email: 'alice@acme.test',
  displayName: 'Alice',
  status: 'active',
  lastLoginAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
}

describe('the scope of an operator', () => {
  test('console.admin administers the tenant of the caller, and nothing else', () => {
    const scope = scopeOf('acme', [CONSOLE_KEYS.admin], credentials)
    expect(scope.administers).toBe('tenant')
    expect(scope.status).toBe(false)
    expect(credentialFor(scope, credentials, 'acme')).toBe('the-acme-token-00001')
    expect(credentialFor(scope, credentials, 'globex')).toBeNull()
  })

  test('console.platform administers every tenant, with the credential of the platform', () => {
    const scope = scopeOf('acme', [CONSOLE_KEYS.platform], credentials)
    expect(scope.administers).toBe('platform')
    expect(scope.status).toBe(true)
    expect(credentialFor(scope, credentials, 'globex')).toBe('the-platform-token-0001')
  })

  test('a key without a credential opens nothing', () => {
    const scope = scopeOf('globex', [CONSOLE_KEYS.admin], { platform: null, tenants: {} })
    expect(scope.administers).toBeNull()
  })

  test('console.platform without the credential of the platform is the scope of the tenant', () => {
    const scope = scopeOf('acme', [CONSOLE_KEYS.platform], {
      platform: null,
      tenants: credentials.tenants,
    })
    expect(scope.administers).toBe('tenant')
  })

  test('a new member of a group the console could not read is signed where Access still answers', () => {
    // An operator of the platform may always add a member.
    const platform = scopeOf('acme', [CONSOLE_KEYS.platform], credentials)
    expect(signerOfUnreadJoin(platform, credentials, 'globex')).toBe('platform')
    // The credential of a tenant is refused by Access when the group
    // gives a capability of the platform: Access answers.
    const tenant = scopeOf('acme', [CONSOLE_KEYS.admin], credentials)
    expect(signerOfUnreadJoin(tenant, credentials, 'acme')).toBe('tenant')
    // A console that holds the credential of the platform alone signs
    // for the operator of a tenant with it, and Access never refuses
    // that credential: nobody signs.
    const alone = { platform: credentials.platform, tenants: {} }
    const unarmed = scopeOf('acme', [CONSOLE_KEYS.admin], alone)
    expect(unarmed.administers).toBe('tenant')
    expect(signerOfUnreadJoin(unarmed, alone, 'acme')).toBeNull()
  })

  test('no key, no scope', () => {
    expect(scopeOf('acme', [], credentials).administers).toBeNull()
  })

  test('the right that creates a workspace is a right of the tenant', () => {
    const scope = scopeOf('acme', [DATA_KEYS.workspaceCreate], credentials)
    expect(mayCreateWorkspaces(scope)).toBe(true)
  })

  test('a caller without the right creates no workspace', () => {
    const scope = scopeOf('acme', [CONSOLE_KEYS.admin], credentials)
    expect(mayCreateWorkspaces(scope)).toBe(false)
    expect(mayCreateWorkspaces(scopeOf('acme', [], credentials))).toBe(false)
  })
})

describe('the rights of a user', () => {
  const groups: Group[] = [
    {
      id: 'grp',
      tenant: 'acme',
      key: 'editors',
      displayName: null,
      members: ['user-alice'],
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ]

  test('a user holds its own rights and the rights of its groups', () => {
    const rights = rightsOf(
      alice,
      [
        grant({ id: '1', userId: 'u-alice', permission: 'content.reader' }),
        grant({ id: '2', group: 'editors', permission: 'content.editor' }),
        grant({ id: '3', userId: 'u-bob', permission: 'content.admin' }),
      ],
      groups
    )
    expect(rights.map((right) => [right.grant.id, right.group])).toEqual([
      ['2', 'editors'],
      ['1', null],
    ])
  })

  test('a group names a user of another provider with its provider', () => {
    // Two providers of a tenant hand out the same subject: the subject
    // alone names the user of the default provider, and nobody else.
    const contractor: Principal = { ...alice, id: 'u-erin', provider: 'contractors' }
    expect(memberNameOf(alice)).toBe('user-alice')
    expect(memberNameOf(contractor)).toBe('contractors/user-alice')
    expect(groupsOf(alice, groups).map((group) => group.key)).toEqual(['editors'])
    expect(groupsOf(contractor, groups)).toEqual([])
    const mixed: Group[] = [{ ...groups[0]!, members: ['contractors/user-alice'] }]
    expect(groupsOf(contractor, mixed).map((group) => group.key)).toEqual(['editors'])
    expect(groupsOf(alice, mixed)).toEqual([])
  })

  test('a revoked or an expired right is not live', () => {
    expect(isLive(grant({ revokedAt: '2026-01-02T00:00:00.000Z' }))).toBe(false)
    expect(isLive(grant({ expiresAt: '2020-01-01T00:00:00.000Z' }))).toBe(false)
    expect(isLive(grant({ expiresAt: '2999-01-01T00:00:00.000Z' }))).toBe(true)
  })

  test('the workspaces of a user are the uuids its rights name, outside the route of the console', () => {
    const found = workspacesOf(
      [
        {
          grant: grant({
            workspaceId: '11111111-1111-4111-8111-111111111111',
            routeId: 'data-api',
          }),
          group: null,
        },
        { grant: grant({ workspaceId: 'acme', routeId: 'console' }), group: null },
        { grant: grant({ workspaceId: null, routeId: 'data-api' }), group: 'editors' },
      ],
      'console'
    )
    expect(found.ids).toEqual(['11111111-1111-4111-8111-111111111111'])
    expect(found.everyWorkspace).toBe(true)
  })
})
