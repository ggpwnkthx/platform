import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { alice, as, deny, owner, role, setup, teardown } from './platform-world.ts'
import { ident } from '../packages/vocabulary/src/index.ts'
import * as pageActivity from '../packages/data/src/activity/query.ts'
import * as pageIdentity from '../packages/data/src/identity/query.ts'
import * as pageSql from '../packages/ui/src/sql/query.ts'
import * as pageWrites from '../packages/data/src/content/write.ts'
import { refusal } from './page.ts'

/**
 * The page's own client, and the record of what it did.
 */
beforeAll(async () => {
  await setup()
}, 30000)
afterAll(async () => {
  await teardown()
}, 30000)

describe('audit and the page’s client', () => {
  test('SQL and the page’s client both produce revisions stamped with the real login', async () => {
    await alice.query("INSERT INTO newsroom.articles(title) VALUES ('Direct audit')")
    expect(
      await as('alice', (db) =>
        pageWrites.insertRecord(db, 'newsroom', 'articles', { title: 'Page audit' })
      )
    ).toBe(1)
    const rows = (
      await owner.query(
        "SELECT actor,after_row FROM platform.revisions WHERE table_name='articles' AND after_row->>'title' IN ('Direct audit','Page audit')"
      )
    ).rows
    expect(rows).toHaveLength(2)
    expect(
      rows.every((r) => r.actor === role('alice') && r.after_row.created_by === role('alice'))
    ).toBe(true)
    const history = await as('owner', (db) => pageActivity.activity(db, { schema: 'newsroom' }))
    expect(history.length).toBeGreaterThan(0)
  })
  test('broad INSERT grants cannot forge system metadata', async () => {
    await owner.query(
      `GRANT INSERT(created_by,updated_by,version) ON newsroom.articles TO ${ident(role('writer'))}`
    )
    try {
      await alice.query(
        'INSERT INTO newsroom.articles(title,created_by,updated_by,version) VALUES($1,$2,$2,999)',
        ['Spoof test', role('bob')]
      )
      const r = (
        await alice.query(
          "SELECT created_by,version FROM newsroom.articles WHERE title='Spoof test'"
        )
      ).rows[0]
      expect(r.created_by).toBe(role('alice'))
      expect(r.version).toBe('1')
    } finally {
      await owner.query(
        `REVOKE INSERT(created_by,updated_by,version) ON newsroom.articles FROM ${ident(role('writer'))}`
      )
    }
  })
  test('readers cannot read full revisions, forge logs or disable audit triggers', async () => {
    expect((await alice.query('SELECT * FROM platform.revisions')).rows).toEqual([])
    // The log's own rows are nobody's to read past the revisions: they hold every column.
    await deny(alice, 'SELECT after_row FROM platform.activity')
    expect(await as('alice', (db) => pageActivity.activity(db, { schema: 'newsroom' }))).toEqual([])
    for (const s of [
      'DELETE FROM platform.activity',
      'TRUNCATE platform.activity',
      "INSERT INTO platform.activity(actor) VALUES('forged')",
      'ALTER TABLE newsroom.articles DISABLE TRIGGER platform_audit',
      "SET session_replication_role='replica'",
    ])
      await deny(alice, s)
  })
  test('rollbacks leave no committed audit entry', async () => {
    await alice.query(
      "BEGIN; INSERT INTO newsroom.articles(title) VALUES ('Rolled back'); ROLLBACK"
    )
    expect(
      (
        await owner.query(
          "SELECT 1 FROM platform.revisions WHERE after_row->>'title'='Rolled back'"
        )
      ).rowCount
    ).toBe(0)
  })
  test('DELETE and TRUNCATE are recorded', async () => {
    await owner.query("SELECT platform.create_collection('newsroom','disposable')")
    await owner.query(
      'INSERT INTO newsroom.disposable DEFAULT VALUES; DELETE FROM newsroom.disposable; TRUNCATE newsroom.disposable'
    )
    const ops = (
      await owner.query(
        "SELECT operation FROM platform.activity WHERE table_name='disposable' ORDER BY id"
      )
    ).rows.map((r) => r.operation)
    expect(ops).toEqual(['INSERT', 'DELETE', 'TRUNCATE'])
  })
  test('SQL accepts one statement and binds values safely', async () => {
    await as('alice', async (db) => {
      expect(await refusal(pageSql.run(db, 'SELECT 1; SELECT 2'))).toBe('42601')
      const r = await db.query('SELECT $1::text AS v', ["'; DROP TABLE newsroom.articles;--"])
      expect(r.rows[0]?.v).toContain('DROP TABLE')
    })
  })
  test('the state of one session never leaks into another', async () => {
    await as('alice', async (db) => {
      await pageSql.run(db, `SET ROLE ${ident(role('reader'))}`)
      expect((await pageIdentity.identity(db)).effective_role).toBe(role('reader'))
    })
    expect((await as('alice', pageIdentity.identity)).effective_role).toBe(role('alice'))
  })
})
