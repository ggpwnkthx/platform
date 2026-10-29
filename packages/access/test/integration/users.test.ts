import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { UserRepository, type Database } from '../../src/platform/postgres'
import { tenantScope } from '../../src/domains/administration'
import { OTHER_TENANT, seedTenant } from '../fixtures/tenant'
import { openTestDatabase } from './database'

let database: Database
let users: UserRepository
let tenantId: string

beforeAll(async () => {
  database = await openTestDatabase()
  users = new UserRepository(database)
  const seeded = await seedTenant(database, { subject: null })
  tenantId = seeded.tenantId
})

afterAll(async () => {
  await database.close()
})

describe('the principals of Access', () => {
  test('a principal is created and read back', async () => {
    const created = await users.create({
      tenantId,
      externalSubject: '00u1a2b3c4d5',
      email: 'alice@acme.example',
      displayName: 'Alice',
    })
    expect(created.status).toBe('active')
    expect(created.email).toBe('alice@acme.example')
    expect(created.lastLoginAt).toBeNull()

    const found = await users.findByExternalSubject(tenantId, '00u1a2b3c4d5')
    expect(found?.id).toBe(created.id)
  })

  test('the mapping key is the pair (tenant, subject)', async () => {
    await users.create({ tenantId, externalSubject: 'the-subject', email: 'alice@acme.example' })
    const other = await seedTenant(database, { tenant: OTHER_TENANT, subject: null })
    // The same subject in another tenant is another principal.
    const found = await users.findByExternalSubject(other.tenantId, 'the-subject')
    expect(found).toBeNull()
    // The same subject in the same tenant is the same principal.
    expect((await users.findByExternalSubject(tenantId, 'the-subject'))?.externalSubject).toBe(
      'the-subject'
    )
  })

  test('a principal is disabled and enabled again', async () => {
    const created = await users.create({ tenantId, externalSubject: 'disabled-subject' })
    const disabled = await users.update(created.id, { status: 'disabled' }, tenantScope(tenantId))
    expect(disabled?.status).toBe('disabled')
    const enabled = await users.update(created.id, { status: 'active' }, tenantScope(tenantId))
    expect(enabled?.status).toBe('active')
  })

  test('the last login is stamped', async () => {
    const created = await users.create({ tenantId, externalSubject: 'login-subject' })
    await users.touchLogin(created.id, tenantScope(tenantId))
    const found = await users.findById(created.id, tenantScope(tenantId))
    expect(found?.lastLoginAt).toBeInstanceOf(Date)
  })

  test('the principals of a tenant are listed', async () => {
    const listed = await users.findByTenant(tenantId)
    expect(listed.length).toBeGreaterThan(0)
    expect(listed.every((row) => row.tenantId === tenantId)).toBe(true)
  })
})

describe('the list of the principals', () => {
  test('the list is paginated and the order is stable', async () => {
    const listed = await seedTenant(database, {
      tenant: {
        slug: 'listed',
        displayName: 'Listed',
        issuer: 'https://login.listed.example',
        idpClientId: 'access-listed',
        clientId: 'gateway-listed',
      },
      subject: null,
    })
    for (let index = 0; index < 5; index += 1) {
      await users.create({
        tenantId: listed.tenantId,
        externalSubject: `subject-${index}`,
        email: `person-${index}@listed.example`,
      })
    }

    const all = await users.list({
      tenantId: listed.tenantId,
      status: null,
      email: null,
      limit: 50,
      offset: 0,
    })
    expect(all.total).toBe(5)
    expect(all.rows).toHaveLength(5)

    const first = await users.list({
      tenantId: listed.tenantId,
      status: null,
      email: null,
      limit: 2,
      offset: 0,
    })
    const second = await users.list({
      tenantId: listed.tenantId,
      status: null,
      email: null,
      limit: 2,
      offset: 2,
    })
    const third = await users.list({
      tenantId: listed.tenantId,
      status: null,
      email: null,
      limit: 2,
      offset: 4,
    })
    expect(first.rows).toHaveLength(2)
    expect(third.rows).toHaveLength(1)
    // The pages do not overlap and they do not skip a row.
    const ids = [...first.rows, ...second.rows, ...third.rows].map((row) => row.id)
    expect(new Set(ids).size).toBe(5)
  })

  test('the list is filtered by the tenant, by the status and by the e-mail', async () => {
    const page = await users.list({
      tenantId: null,
      status: null,
      email: 'person-0@listed.example',
      limit: 50,
      offset: 0,
    })
    expect(page.total).toBe(1)
    expect(page.rows[0]?.email).toBe('person-0@listed.example')

    const disabled = await users.list({
      tenantId: null,
      status: 'disabled',
      email: null,
      limit: 50,
      offset: 0,
    })
    expect(disabled.rows.every((row) => row.status === 'disabled')).toBe(true)
  })
})
