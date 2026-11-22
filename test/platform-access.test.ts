import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  alice,
  aliceId,
  as,
  bob,
  bobId,
  connect,
  deny,
  owner,
  readable,
  recordsOf,
  role,
  setup,
  teardown,
  w,
} from './platform-world.ts'
import { ident } from '../packages/vocabulary/src/index.ts'
import * as pageSql from '../packages/ui/src/sql/query.ts'
import * as pageWrites from '../packages/data/src/content/write.ts'
import { refusal } from './page.ts'

/**
 * The platform, as the database answers it: who a reader is, and what it may reach.
 */
beforeAll(async () => {
  await setup()
}, 30000)
afterAll(async () => {
  await teardown()
}, 30000)

describe('native access control', () => {
  test('RLS filters direct SQL and the page’s records identically', async () => {
    const direct = (await alice.query('SELECT id,title,created_by,version FROM newsroom.articles'))
      .rows
    const shown = await as('alice', async (db) =>
      recordsOf(db, 'articles', { columns: await readable(db, 'newsroom', 'articles') })
    )
    expect(shown.total).toBe(1)
    expect(shown.rows).toEqual(direct.map((row) => ({ ...row, version: Number(row.version) })))
    expect(direct).toHaveLength(1)
    expect(direct[0].id).toBe(aliceId)
  })
  test('column grants deny projections, predicates, sorts and writes', async () => {
    await deny(alice, 'SELECT secret FROM newsroom.articles')
    await as('alice', async (db) => {
      for (const query of [
        { columns: ['id', 'secret'] },
        { sort: ['secret'] },
        { filter: { secret: { op: 'eq' as const, value: 'hidden' } } },
      ])
        expect(await refusal(recordsOf(db, 'articles', query))).toBe('42501')
      await deny(alice, "UPDATE newsroom.articles SET secret='stolen'")
      expect(
        await refusal(
          pageWrites.updateRecord(db, 'newsroom', 'articles', aliceId, { secret: 'stolen' })
        )
      ).toBe('42501')
      expect(
        await refusal(
          pageWrites.insertRecord(db, 'newsroom', 'articles', { title: 'x', secret: 'x' })
        )
      ).toBe('42501')
    })
  })
  test('RLS prevents modifying another login’s rows', async () => {
    await as('alice', async (db) => {
      expect(
        await pageWrites.updateRecord(db, 'newsroom', 'articles', bobId, { title: 'Hacked' })
      ).toBe(0)
      expect(await pageWrites.deleteRecord(db, 'newsroom', 'articles', bobId)).toBe(0)
    })
    expect((await bob.query('SELECT title FROM newsroom.articles')).rows[0].title).toBe('Bob draft')
  })
  test('no policy means no rows even with SELECT granted', async () => {
    await owner.query(`GRANT SELECT ON newsroom.articles TO ${ident(role('blind'))}`)
    const q = await connect('blind')
    try {
      expect((await q.query('SELECT * FROM newsroom.articles')).rows).toEqual([])
      const shown = await as('blind', async (db) =>
        recordsOf(db, 'articles', { columns: await readable(db, 'newsroom', 'articles') })
      )
      expect(shown).toMatchObject({ rows: [], total: 0 })
    } finally {
      await q.end()
    }
  })
  test('REVOKE changes direct SQL and the page’s client without compiling application policies', async () => {
    await w.admin.query(`REVOKE ${ident(role('reader'))} FROM ${ident(role('alice'))}`)
    try {
      await deny(alice, 'SELECT title FROM newsroom.articles')
      expect(
        await as('alice', (db) => refusal(recordsOf(db, 'articles', { columns: ['title'] })))
      ).toBe('42501')
    } finally {
      await w.admin.query(`GRANT ${ident(role('reader'))} TO ${ident(role('alice'))}`)
    }
  })
  test('schema boundaries and DDL rights are native', async () => {
    await owner.query('CREATE SCHEMA private_area; CREATE TABLE private_area.keys(secret text)')
    await deny(alice, 'SELECT * FROM private_area.keys')
    await as('alice', async (db) => {
      for (const s of [
        'SELECT * FROM private_area.keys',
        'ALTER TABLE newsroom.articles ADD COLUMN stolen text',
        'CREATE SCHEMA unauthorized',
      ])
        expect(await refusal(pageSql.run(db, s))).toBe('42501')
    })
  })
  test('PostgreSQL ADMIN OPTION controls role delegation', async () => {
    const grant = `GRANT ${ident(role('reader'))} TO ${ident(role('outsider'))}`
    expect(await as('alice', (db) => refusal(pageSql.run(db, grant)))).toBe('42501')
    await w.admin.query(
      `GRANT ${ident(role('reader'))} TO ${ident(role('alice'))} WITH ADMIN OPTION`
    )
    try {
      expect((await as('alice', (db) => pageSql.run(db, grant))).command).toBe('GRANT ROLE')
    } finally {
      await w.admin.query(
        `REVOKE ADMIN OPTION FOR ${ident(role('reader'))} FROM ${ident(role('alice'))} CASCADE`
      )
      await w.admin.query(`REVOKE ${ident(role('reader'))} FROM ${ident(role('outsider'))}`)
    }
  })
  test('SQL GRANT immediately opens a projection in the page’s client', async () => {
    await as('owner', (db) =>
      pageSql.run(db, `GRANT SELECT(secret) ON newsroom.articles TO ${ident(role('reader'))}`)
    )
    try {
      const shown = await as('alice', (db) => recordsOf(db, 'articles', { columns: ['secret'] }))
      expect(shown.rows).toEqual([{ secret: 'hidden' }])
    } finally {
      await owner.query(`REVOKE SELECT(secret) ON newsroom.articles FROM ${ident(role('reader'))}`)
    }
  })
  test('write-only INSERT never requires or returns hidden SELECT columns', async () => {
    await owner.query(`GRANT INSERT(title) ON newsroom.articles TO ${ident(role('insert_only'))}`)
    await owner.query(
      `CREATE POLICY insert_only ON newsroom.articles FOR INSERT TO ${ident(role('insert_only'))} WITH CHECK(true)`
    )
    await as('insert_only', async (db) => {
      expect(
        await pageWrites.insertRecord(db, 'newsroom', 'articles', { title: 'Write only' })
      ).toBe(1)
      expect(await readable(db, 'newsroom', 'articles')).toEqual([])
      expect(await refusal(recordsOf(db, 'articles', { columns: ['id', 'title'] }))).toBe('42501')
    })
  })
})
