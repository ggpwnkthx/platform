import { describe, expect, test } from 'bun:test'
import { CONTEXT, TENANT, createFakes, serviceOf } from './fakes'
import { PLATFORM_SCOPE } from './index'

/**
 * The administration of a tenant, handed to its first identity
 * (spec §6.4).
 *
 * The flag of the tenant is the work of its operator, and the flag is
 * off by default: the first person who signs in at the provider of a
 * tenant is not its administrator unless the tenant says so.
 */

const fakes = createFakes()

/** Registers the tenant of the tests and its first principal. */
async function tenantWithFirstPrincipal(
  administration: ReturnType<typeof serviceOf>,
  tenant: { autoProvisionAdmin?: boolean } = {}
): Promise<string> {
  await administration.upsertTenant(
    PLATFORM_SCOPE,
    { ...TENANT, autoProvisionAdmin: tenant.autoProvisionAdmin ?? false },
    CONTEXT
  )
  const created = await administration.upsertPrincipal(
    PLATFORM_SCOPE,
    {
      tenant: TENANT.slug,
      externalSubject: 'the-subject-of-the-first-principal',
      email: 'alice@acme.example',
      displayName: 'Alice',
    },
    CONTEXT
  )
  return created.principal.id
}

describe('the administration of a tenant', () => {
  test('the first principal of a tenant that asks for it is given it', async () => {
    const administration = serviceOf(fakes)
    const principal = await tenantWithFirstPrincipal(administration, { autoProvisionAdmin: true })

    const grant = await administration.bootstrapAdministrator(
      { id: principal, tenant: TENANT.slug },
      CONTEXT
    )
    expect(grant).not.toBeNull()
    expect(grant?.permission).toBe('console.admin')
    // The workspace of the grant is the tenant: the console asks for the
    // context of the tenant of its caller, and the slug of the tenant is
    // the workspace it names.
    expect(grant?.workspaceId).toBe(TENANT.slug)
    expect(grant?.userId).toBe(principal)
  })

  test('a tenant that does not ask for it gives nothing', async () => {
    const administration = serviceOf(fakes)
    const principal = await tenantWithFirstPrincipal(administration)
    const grant = await administration.bootstrapAdministrator(
      { id: principal, tenant: TENANT.slug },
      CONTEXT
    )
    expect(grant).toBeNull()
  })

  test('a tenant that already has an administrator keeps it', async () => {
    const administration = serviceOf(fakes)
    const principal = await tenantWithFirstPrincipal(administration, { autoProvisionAdmin: true })
    await administration.bootstrapAdministrator({ id: principal, tenant: TENANT.slug }, CONTEXT)

    // The second principal of the tenant is given nothing: the tenant
    // has an administrator already.
    const other = await administration.upsertPrincipal(
      PLATFORM_SCOPE,
      {
        tenant: TENANT.slug,
        externalSubject: 'the-subject-of-the-second-principal',
        email: 'bob@acme.example',
        displayName: 'Bob',
      },
      CONTEXT
    )
    const grant = await administration.bootstrapAdministrator(
      { id: other.principal.id, tenant: TENANT.slug },
      CONTEXT
    )
    expect(grant).toBeNull()
  })

  test('a tenant that shares its provider with another tenant is given nothing', async () => {
    const administration = serviceOf(fakes)
    const principal = await tenantWithFirstPrincipal(administration, { autoProvisionAdmin: true })

    // The provider of the tenant is the provider of another tenant: the
    // first identity that signs in is the first identity of the
    // directory, and not of the tenant.
    await administration.upsertTenant(
      PLATFORM_SCOPE,
      {
        ...TENANT,
        slug: 'beside',
        displayName: 'Beside',
        clientId: 'gateway-beside',
        emailDomain: null,
        issuer: TENANT.issuer,
        autoProvisionAdmin: true,
      },
      CONTEXT
    )
    const grant = await administration.bootstrapAdministrator(
      { id: principal, tenant: TENANT.slug },
      CONTEXT
    )
    expect(grant).toBeNull()
  })

  test('a principal of another tenant is given nothing', async () => {
    const administration = serviceOf(fakes)
    await administration.upsertTenant(
      PLATFORM_SCOPE,
      { ...TENANT, autoProvisionAdmin: true },
      CONTEXT
    )
    await administration.upsertTenant(
      PLATFORM_SCOPE,
      {
        ...TENANT,
        slug: 'another',
        clientId: 'gateway-another',
        emailDomain: null,
        autoProvisionAdmin: true,
      },
      CONTEXT
    )
    const principal = await administration.upsertPrincipal(
      PLATFORM_SCOPE,
      { tenant: 'another', externalSubject: 'the-subject', email: 'alice@another.example' },
      CONTEXT
    )
    const grant = await administration.bootstrapAdministrator(
      { id: principal.principal.id, tenant: TENANT.slug },
      CONTEXT
    )
    expect(grant).toBeNull()
  })

  test('a tenant that does not exist is given nothing', async () => {
    const administration = serviceOf(fakes)
    const grant = await administration.bootstrapAdministrator(
      { id: 'principal-1', tenant: 'unknown' },
      CONTEXT
    )
    expect(grant).toBeNull()
  })
})
