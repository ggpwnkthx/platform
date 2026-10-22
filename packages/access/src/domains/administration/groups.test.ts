import { beforeAll, describe, expect, test } from 'bun:test'
import { CONTEXT, TENANT, createFakes, serviceOf } from './fakes'
import { PLATFORM_SCOPE } from './index'

/**
 * The groups of the administration (spec §10.5).
 *
 * The membership of a group is a list of the principals of the tenant,
 * and the membership is replaced by every call.
 */

const fakes = createFakes()

beforeAll(async () => {
  // The group of a test needs its tenant: the file writes it once, and
  // every test of the file works on it.
  await serviceOf(fakes).upsertTenant(PLATFORM_SCOPE, TENANT, CONTEXT)
})

describe('the groups of the administration', () => {
  test('a group is created with its members', async () => {
    const administration = serviceOf(fakes)
    const principal = await administration.upsertPrincipal(
      PLATFORM_SCOPE,
      {
        tenant: 'acme',
        externalSubject: 'the-subject-of-a-member',
      },
      CONTEXT
    )
    const result = await administration.upsertGroup(
      PLATFORM_SCOPE,
      {
        tenant: 'acme',
        key: 'team-platform',
        displayName: 'The platform team',
        members: ['the-subject-of-a-member'],
      },
      CONTEXT
    )
    expect(result.created).toBe(true)
    expect(result.group.key).toBe('team-platform')
    expect(result.group.members).toEqual([principal.principal.id])
    expect(result.audit.action).toBe('group.created')
  })

  test('the membership is replaced by the second call', async () => {
    const administration = serviceOf(fakes)
    await administration.upsertPrincipal(
      PLATFORM_SCOPE,
      {
        tenant: 'acme',
        externalSubject: 'the-subject-of-the-first-member',
      },
      CONTEXT
    )
    await administration.upsertPrincipal(
      PLATFORM_SCOPE,
      {
        tenant: 'acme',
        externalSubject: 'the-subject-of-the-second-member',
      },
      CONTEXT
    )
    await administration.upsertGroup(
      PLATFORM_SCOPE,
      {
        tenant: 'acme',
        key: 'team-replaced',
        members: ['the-subject-of-the-first-member'],
      },
      CONTEXT
    )
    const second = await administration.upsertGroup(
      PLATFORM_SCOPE,
      {
        tenant: 'acme',
        key: 'team-replaced',
        members: ['the-subject-of-the-second-member'],
      },
      CONTEXT
    )
    expect(second.created).toBe(false)
    expect(second.group.members).toHaveLength(1)
    expect(second.audit.action).toBe('group.updated')
  })

  test('a member that is not a principal is a not found', async () => {
    const administration = serviceOf(fakes)
    await expect(
      administration.upsertGroup(
        PLATFORM_SCOPE,
        {
          tenant: 'acme',
          key: 'team-unknown',
          members: ['the-subject-that-does-not-exist'],
        },
        CONTEXT
      )
    ).rejects.toThrow(/does not exist in the tenant/)
  })

  test('the groups of a tenant are listed', async () => {
    const administration = serviceOf(fakes)
    await administration.upsertPrincipal(
      PLATFORM_SCOPE,
      {
        tenant: 'acme',
        externalSubject: 'the-subject-of-a-listed-group',
      },
      CONTEXT
    )
    await administration.upsertGroup(
      PLATFORM_SCOPE,
      {
        tenant: 'acme',
        key: 'team-listed',
        members: ['the-subject-of-a-listed-group'],
      },
      CONTEXT
    )
    const page = await administration.listGroups(PLATFORM_SCOPE, { tenant: 'acme' })
    expect(page.total).toBeGreaterThan(0)
    expect(page.groups.some((row) => row.key === 'team-listed')).toBe(true)
    expect(page.limit).toBe(50)
    expect(page.offset).toBe(0)
  })

  test('the list of the groups is filtered by the key', async () => {
    const administration = serviceOf(fakes)
    await administration.upsertGroup(
      PLATFORM_SCOPE,
      {
        tenant: 'acme',
        key: 'team-filtered',
        members: [],
      },
      CONTEXT
    )
    const page = await administration.listGroups(PLATFORM_SCOPE, {
      tenant: 'acme',
      key: 'team-filtered',
    })
    expect(page.groups.length).toBe(1)
    expect(page.groups[0]!.key).toBe('team-filtered')
    expect(page.total).toBe(1)
  })

  test('a tenant that does not exist is a not found', async () => {
    const administration = serviceOf(fakes)
    await expect(administration.listGroups(PLATFORM_SCOPE, { tenant: 'nowhere' })).rejects.toThrow(
      /the tenant does not exist/
    )
  })

  test('a grant of a group is created for the group', async () => {
    const administration = serviceOf(fakes)
    await administration.upsertGroup(
      PLATFORM_SCOPE,
      {
        tenant: 'acme',
        key: 'team-with-a-grant',
        members: [],
      },
      CONTEXT
    )
    const grant = await administration.upsertGrant(
      PLATFORM_SCOPE,
      {
        tenant: 'acme',
        group: 'team-with-a-grant',
        permission: 'workspace.group',
      },
      CONTEXT
    )
    expect(grant.grant.group).toBe('team-with-a-grant')
    expect(grant.grant.userId).toBeNull()
    expect(grant.audit.action).toBe('grant.created')
  })

  test('a grant names a principal or a group, and not both', async () => {
    const administration = serviceOf(fakes)
    const principal = await administration.upsertPrincipal(
      PLATFORM_SCOPE,
      {
        tenant: 'acme',
        externalSubject: 'the-subject-of-an-ambiguous-grant',
      },
      CONTEXT
    )
    await administration.upsertGroup(
      PLATFORM_SCOPE,
      { tenant: 'acme', key: 'team-ambiguous', members: [] },
      CONTEXT
    )
    await expect(
      administration.upsertGrant(
        PLATFORM_SCOPE,
        {
          tenant: 'acme',
          userId: principal.principal.id,
          group: 'team-ambiguous',
          permission: 'workspace.ambiguous',
        },
        CONTEXT
      )
    ).rejects.toThrow(/names a principal or a group/)
    await expect(
      administration.upsertGrant(
        PLATFORM_SCOPE,
        {
          tenant: 'acme',
          permission: 'workspace.ambiguous',
        },
        CONTEXT
      )
    ).rejects.toThrow(/names a principal or a group/)
  })

  test('a grant of a group that does not exist is a not found', async () => {
    const administration = serviceOf(fakes)
    await expect(
      administration.upsertGrant(
        PLATFORM_SCOPE,
        {
          tenant: 'acme',
          group: 'team-that-does-not-exist',
          permission: 'workspace.nowhere',
        },
        CONTEXT
      )
    ).rejects.toThrow(/the group does not exist/)
  })
})
