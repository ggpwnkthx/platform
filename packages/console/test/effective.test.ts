import { describe, expect, test } from 'bun:test'
import type { Grant, Role } from '../src/domains/access'
import {
  checkGrant,
  effectivePermissionsOf,
  expandRole,
  expiryOf,
  type GrantDraft,
  grantAppliesTo,
  knownPermissionsOf,
  matchesRightsFilter,
  permissionsOfRole,
  rolesIncluding,
} from '../src/domains/operators'

const WS = '11111111-1111-4111-8111-111111111111'
const NOW = Date.parse('2026-06-01T00:00:00.000Z')

const grant = (extra: Partial<Grant>): Grant => ({
  id: 'g',
  tenant: 'acme',
  permission: null,
  workspaceId: null,
  routeId: null,
  expiresAt: null,
  revokedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...extra,
})

const role = (key: string, permissions: string[], roles: string[] = []): Role => ({
  id: `r-${key}`,
  tenant: 'acme',
  key,
  displayName: null,
  description: null,
  permissions,
  roles,
  createdAt: '2026-01-01T00:00:00.000Z',
})

const roles = [
  role('reader', ['content.read']),
  role('editor', ['content.write'], ['reader']),
  role('admin', ['content.admin'], ['editor']),
]

describe('the roles of a tenant', () => {
  test('a role holds its permissions and those of the roles it includes, with their chain', () => {
    expect(expandRole('admin', roles)).toEqual([
      { permission: 'content.admin', path: ['admin'] },
      { permission: 'content.write', path: ['admin', 'editor'] },
      { permission: 'content.read', path: ['admin', 'editor', 'reader'] },
    ])
    expect(permissionsOfRole('editor', roles)).toEqual(['content.read', 'content.write'])
  })

  test('a cycle ends the expansion instead of looping', () => {
    const cyclic = [role('a', ['p.a'], ['b']), role('b', ['p.b'], ['a'])]
    expect(permissionsOfRole('a', cyclic)).toEqual(['p.a', 'p.b'])
  })

  test('the roles that include a role are found through the chain', () => {
    expect(rolesIncluding('reader', roles).map((r) => r.key)).toEqual(['editor', 'admin'])
    expect(rolesIncluding('admin', roles)).toEqual([])
  })

  test('the known permissions are the ones of the grants and of the roles', () => {
    expect(knownPermissionsOf([grant({ permission: 'files.read' })], roles)).toEqual([
      'content.admin',
      'content.read',
      'content.write',
      'files.read',
    ])
  })
})

describe('the effective permissions of a user', () => {
  test('every permission says where it comes from', () => {
    const effective = effectivePermissionsOf(
      [
        { grant: grant({ id: '1', role: 'editor' }), group: 'team' },
        { grant: grant({ id: '2', permission: 'content.read' }), group: null },
        {
          grant: grant({ id: '3', permission: 'gone', revokedAt: '2026-01-02T00:00:00Z' }),
          group: null,
        },
      ],
      roles
    )
    expect(effective.map((entry) => entry.permission)).toEqual(['content.read', 'content.write'])
    const read = effective[0]!
    expect(read.sources.map((s) => [s.grant.id, s.group, s.roles])).toEqual([
      ['1', 'team', ['editor', 'reader']],
      ['2', null, []],
    ])
  })

  test('a grant applies to a workspace and a route it names, or names none of', () => {
    expect(grantAppliesTo(grant({ workspaceId: WS, routeId: 'data-api' }), WS, 'data-api')).toBe(
      true
    )
    expect(grantAppliesTo(grant({ workspaceId: null }), WS, 'data-api')).toBe(true)
    expect(grantAppliesTo(grant({ routeId: 'other' }), WS, 'data-api')).toBe(false)
    expect(grantAppliesTo(grant({ revokedAt: '2026-01-01T00:00:00Z' }), WS, 'data-api')).toBe(false)
  })
})

describe('the grant form', () => {
  const draft = (extra: Partial<GrantDraft>): GrantDraft => ({
    holder: 'user:u-1',
    kind: 'permission',
    role: '',
    permission: 'content.read',
    createPermission: false,
    workspace: 'all',
    workspaceId: '',
    routeId: '',
    expires: 'never',
    expiresAt: '',
    ...extra,
  })
  const known = { permissions: ['content.read'], roles: ['editor'] }

  test('a known permission on every workspace is a grant', () => {
    expect(checkGrant(draft({}), known, NOW)).toEqual({
      grant: {
        userId: 'u-1',
        permission: 'content.read',
        workspaceId: null,
        routeId: null,
        expiresAt: null,
      },
    })
  })

  test('a role is granted as a role, to a group, on one workspace, for a week', () => {
    const checked = checkGrant(
      draft({
        holder: 'group:team',
        kind: 'role',
        role: 'editor',
        workspace: 'one',
        workspaceId: WS,
        expires: '7d',
      }),
      known,
      NOW
    )
    expect(checked).toEqual({
      grant: {
        group: 'team',
        role: 'editor',
        workspaceId: WS,
        routeId: null,
        expiresAt: '2026-06-08T00:00:00.000Z',
      },
    })
  })

  test('a role written as a permission is refused, and says so', () => {
    const checked = checkGrant(draft({ permission: 'editor' }), known, NOW)
    expect('problems' in checked && checked.problems[0]?.message).toContain('is a role')
  })

  test('a permission the tenant does not name needs a confirmation', () => {
    const typo = checkGrant(draft({ permission: 'content.raed' }), known, NOW)
    expect('problems' in typo && typo.problems.map((p) => p.field)).toEqual(['permission'])
    const confirmed = checkGrant(
      draft({ permission: 'content.raed', createPermission: true }),
      known,
      NOW
    )
    expect('grant' in confirmed).toBe(true)
  })

  test('a holder, a workspace and a moment are required when the form asks for them', () => {
    const checked = checkGrant(
      draft({ holder: '', workspace: 'one', expires: 'custom', expiresAt: '2020-01-01T00:00' }),
      known,
      NOW
    )
    expect('problems' in checked && checked.problems.map((p) => p.field)).toEqual([
      'holder',
      'workspaceId',
      'expiresAt',
    ])
  })

  test('a custom moment without a zone is UTC', () => {
    expect(expiryOf('custom', '2026-07-01T12:00', NOW)).toBe('2026-07-01T12:00:00.000Z')
    expect(expiryOf('never', '', NOW)).toBeNull()
    expect(() => expiryOf('custom', 'soon', NOW)).toThrow(RangeError)
  })
})

describe('the filter of the rights', () => {
  const filter = { holder: '', right: '', workspace: '' }
  test('a filter matches the holder, the right and the workspace by a part of them', () => {
    const g = grant({ role: 'editor', workspaceId: WS })
    expect(matchesRightsFilter(g, 'Alice', { ...filter, holder: 'ali' })).toBe(true)
    expect(matchesRightsFilter(g, 'Alice', { ...filter, right: 'edit' })).toBe(true)
    expect(matchesRightsFilter(g, 'Alice', { ...filter, workspace: '1111' })).toBe(true)
    expect(matchesRightsFilter(g, 'Alice', { ...filter, holder: 'bob' })).toBe(false)
    expect(matchesRightsFilter(grant({}), 'Bob', { ...filter, workspace: 'every' })).toBe(true)
  })
})
