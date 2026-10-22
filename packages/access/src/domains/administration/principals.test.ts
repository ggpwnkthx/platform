import { beforeAll, describe, expect, test } from 'bun:test'
import { CONTEXT, TENANT, createFakes, serviceOf } from './fakes'
import { PLATFORM_SCOPE } from './index'

/**
 * The principals of the administration (spec §10.3).
 *
 * The principal is the mapping of an external identity of a tenant onto
 * a principal of the platform.
 */

const fakes = createFakes()

beforeAll(async () => {
  // The principal of a test needs its tenant: the file writes it once,
  // and every test of the file works on it.
  await serviceOf(fakes).upsertTenant(PLATFORM_SCOPE, TENANT, CONTEXT)
})

describe('the principals of the administration', () => {
  test('a principal is created and then changed', async () => {
    const administration = serviceOf(fakes)
    const created = await administration.upsertPrincipal(
      PLATFORM_SCOPE,
      {
        tenant: 'acme',
        externalSubject: '00u1a2b3c4d5',
        email: 'alice@acme.example',
      },
      CONTEXT
    )
    expect(created.created).toBe(true)
    expect(created.principal.status).toBe('active')

    const updated = await administration.upsertPrincipal(
      PLATFORM_SCOPE,
      {
        tenant: 'acme',
        externalSubject: '00u1a2b3c4d5',
        status: 'disabled',
      },
      CONTEXT
    )
    expect(updated.created).toBe(false)
    expect(updated.principal.status).toBe('disabled')
  })

  test('an unknown tenant is a not found', async () => {
    const administration = serviceOf(fakes)
    await expect(
      administration.upsertPrincipal(
        PLATFORM_SCOPE,
        { tenant: 'unknown', externalSubject: 'sub' },
        CONTEXT
      )
    ).rejects.toThrow(/the tenant does not exist/)
  })
})
