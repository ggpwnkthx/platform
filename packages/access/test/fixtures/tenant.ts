/**
 * The tenants of the tests.
 *
 * A test needs a tenant, a principal and a permission before it can
 * prove anything. The three are the same in every file of the suite:
 * they live here, once, and the file of the test says what is specific
 * to it.
 */

import {
  PermissionRepository,
  TenantRepository,
  UserRepository,
  createSecretCipher,
  type Database,
} from '../../src/platform/postgres'

/**
 * The fields of the tenant of the tests.
 *
 * They are the fields of the tenant of the repository: the tenant of the
 * tests is a tenant of the platform, written through its repository.
 */
export interface TenantFixture {
  slug: string
  displayName: string
  issuer: string
  idpClientId: string
  idpClientSecret: string
  idpRedirectUri: string
  idpScopes: string[]
  idpAlgorithms: string[]
  clientId: string
  clientSecret: string
}

/** The tenant of the tests, when the test says nothing else. */
const TEST_TENANT: TenantFixture = {
  slug: 'acme',
  displayName: 'Acme Inc',
  issuer: 'https://login.acme.example',
  idpClientId: 'access-acme',
  idpClientSecret: 'secret',
  idpRedirectUri: 'https://access.example.com/oauth/tenant/callback',
  idpScopes: ['openid'],
  idpAlgorithms: ['RS256'],
  clientId: 'gateway-acme',
  clientSecret: 'secret',
}

/** The key of the permission of the tests. */
const TEST_PERMISSION_KEY = 'workspace.read'

/**
 * The second tenant of the tests.
 *
 * A test of the isolation needs two tenants: one of them is the tenant
 * of the tests, and the other one is the tenant beside it.
 */
export const OTHER_TENANT: Partial<TenantFixture> = {
  slug: 'other',
  displayName: 'Other',
  issuer: 'https://login.other.example',
  idpClientId: 'access-other',
  clientId: 'gateway-other',
}

/** The subject of the principal of the tests. */
const TEST_SUBJECT = 'the-subject'

/**
 * The body of the creation of a tenant of the http surface.
 *
 * The body of the api is the tenant without the scopes and the
 * algorithms of the provider: the api names its own defaults for them,
 * and a test that does not care about them sends none.
 */
export function tenantPayload(
  overrides: Partial<TenantFixture> & Record<string, unknown> = {}
): Record<string, unknown> {
  const { idpScopes, idpAlgorithms, ...tenant } = TEST_TENANT
  return { ...tenant, ...overrides }
}

/** The rows that a seeded tenant owns. */
export interface SeededTenant {
  /** The id of the tenant. */
  tenantId: string
  /** The id of the principal of the tenant, when one is written. */
  userId: string | null
}

/** The options of the seeding of a tenant. */
export interface SeedOptions {
  /** The tenant that is seeded. */
  tenant?: Partial<TenantFixture>
  /**
   * The subject of the principal of the tenant.
   *
   * A null subject writes no principal: a test that writes its own
   * principals asks for a tenant alone.
   */
  subject?: string | null
}

/**
 * Writes the tenant of the tests, with a principal.
 *
 * The rows are written through the repositories of the platform: the
 * tests of the integration prove what the repositories do, and they do
 * not write the rows themselves.
 */
export async function seedTenant(
  database: Database,
  options: SeedOptions = {}
): Promise<SeededTenant> {
  const tenants = new TenantRepository(database, createSecretCipher('the-key-of-the-deployment'))
  const tenant = await tenants.create({
    ...TEST_TENANT,
    ...options.tenant,
  })

  const users = new UserRepository(database)
  const subject = options.subject === undefined ? TEST_SUBJECT : options.subject
  const principal =
    subject === null
      ? null
      : await users.create({
          tenantId: tenant.id,
          externalSubject: subject,
        })

  return { tenantId: tenant.id, userId: principal?.id ?? null }
}

/**
 * Writes the permission of the tests, in a tenant.
 *
 * The permission is not written by the seeding of the tenant: a test
 * that proves what the permissions of the platform do writes them
 * itself, and a test that needs one asks for it here.
 */
export async function seedPermission(
  database: Database,
  tenantId: string,
  key: string = TEST_PERMISSION_KEY
): Promise<string> {
  const permissions = new PermissionRepository(database)
  const permission = await permissions.create({ tenantId, key })
  return permission.id
}
