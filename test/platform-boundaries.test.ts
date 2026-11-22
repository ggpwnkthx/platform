import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
  alice,
  aliceId,
  as,
  connect,
  deny,
  field,
  owner,
  role,
  runAll,
  setup,
  teardown,
  w,
} from './platform-world.ts'
import { collectionStatements } from '../packages/ui/src/model/statements.ts'
import { ident } from '../packages/vocabulary/src/index.ts'
import * as pageActivity from '../packages/data/src/activity/query.ts'
import * as pageSql from '../packages/ui/src/sql/query.ts'
import * as pageWrites from '../packages/data/src/content/write.ts'
import { refusal } from './page.ts'

/**
 * The boundaries the database itself keeps.
 */
beforeAll(async () => {
  await setup()
}, 30000)
afterAll(async () => {
  await teardown()
}, 30000)

describe('additional database boundaries', () => {
  test('WITH CHECK rejects inserts and row transitions through SQL and the page’s client', async () => {
    await owner.query(`CREATE POLICY draft_only ON newsroom.articles AS RESTRICTIVE
      FOR ALL TO ${ident(role('writer'))} USING (true) WITH CHECK (title NOT LIKE 'Denied%')`)
    try {
      await deny(alice, "INSERT INTO newsroom.articles(title) VALUES ('Denied SQL')")
      await as('alice', async (db) => {
        expect(
          await refusal(
            pageWrites.insertRecord(db, 'newsroom', 'articles', { title: 'Denied page' })
          )
        ).toBe('42501')
        expect(
          await refusal(
            pageWrites.updateRecord(db, 'newsroom', 'articles', aliceId, {
              title: 'Denied update',
            })
          )
        ).toBe('42501')
      })
      expect(
        (await alice.query('SELECT title FROM newsroom.articles WHERE id=$1', [aliceId])).rows[0]
          .title
      ).not.toBe('Denied update')
    } finally {
      await owner.query('DROP POLICY draft_only ON newsroom.articles')
    }
  })
  test('RLS without a matching INSERT policy denies writes despite table grants', async () => {
    await owner.query(`GRANT INSERT(title) ON newsroom.articles TO ${ident(role('blind'))}`)
    const q = await connect('blind')
    try {
      await deny(q, "INSERT INTO newsroom.articles(title) VALUES ('No policy')")
      expect(
        await as('blind', (db) =>
          refusal(pageWrites.insertRecord(db, 'newsroom', 'articles', { title: 'No policy' }))
        )
      ).toBe('42501')
    } finally {
      await q.end()
    }
  })
  test('typed relation builders create database foreign keys immediately', async () => {
    const children = await collectionStatements('newsroom', 'children', '', [
      field({ name: 'parent', type: 'relation', relation: 'tasks', onDelete: 'restrict' }),
    ])
    await as('owner', (db) => runAll(db, children))
    expect(
      await as('owner', (db) =>
        refusal(
          pageWrites.insertRecord(db, 'newsroom', 'children', { parent: crypto.randomUUID() })
        )
      )
    ).toBe('23503')
  })
  test('installer refuses existing sys schemas before making changes', async () => {
    await w.admin.query('BEGIN; CREATE SCHEMA sys')
    try {
      await deny(
        w.admin,
        readFileSync(new URL('../migrations/0001_platform.sql', import.meta.url), 'utf8'),
        'P0001'
      )
    } finally {
      await w.admin.query('ROLLBACK')
    }
    expect((await w.admin.query("SELECT to_regnamespace('sys') AS n")).rows[0].n).toBeNull()
  })
  test('audit visibility remains valid after an old workspace owner is dropped', async () => {
    await w.admin.query(`GRANT CREATE ON DATABASE ${ident(w.dbName)} TO ${ident(role('retired'))}`)
    const q = await connect('retired')
    try {
      await q.query(
        "CREATE SCHEMA retired_workspace; SELECT platform.create_collection('retired_workspace','records'); INSERT INTO retired_workspace.records DEFAULT VALUES; DROP SCHEMA retired_workspace CASCADE"
      )
    } finally {
      await q.end()
    }
    await w.admin.query(
      `REVOKE CREATE ON DATABASE ${ident(w.dbName)} FROM ${ident(role('retired'))}`
    )
    await w.admin.query(`DROP ROLE ${ident(role('retired'))}`)
    for (const name of ['owner', 'alice'])
      await as(name, async (db) => {
        for (const schema of ['retired_workspace', 'newsroom'])
          expect(Array.isArray(await pageActivity.activity(db, { schema }))).toBe(true)
        // The whole history the reader may see is still readable, with its row security.
        await pageSql.run(db, 'SELECT * FROM platform.revisions')
      })
  })
})
