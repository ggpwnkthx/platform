import { beforeAll, describe, expect, test } from 'bun:test'
import {
  databaseGrantStatement,
  type Db,
  defaultPrivilegeStatement,
  endSessionStatement,
  maintenanceStatement,
  objectGrantStatement,
  routineStatement,
  sequenceStatement,
  transaction,
  typeStatement,
} from '../src/index.ts'
import { admin, world } from './world.ts'

let w: Awaited<ReturnType<typeof world>>
beforeAll(async () => {
  w = await world()
  const db = await w.as(admin)
  await run(db, [
    routineStatement({
      schema: 'newsroom',
      name: 'shout',
      kind: 'function',
      arguments: 'words text',
      returns: 'text',
      language: 'sql',
      body: 'SELECT upper(words)',
    }),
    sequenceStatement({ schema: 'newsroom', name: 'issue_no' }),
    typeStatement({ schema: 'newsroom', name: 'mood', kind: 'enum', values: ['calm'] }),
  ])
})
const run = async (db: Db, statements: string[]) =>
  transaction(db, async () => {
    for (const statement of statements) await db.query(statement)
  })
const one = async <T>(db: Db, text: string) => (await db.query<T>(text)).rows

describe('grants beyond the tables, and the upkeep of the database', () => {
  test('default privileges, grants on objects and on the database', async () => {
    const db = await w.as(admin)
    await run(db, [
      defaultPrivilegeStatement({
        forRole: admin,
        schema: 'newsroom',
        objects: 'TABLES',
        privileges: ['SELECT'],
        grantee: 'newsroom_reader',
      }),
      objectGrantStatement({
        objects: 'FUNCTION',
        name: 'newsroom.shout(text)',
        privileges: ['EXECUTE'],
        grantee: 'newsroom_writer',
      }),
      objectGrantStatement({
        objects: 'SEQUENCE',
        name: 'newsroom.issue_no',
        privileges: ['USAGE'],
        grantee: 'newsroom_writer',
      }),
      objectGrantStatement(
        { objects: 'TYPE', name: 'newsroom.mood', privileges: ['USAGE'], grantee: 'PUBLIC' },
        true
      ),
    ])
    const defaults = await one<{ grantee: string; privilege: string }>(
      db,
      `SELECT grantee, privilege FROM platform.access_default_grants WHERE schema = 'newsroom'`
    )
    expect(defaults).toContainEqual({ grantee: 'newsroom_reader', privilege: 'SELECT' })
    const held = await one<{ name: string; grantee: string }>(
      db,
      `SELECT name, grantee FROM platform.access_object_grants WHERE grantee = 'newsroom_writer' ORDER BY 1`
    )
    expect(held.map((h) => h.name)).toEqual(['newsroom.issue_no', 'newsroom.shout(text)'])
    expect(
      databaseGrantStatement('platform', { privileges: ['temporary'], grantee: 'sales' })
    ).toBe('GRANT TEMPORARY ON DATABASE "platform" TO "sales";')
    expect(() =>
      objectGrantStatement({
        objects: 'FUNCTION',
        name: 'x(); DROP TABLE y',
        privileges: ['EXECUTE'],
        grantee: 'a',
      })
    ).toThrow()
  })
  test('upkeep runs where PostgreSQL allows it, and a session is ended by its number', async () => {
    const db = await w.as(admin)
    await run(db, [
      maintenanceStatement('ANALYZE', 'newsroom', 'articles'),
      maintenanceStatement('REINDEX', 'newsroom', 'articles'),
    ])
    // VACUUM is refused inside a transaction; the interface runs it on its own.
    await expect(run(db, [maintenanceStatement('VACUUM', 'newsroom', 'articles')])).rejects.toThrow(
      'transaction'
    )
    await db.query(maintenanceStatement('VACUUM', 'newsroom', 'articles'))
    expect(endSessionStatement(42, true)).toBe('SELECT pg_cancel_backend(42);')
    const stats = await one<{ name: string }>(
      db,
      `SELECT name FROM platform.catalog_table_stats WHERE schema = 'newsroom'`
    )
    expect(stats.map((s) => s.name)).toContain('articles')
  })
})
