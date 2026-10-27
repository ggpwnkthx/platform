import { describe, expect, test } from 'bun:test'
import type { Grant, Group, Principal } from '../src/domains/access'
import {
  CONSOLE_KEYS,
  credentialFor,
  isLive,
  rightsOf,
  scopeOf,
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

  test('no key, no scope', () => {
    expect(scopeOf('acme', [], credentials).administers).toBeNull()
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
