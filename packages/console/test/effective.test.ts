import { describe, expect, test } from 'bun:test'
import type { Grant, Role } from '../src/domains/access'
import {
  administrationLostBy,
  administrationOf,
  checkGrant,
  effectivePermissionsOf,
  expandRole,
  expiryOf,
  type GrantDraft,
  grantAppliesTo,
  groupIsReadWhole,
  knownPermissionsOf,
  matchesRightsFilter,
  permissionsOfGrant,
  permissionsOfRole,
  permissionsOfWrite,
  platformKeysOfGroup,
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
    // The permissions the console knows the meaning of are named too,
    // the capabilities of the platform among them: a reader finds the
    // key it looks for, with what it opens or the reason it is refused,
    // rather than an absence.
    expect(knownPermissionsOf([grant({ permission: 'files.read' })], roles)).toEqual([
      'console.admin',
      'console.platform',
      'console.status',
      'content.admin',
      'content.read',
      'content.write',
      'data.audit.read',
      'data.model.read',
      'data.model.write',
      'data.workspace.create',
      'files.read',
    ])
  })

  test('a grant gives its permission, or what its role holds in effect', () => {
    expect(permissionsOfGrant(grant({ permission: 'files.read' }), roles)).toEqual(['files.read'])
    expect(permissionsOfGrant(grant({ role: 'editor' }), roles)).toEqual([
      'content.read',
      'content.write',
    ])
    expect(permissionsOfGrant(grant({ role: 'gone' }), roles)).toEqual([])
  })
})

describe('the write of a role', () => {
  test('a role is written with its permissions and with what the roles it includes hold', () => {
    // A role that comes to include another gives what the other holds:
    // the write is checked against all of it.
    const withRoot = [...roles, role('root', ['console.platform'])]
    expect(permissionsOfWrite({ permissions: ['content.export'] }, withRoot)).toEqual([
      'content.export',
    ])
    expect(
      permissionsOfWrite({ permissions: ['content.export'], roles: ['editor', 'root'] }, withRoot)
    ).toEqual(['console.platform', 'content.export', 'content.read', 'content.write'])
    // A role the tenant does not have adds nothing: Access refuses the write.
    expect(permissionsOfWrite({ roles: ['nobody'] }, withRoot)).toEqual([])
  })
})

describe('what a group gives of the platform', () => {
  const withRoot = [...roles, role('root', ['console.platform']), role('board', [], ['root'])]

  test('a live right of the group gives it, as it is or through a role', () => {
    // A member of a group holds what the group is granted: the key
    // itself, the role that holds it, and the role that includes one.
    const direct = [grant({ group: 'ops', permission: 'console.platform', workspaceId: 'acme' })]
    expect(platformKeysOfGroup('ops', direct, withRoot)).toEqual(['console.platform'])
    const through = [grant({ group: 'ops', role: 'board' })]
    expect(platformKeysOfGroup('ops', through, withRoot)).toEqual(['console.platform'])
  })

  test('the right is read wherever it holds, the way Access reads it', () => {
    // Access refuses the new member of a group whose live grants give
    // the capability, whatever workspace and route they name.
    const elsewhere = [grant({ group: 'ops', role: 'root', workspaceId: WS, routeId: 'data-api' })]
    expect(platformKeysOfGroup('ops', elsewhere, withRoot)).toEqual(['console.platform'])
  })

  test('the rights of the tenant, of a user and of another group give the group nothing', () => {
    const rights = [
      grant({ group: 'ops', role: 'editor' }),
      grant({ group: 'night', permission: 'console.platform' }),
      grant({ userId: 'u-1', permission: 'console.platform' }),
    ]
    expect(platformKeysOfGroup('ops', rights, withRoot)).toEqual([])
  })

  test('a right that was revoked or that ended gives nothing', () => {
    const over = [
      grant({ group: 'ops', role: 'root', revokedAt: '2026-01-02T00:00:00.000Z' }),
      grant({
        group: 'ops',
        permission: 'console.platform',
        expiresAt: '2026-01-02T00:00:00.000Z',
      }),
    ]
    expect(platformKeysOfGroup('ops', over, withRoot)).toEqual([])
  })

  test('an empty answer is certain only when the console read the rights whole', () => {
    // The console reads a bounded number of rows: a tenant that holds
    // more leaves it unable to say that a group gives nothing.
    const all = { rows: [grant({ group: 'ops', permission: 'content.read' })], complete: true }
    const everyRole = { rows: withRoot, complete: true }
    expect(groupIsReadWhole('ops', all, everyRole)).toBe(true)
    expect(groupIsReadWhole('ops', { ...all, complete: false }, everyRole)).toBe(false)

    // The roles matter when a live right of the group names one: a
    // deployment without roles refuses their list, and holds no such right.
    const noRole = { rows: [], complete: false }
    expect(groupIsReadWhole('ops', all, noRole)).toBe(true)
    const through = { rows: [grant({ group: 'ops', role: 'board' })], complete: true }
    expect(groupIsReadWhole('ops', through, noRole)).toBe(false)
    expect(groupIsReadWhole('night', through, noRole)).toBe(true)
    const ended = {
      rows: [grant({ group: 'ops', role: 'board', revokedAt: '2026-01-02T00:00:00.000Z' })],
      complete: true,
    }
    expect(groupIsReadWhole('ops', ended, noRole)).toBe(true)
  })
})

describe('the administration of a tenant', () => {
  const place = { tenant: 'acme', consoleRoute: 'console' }
  const administrators = [
    ...roles,
    role('admin-of-tenant', ['console.admin', 'console.status']),
    role('lead', ['content.admin'], ['admin-of-tenant']),
    role('root', ['console.platform', 'console.admin']),
  ]

  test('a right on the tenant itself that gives console.admin opens it', () => {
    expect(
      administrationOf(grant({ permission: 'console.admin', workspaceId: 'acme' }), [], place)
    ).toEqual({ key: 'console.admin', roles: [] })
    expect(
      administrationOf(grant({ role: 'lead', workspaceId: 'acme' }), administrators, place)
    ).toEqual({ key: 'console.admin', roles: ['lead', 'admin-of-tenant'] })
  })

  test('a right on every workspace holds on the tenant itself too', () => {
    expect(administrationOf(grant({ role: 'admin-of-tenant' }), administrators, place)).toEqual({
      key: 'console.admin',
      roles: ['admin-of-tenant'],
    })
  })

  test('the key of the platform is named first: it opens more', () => {
    expect(
      administrationOf(grant({ role: 'root', routeId: 'console' }), administrators, place)
    ).toEqual({ key: 'console.platform', roles: ['root'] })
  })

  test('a right that holds somewhere else, or that ended, opens nothing', () => {
    const elsewhere = grant({ role: 'admin-of-tenant', workspaceId: WS })
    expect(administrationOf(elsewhere, administrators, place)).toBeNull()
    const otherRoute = grant({ permission: 'console.admin', routeId: 'data-api' })
    expect(administrationOf(otherRoute, administrators, place)).toBeNull()
    const revoked = grant({ permission: 'console.admin', revokedAt: '2026-01-02T00:00:00Z' })
    expect(administrationOf(revoked, administrators, place)).toBeNull()
    expect(administrationOf(grant({ role: 'editor' }), administrators, place)).toBeNull()
  })

  test('a role written without the key closes the administration to its holders', () => {
    const rights = [
      grant({ id: 'direct', role: 'admin-of-tenant', workspaceId: 'acme' }),
      grant({ id: 'through', role: 'lead' }),
      grant({ id: 'elsewhere', role: 'admin-of-tenant', workspaceId: WS }),
      grant({ id: 'as-it-is', permission: 'console.admin', workspaceId: 'acme' }),
    ]
    const lostBy = (written: { key: string; permissions: string[]; roles: string[] }) =>
      administrationLostBy(rights, administrators, written, place).map((entry) => entry.id)
    // The key leaves the role: the rights that give the role stop
    // opening the administration, the ones that include it too.
    expect(lostBy({ key: 'admin-of-tenant', permissions: ['console.status'], roles: [] })).toEqual([
      'direct',
      'through',
    ])
    // The role that included it stops including it: only its own holders lose it.
    expect(lostBy({ key: 'lead', permissions: ['content.admin'], roles: [] })).toEqual(['through'])
    // A write that keeps the key closes nothing, whatever else it changes.
    expect(
      lostBy({ key: 'admin-of-tenant', permissions: ['console.admin'], roles: ['reader'] })
    ).toEqual([])
    // A role nobody administers through closes nothing.
    expect(lostBy({ key: 'editor', permissions: [], roles: [] })).toEqual([])
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
  const known = { permissions: ['content.read'], roles: ['editor'], tenant: 'acme' }

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

  test('a right on the tenant itself names the tenant as its workspace', () => {
    // It is what the console asks Access about, and what Access writes
    // for the first administrator of a tenant.
    const checked = checkGrant(
      draft({ kind: 'role', role: 'editor', workspace: 'tenant', workspaceId: WS }),
      known,
      NOW
    )
    expect(checked).toEqual({
      grant: {
        userId: 'u-1',
        role: 'editor',
        workspaceId: 'acme',
        routeId: null,
        expiresAt: null,
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

  test('a right matches by what it gives in effect: who can do this', () => {
    // The grant of a role matches the permissions the role holds, the
    // included ones too, once the page knows the roles of the tenant.
    const g = grant({ role: 'editor' })
    const asked = { ...filter, right: 'content.read' }
    expect(matchesRightsFilter(g, 'Alice', asked)).toBe(false)
    expect(matchesRightsFilter(g, 'Alice', asked, { roles })).toBe(true)
    expect(matchesRightsFilter(g, 'Alice', { ...filter, right: 'content.admin' }, { roles })).toBe(
      false
    )
  })

  test('a workspace matches by the name the page shows for it', () => {
    const g = grant({ role: 'editor', workspaceId: WS })
    const asked = { ...filter, workspace: 'archive' }
    expect(matchesRightsFilter(g, 'Alice', asked)).toBe(false)
    expect(matchesRightsFilter(g, 'Alice', asked, { workspaceLabel: 'Acme archive' })).toBe(true)
    expect(matchesRightsFilter(grant({}), 'Alice', { ...filter, workspace: 'all work' })).toBe(true)
  })
})
