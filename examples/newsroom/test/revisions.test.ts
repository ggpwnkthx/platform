import { beforeAll, describe, expect, test } from 'bun:test'
import { PGlite } from '@electric-sql/pglite'
import { activity } from '@platform/data'
import type { DataSource } from '@platform/vocabulary'
import { install } from './newsroom.ts'

/**
 * A revision holds the whole row, and a workspace's owners read its revisions. Owning the
 * workspace is not a right on a column, so the history of a field is as private as the field.
 * This asks the real thing — PostgreSQL, installed with the platform's own script — as an
 * owner of a workspace who is refused one column of a collection in it.
 */

let pg: PGlite
const db: DataSource = {
  query: (async (statement: string, values?: unknown[]) => {
    const result = await pg.query(statement, values as never)
    return { rows: result.rows, affected: result.affectedRows }
  }) as DataSource['query'],
}

async function as<T>(role: string, ask: () => Promise<T>): Promise<T> {
  await pg.query(`SET SESSION AUTHORIZATION ${JSON.stringify(role)}`)
  try {
    return await ask()
  } finally {
    await pg.query('SET SESSION AUTHORIZATION postgres')
  }
}

const history = (role: string) => as(role, () => activity(db, { schema: 'desk', table: 'people' }))

beforeAll(async () => {
  pg = await PGlite.create()
  await install(pg)
  // A workspace two people own together. One of them makes a collection in it, and so owns
  // the collection; the other is given every column of it but one.
  await pg.exec(`
    CREATE ROLE desk_owners NOLOGIN;
    GRANT desk_owners TO "admin@example.com", "alice@example.com";
    CREATE SCHEMA desk AUTHORIZATION desk_owners;
    SET SESSION AUTHORIZATION "admin@example.com";
    SELECT platform.create_collection('desk', 'people');
    ALTER TABLE desk.people ADD COLUMN name text, ADD COLUMN salary integer;
    GRANT SELECT (id, name, version) ON desk.people TO "alice@example.com";
    INSERT INTO desk.people (name, salary) VALUES ('Ada', 100);
    UPDATE desk.people SET salary = 200;
    SET SESSION AUTHORIZATION postgres;
  `)
})

describe('the revisions of a collection with a private field', () => {
  test('its owner reads the whole row', async () => {
    const found = await history('admin@example.com')
    expect(found.map((r) => r.operation)).toEqual(['UPDATE', 'INSERT'])
    expect(found[0]?.before_row?.salary).toBe(100)
    expect(found[0]?.after_row?.salary).toBe(200)
  })

  test('an owner of the workspace reads the columns they may read, and no others', async () => {
    const found = await history('alice@example.com')
    expect(found.map((r) => r.operation)).toEqual(['UPDATE', 'INSERT'])
    for (const revision of found)
      for (const row of [revision.before_row, revision.after_row])
        if (row) expect(Object.keys(row).sort()).toEqual(['id', 'name', 'version'])
    expect(found[0]?.after_row?.name).toBe('Ada')
  })

  test('the log itself does not hand them the rows', async () => {
    for (const column of ['before_row', 'after_row', '*'])
      await expect(
        as('alice@example.com', () => pg.query(`SELECT ${column} FROM platform.activity`))
      ).rejects.toThrow('permission denied')
    // What happened is still theirs to read: who, when, and to which collection.
    const seen = await as('alice@example.com', () =>
      pg.query("SELECT actor, operation FROM platform.activity WHERE schema_name = 'desk'")
    )
    expect(seen.rows).toHaveLength(2)
  })

  test('a grant of the column is a grant of its history, and a revoke takes it back', async () => {
    await pg.exec('GRANT SELECT (salary) ON desk.people TO "alice@example.com"')
    expect((await history('alice@example.com'))[0]?.after_row?.salary).toBe(200)
    await pg.exec('REVOKE SELECT (salary) ON desk.people FROM "alice@example.com"')
    expect((await history('alice@example.com'))[0]?.after_row).not.toHaveProperty('salary')
  })

  test('someone who owns no part of the workspace reads no revision of it', async () => {
    expect(await history('bob@example.com')).toEqual([])
  })

  test('another table given the name is another table', async () => {
    // An owner of the workspace may drop any table in it and make one of their own in its
    // place. The rows that were logged belong to the table that is gone.
    await pg.exec(`
      SET SESSION AUTHORIZATION "alice@example.com";
      DROP TABLE desk.people;
      CREATE TABLE desk.people (id uuid, name text, salary integer, version bigint);
      SET SESSION AUTHORIZATION postgres;
    `)
    const found = await history('alice@example.com')
    expect(found.length).toBeGreaterThan(0)
    for (const revision of found)
      for (const row of [revision.before_row, revision.after_row]) if (row) expect(row).toEqual({})
  })
})
