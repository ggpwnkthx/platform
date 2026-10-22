import { beforeAll, describe, expect, test } from 'bun:test'
import { CONTEXT, TENANT, createFakes, serviceOf } from './fakes'
import { PLATFORM_SCOPE } from './index'

/**
 * The lists of the administration (spec §10.1).
 *
 * A list is paginated, and its filters are read from the query of the
 * call: a value that is not understood is a refusal.
 */

const fakes = createFakes()

beforeAll(async () => {
  // The list of a test needs its tenant: the file writes it once, and
  // every test of the file works on it.
  await serviceOf(fakes).upsertTenant(PLATFORM_SCOPE, TENANT, CONTEXT)
})

describe('the lists of the administration', () => {
  test('the principals of a tenant are listed', async () => {
    const administration = serviceOf(fakes)
    const principal = await administration.upsertPrincipal(
      PLATFORM_SCOPE,
      {
        tenant: 'acme',
        externalSubject: 'the-subject-of-a-list',
        email: 'listed@acme.example',
      },
      CONTEXT
    )
    const page = await administration.listPrincipals(PLATFORM_SCOPE, { tenant: 'acme' })
    expect(page.total).toBeGreaterThan(0)
    expect(page.principals.some((row) => row.id === principal.principal.id)).toBe(true)
    expect(page.limit).toBe(50)
    expect(page.offset).toBe(0)
  })

  test('the list of the principals is filtered by the status and by the e-mail', async () => {
    const administration = serviceOf(fakes)
    const principal = await administration.upsertPrincipal(
      PLATFORM_SCOPE,
      {
        tenant: 'acme',
        externalSubject: 'the-subject-of-a-filter',
        email: 'filtered@acme.example',
      },
      CONTEXT
    )
    await administration.upsertPrincipal(
      PLATFORM_SCOPE,
      {
        tenant: 'acme',
        externalSubject: 'the-subject-of-a-disabled-one',
        status: 'disabled',
      },
      CONTEXT
    )
    const byStatus = await administration.listPrincipals(PLATFORM_SCOPE, {
      tenant: 'acme',
      status: 'disabled',
    })
    expect(byStatus.principals.every((row) => row.status === 'disabled')).toBe(true)
    expect(byStatus.principals.some((row) => row.id === principal.principal.id)).toBe(false)

    const byEmail = await administration.listPrincipals(PLATFORM_SCOPE, {
      tenant: 'acme',
      email: 'filtered@acme.example',
    })
    expect(byEmail.principals.map((row) => row.id)).toEqual([principal.principal.id])
  })

  test('the list of the principals is paginated', async () => {
    const administration = serviceOf(fakes)
    for (let index = 0; index < 3; index += 1) {
      await administration.upsertPrincipal(
        PLATFORM_SCOPE,
        {
          tenant: 'acme',
          externalSubject: `the-subject-of-a-page-${index}`,
        },
        CONTEXT
      )
    }
    const first = await administration.listPrincipals(PLATFORM_SCOPE, {
      tenant: 'acme',
      limit: '2',
      offset: '0',
    })
    const second = await administration.listPrincipals(PLATFORM_SCOPE, {
      tenant: 'acme',
      limit: '2',
      offset: '2',
    })
    expect(first.principals).toHaveLength(2)
    expect(first.total).toBe(second.total)
    const ids = new Set([...first.principals, ...second.principals].map((row) => row.id))
    expect(ids.size).toBe(first.principals.length + second.principals.length)
  })

  test('a limit that is not understood is refused', async () => {
    const administration = serviceOf(fakes)
    await expect(administration.listPrincipals(PLATFORM_SCOPE, { limit: 'many' })).rejects.toThrow(
      /limit must be a whole number/
    )
    await expect(administration.listPrincipals(PLATFORM_SCOPE, { limit: '5000' })).rejects.toThrow(
      /limit must be between 1 and 200/
    )
    await expect(administration.listPrincipals(PLATFORM_SCOPE, { offset: '-1' })).rejects.toThrow(
      /offset must be a whole number/
    )
    await expect(
      administration.listPrincipals(PLATFORM_SCOPE, { status: 'paused' })
    ).rejects.toThrow(/status must be active or disabled/)
  })

  test('a tenant that does not exist is a not found', async () => {
    const administration = serviceOf(fakes)
    await expect(
      administration.listPrincipals(PLATFORM_SCOPE, { tenant: 'nowhere' })
    ).rejects.toThrow(/the tenant does not exist/)
    await expect(administration.listGrants(PLATFORM_SCOPE, { tenant: 'nowhere' })).rejects.toThrow(
      /the tenant does not exist/
    )
  })

  test('the grants of a tenant are listed and they carry who granted them', async () => {
    const administration = serviceOf(fakes)
    const principal = await administration.upsertPrincipal(
      PLATFORM_SCOPE,
      {
        tenant: 'acme',
        externalSubject: 'the-subject-of-a-listed-grant',
      },
      CONTEXT
    )
    const grant = await administration.upsertGrant(
      PLATFORM_SCOPE,
      {
        tenant: 'acme',
        userId: principal.principal.id,
        permission: 'workspace.list',
        grantedBy: 'ops@acme.example',
      },
      CONTEXT
    )
    const page = await administration.listGrants(PLATFORM_SCOPE, { tenant: 'acme' })
    const listed = page.grants.find((row) => row.id === grant.grant.id)
    expect(listed?.grantedBy).toBe('ops@acme.example')
    expect(page.total).toBeGreaterThan(0)
  })

  test('the list of the grants is filtered by the principal and by the life', async () => {
    const administration = serviceOf(fakes)
    const principal = await administration.upsertPrincipal(
      PLATFORM_SCOPE,
      {
        tenant: 'acme',
        externalSubject: 'the-subject-of-the-live-grant',
      },
      CONTEXT
    )
    await administration.upsertGrant(
      PLATFORM_SCOPE,
      {
        tenant: 'acme',
        userId: principal.principal.id,
        permission: 'workspace.live',
      },
      CONTEXT
    )
    const revoked = await administration.upsertGrant(
      PLATFORM_SCOPE,
      {
        tenant: 'acme',
        userId: principal.principal.id,
        permission: 'workspace.dead',
      },
      CONTEXT
    )
    await administration.revokeGrant(PLATFORM_SCOPE, revoked.grant.id, CONTEXT)

    const live = await administration.listGrants(PLATFORM_SCOPE, { tenant: 'acme', live: 'true' })
    expect(live.grants.some((row) => row.id === revoked.grant.id)).toBe(false)

    const dead = await administration.listGrants(PLATFORM_SCOPE, { tenant: 'acme', live: 'false' })
    expect(dead.grants.some((row) => row.id === revoked.grant.id)).toBe(true)

    const byPrincipal = await administration.listGrants(PLATFORM_SCOPE, {
      tenant: 'acme',
      userId: principal.principal.id,
    })
    expect(byPrincipal.grants.every((row) => row.userId === principal.principal.id)).toBe(true)
  })

  test('a live filter that is not understood is refused', async () => {
    const administration = serviceOf(fakes)
    await expect(administration.listGrants(PLATFORM_SCOPE, { live: 'maybe' })).rejects.toThrow(
      /live must be true or false/
    )
  })
})
