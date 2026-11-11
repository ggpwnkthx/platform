import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  CredentialRepository,
  ProviderRepository,
  TenantRepository,
  UserRepository,
  createSecretCipher,
  type Database,
} from '../../src/platform/postgres'
import { openTestDatabase } from './database'

/**
 * The credentials of the local providers (spec §3.12).
 *
 * The repository is the storage of the rows: the rules of a sign-in live
 * in the identity domain, and the rules of the administration live in
 * the administration domain. The test proves what the storage does: the
 * verifier is written and read, the failures are counted, and the lock
 * grows with them.
 */
let database: Database
let credentials: CredentialRepository
let providers: ProviderRepository
let tenants: TenantRepository
let users: UserRepository

/** The id of the tenant of the tests. */
let tenantId: string

/** The id of the local provider of the tests. */
let providerId: string

beforeAll(async () => {
  database = await openTestDatabase()
  const cipher = createSecretCipher('the-key-of-the-deployment')
  tenants = new TenantRepository(database, cipher)
  providers = new ProviderRepository(database, cipher)
  credentials = new CredentialRepository(database)
  users = new UserRepository(database)

  const tenant = await tenants.create({
    slug: 'acme',
    displayName: 'Acme Inc',
    issuer: 'https://login.acme.example',
    idpClientId: 'access-acme',
    idpClientSecret: 'the-secret-of-the-provider',
    idpRedirectUri: 'https://access.example.com/oauth/tenant/callback',
    idpScopes: ['openid'],
    idpAlgorithms: ['RS256'],
    clientId: 'gateway-acme',
    clientSecret: 'the-secret-of-the-gateway',
  })
  tenantId = tenant.id
  const provider = await providers.create({
    tenantId,
    kind: 'local',
    slug: 'local',
    displayName: 'The accounts of the tenant',
    idpClientSecret: new Uint8Array([1, 2, 3]),
  })
  providerId = provider.id
})

afterAll(async () => {
  await database.close()
})

describe('the credentials of a local provider', () => {
  test('a credential is written and read back', async () => {
    const created = await credentials.create({
      tenantId,
      providerId,
      email: 'alice@acme.example',
      passwordHash: 'the-argon2id-verifier',
    })
    expect(created.email).toBe('alice@acme.example')
    expect(created.status).toBe('active')
    expect(created.failedAttempts).toBe(0)
    expect(created.lockedUntil).toBeNull()
    expect(created.tenantSlug).toBe('acme')
    expect(created.providerSlug).toBe('local')

    const found = await credentials.findByEmail('acme', 'local', 'alice@acme.example')
    expect(found?.id).toBe(created.id)
    expect(await credentials.findByEmail('acme', 'local', 'bob@acme.example')).toBeNull()
  })

  test('the failures of a credential are counted, and the lock grows', async () => {
    const created = await credentials.create({
      tenantId,
      providerId,
      email: 'bob@acme.example',
      passwordHash: 'the-argon2id-verifier',
    })
    // The first failures are counted, and the credential is not locked
    // yet.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const failed = await credentials.recordFailure(created.id)
      expect(failed?.failedAttempts).toBe(attempt + 1)
      expect(failed?.lockedUntil).toBeNull()
    }
    // The fifth failure locks the credential.
    const locked = await credentials.recordFailure(created.id)
    expect(locked?.failedAttempts).toBe(5)
    expect(locked?.lockedUntil).not.toBeNull()
    const until = locked!.lockedUntil!.getTime() - Date.now()
    expect(until).toBeGreaterThan(25_000)
    expect(until).toBeLessThanOrEqual(30_000)

    // The next failure doubles the lock.
    const lockedAgain = await credentials.recordFailure(created.id)
    const again = lockedAgain!.lockedUntil!.getTime() - Date.now()
    expect(again).toBeGreaterThan(50_000)
  })

  test('a credential that signs in is unlocked again', async () => {
    const created = await credentials.create({
      tenantId,
      providerId,
      email: 'carol@acme.example',
      passwordHash: 'the-argon2id-verifier',
    })
    await credentials.recordFailure(created.id)
    await credentials.recordFailure(created.id)
    await credentials.clearFailures(created.id)
    const found = await credentials.findByEmail('acme', 'local', 'carol@acme.example')
    expect(found?.failedAttempts).toBe(0)
    expect(found?.lockedUntil).toBeNull()
  })

  test('a new password clears the failures and the lock', async () => {
    const created = await credentials.create({
      tenantId,
      providerId,
      email: 'dave@acme.example',
      passwordHash: 'the-argon2id-verifier',
    })
    await credentials.recordFailure(created.id)
    await credentials.recordFailure(created.id)
    await credentials.update(
      created.id,
      { passwordHash: 'the-new-argon2id-verifier' },
      { tenant: tenantId }
    )
    const found = await credentials.findByEmail('acme', 'local', 'dave@acme.example')
    expect(found?.failedAttempts).toBe(0)
    expect(found?.lockedUntil).toBeNull()
    expect(found?.passwordHash).toBe('the-new-argon2id-verifier')
  })

  test('the credentials of a tenant are listed', async () => {
    const page = await credentials.list({
      tenantId,
      providerSlug: 'local',
      email: null,
      limit: 50,
      offset: 0,
    })
    expect(page.total).toBeGreaterThan(0)
    expect(page.rows.every((row) => row.tenantId === tenantId)).toBe(true)
    expect(page.rows.some((row) => row.email === 'alice@acme.example')).toBe(true)
  })

  test('a credential is removed, and the principal it created stays', async () => {
    const created = await credentials.create({
      tenantId,
      providerId,
      email: 'erin@acme.example',
      passwordHash: 'the-argon2id-verifier',
    })
    await users.create({
      tenantId,
      providerSlug: 'local',
      externalSubject: created.id,
    })
    expect(await credentials.remove(created.id, { tenant: tenantId })).toBe(true)
    expect(await credentials.findByEmail('acme', 'local', 'erin@acme.example')).toBeNull()
    // The principal stays: it cannot be signed in with any more.
    const principal = await users.findByExternalSubject(tenantId, 'local', created.id)
    expect(principal).not.toBeNull()
  })
})
