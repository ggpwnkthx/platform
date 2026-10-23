import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { GroupRepository, UserRepository, type Database } from '../../src/platform/postgres'
import { OTHER_TENANT, seedTenant } from '../fixtures/tenant'
import { openTestDatabase } from './database'

/**
 * The membership of the groups, checked by the database (spec §3.5).
 *
 * The membership of a group is a list of the ids of its members, and a
 * list has no foreign key. The database checks it anyway: a constraint
 * trigger refuses a member that is not a principal of the tenant of the
 * group, and the check is the backstop of the rule of the application.
 *
 * The test does not trust the application: it writes the group with a
 * statement of its own, the one of an operator with a `psql` open.
 */
let database: Database
let acme: string
let other: string

beforeAll(async () => {
  database = await openTestDatabase()
  const first = await seedTenant(database, { subject: 'the-principal-of-the-seed' })
  const second = await seedTenant(database, {
    tenant: OTHER_TENANT,
    subject: 'the-principal-of-the-other-seed',
  })
  acme = first.tenantId
  other = second.tenantId
})

afterAll(async () => {
  await database.close()
})

describe('the membership of the groups', () => {
  test('a member of the tenant of the group is accepted', async () => {
    const users = new UserRepository(database)
    const principal = await users.create({ tenantId: acme, externalSubject: 'the-subject' })
    const groups = new GroupRepository(database)
    const group = await groups.create({
      tenantId: acme,
      key: 'the-team',
      members: [principal.id],
    })
    expect(group.members).toEqual([principal.id])
  })

  test('a member of another tenant is refused by the database', async () => {
    const users = new UserRepository(database)
    const foreign = await users.create({ tenantId: other, externalSubject: 'the-foreign-subject' })
    // The statement of the test writes the group directly: the
    // application would have refused it before the write.
    await expect(
      database.query(
        `insert into groups (tenant_id, key, members) values ($1, 'the-cross-tenant-team', $2)`,
        [acme, [foreign.id]]
      )
    ).rejects.toThrow(/not a principal of the tenant/)
  })

  test('a member that does not exist is refused by the database', async () => {
    await expect(
      database.query(
        `insert into groups (tenant_id, key, members) values ($1, 'the-ghost-team', $2)`,
        [acme, ['11111111-1111-4111-8111-111111111111']]
      )
    ).rejects.toThrow(/not a principal of the tenant/)
  })

  test('the check is the backstop of the application, not its replacement', async () => {
    // The application refuses a member that is not a principal of the
    // tenant before it writes anything (spec §10.9), and the database
    // refuses it when the statement comes from somewhere else.
    const users = new UserRepository(database)
    const foreign = await users.create({ tenantId: other, externalSubject: 'the-other-subject' })
    const groups = new GroupRepository(database)
    await expect(
      groups.create({ tenantId: acme, key: 'the-team-of-others', members: [foreign.id] })
    ).rejects.toThrow(/not a principal of the tenant/)
  })
})
