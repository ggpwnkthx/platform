import { beforeAll, describe, expect, test } from 'bun:test'
import {
  activity,
  applyFolder,
  catalog,
  choicesOf,
  collectionStatements,
  columnsOf,
  type Db,
  deleteRecord,
  grants,
  identity,
  indexFields,
  fieldMetadata,
  insertRecord,
  policies,
  reach,
  record,
  records,
  relationLabels,
  roles,
  sqlState,
  tablesIn,
  transaction,
  updateRecord,
} from '../src/index.ts'
import { admin, world } from './world.ts'

let w: Awaited<ReturnType<typeof world>>
beforeAll(async () => {
  w = await world()
})
const refused = async (work: Promise<unknown>) =>
  sqlState(
    await work.then(
      () => null,
      (e) => e
    )
  )

describe('the example, applied', () => {
  test('installs, and a second apply changes nothing', async () => {
    expect(w.first.changes.length).toBeGreaterThan(20)
    const again = await transaction(await w.root(), () => applyFolder(w.db, w.applied))
    expect(again.changes).toEqual([])
    expect(again.notes.join(' ')).toContain('demo.sql was not run')
  })

  test('a person is their own PostgreSQL role', async () => {
    const me = await identity(await w.as('alice@example.com'))
    expect(me).toMatchObject({
      username: 'alice@example.com',
      platform_version: '2.3.0',
      is_operator: false,
    })
    expect((await identity(await w.as(admin))).is_operator).toBe(true)
  })

  test('the catalog is what the reader may reach', async () => {
    const alice = await catalog(await w.as('alice@example.com'))
    expect(alice.schemas.map((s) => s.name)).toEqual(['crm', 'newsroom', 'platform'])
    const fields = columnsOf(alice, 'newsroom', 'articles')
    expect(fields.find((c) => c.name === 'internal_notes')).toMatchObject({ can_select: false })
    expect(fields.find((c) => c.name === 'title')).toMatchObject({
      can_select: true,
      can_update: true,
    })
    expect(choicesOf(alice, 'newsroom', 'articles', 'status')).toEqual([
      'draft',
      'review',
      'published',
    ])
    const bob = await catalog(await w.as('bob@example.com'))
    expect(tablesIn(bob, 'crm').map((t) => t.name)).toEqual(['accounts', 'contacts', 'deals'])
    expect(tablesIn(bob, 'crm').every((t) => t.can_alter)).toBe(true)
  })
})

describe('records', () => {
  const articles = { schema: 'newsroom', table: 'articles' }
  let db: Db
  beforeAll(async () => {
    db = await w.as('alice@example.com')
  })

  test('search, filter, sort, page and count under row security', async () => {
    db = await w.as('alice@example.com')
    const page = await records(db, {
      ...articles,
      columns: ['id', 'title', 'status', 'section'],
      searchable: ['title'],
      search: 'the',
      filter: {
        status: { op: 'in', value: ['published', 'draft'] },
        word_count: { op: 'gte', value: 0 },
      },
      sort: ['-title'],
      limit: 5,
    })
    expect(page.total).toBeGreaterThan(5)
    expect(page.rows).toHaveLength(5)
    const titles = page.rows.map((r) => String(r.title))
    expect(titles).toEqual([...titles].sort().reverse())
    const cat = await catalog(db)
    const labels = await relationLabels(db, cat, 'newsroom', 'articles', page.rows, ['section'])
    expect(Object.values(labels.section ?? {}).length).toBeGreaterThan(0)
  })

  test('a withheld column is refused by PostgreSQL, not hidden by the page', async () => {
    db = await w.as('alice@example.com')
    expect(await refused(records(db, { ...articles, columns: ['internal_notes'], limit: 1 }))).toBe(
      '42501'
    )
  })

  test('writes are stamped, versioned and guarded by the version the reader saw', async () => {
    db = await w.as('alice@example.com')
    expect(await insertRecord(db, 'newsroom', 'articles', { title: 'A test of the remake' })).toBe(
      1
    )
    const found = await records(db, {
      ...articles,
      columns: ['id', 'version', 'created_by'],
      filter: { title: { op: 'eq', value: 'A test of the remake' } },
      limit: 1,
    })
    const row = found.rows[0] as { id: string; version: number; created_by: string }
    expect(row).toMatchObject({ version: 1, created_by: 'alice@example.com' })
    expect(await updateRecord(db, 'newsroom', 'articles', row.id, { status: 'review' }, 1)).toBe(1)
    expect(await updateRecord(db, 'newsroom', 'articles', row.id, { status: 'draft' }, 1)).toBe(0)
    expect(await record(db, 'newsroom', 'articles', ['version', 'status'], row.id)).toEqual({
      version: 2,
      status: 'review',
    })
    expect(
      await refused(updateRecord(db, 'newsroom', 'articles', row.id, { status: 'nonsense' }))
    ).toBe('23514')
    expect(await deleteRecord(db, 'newsroom', 'articles', row.id, 2)).toBe(1)
    // The owner reads the revisions; alice, who wrote them, does not.
    expect(await activity(db, { schema: 'newsroom', row: row.id })).toEqual([])
    const history = await activity(await w.as(admin), { schema: 'newsroom', row: row.id })
    expect(history.map((h) => h.operation)).toEqual(['DELETE', 'UPDATE', 'INSERT'])
  })
})

describe('access', () => {
  test('roles, grants, reach and policies are read from PostgreSQL', async () => {
    const db = await w.as(admin)
    const seen = await roles(db)
    expect(seen.roles.map((r) => r.name)).toContain('newsroom_writer')
    expect(seen.memberships).toContainEqual(
      expect.objectContaining({ role: 'sales', member: 'bob@example.com' })
    )
    const acl = await grants(db, 'newsroom')
    expect(acl).toContainEqual(
      expect.objectContaining({
        table: 'articles',
        column: 'title',
        grantee: 'newsroom_writer',
        privilege: 'UPDATE',
      })
    )
    expect(acl).toContainEqual(
      expect.objectContaining({ table: null, grantee: 'newsroom_reader', privilege: 'USAGE' })
    )
    const held = await reach(db, 'newsroom', { role: 'alice@example.com', table: 'articles' })
    expect(held[0]).toMatchObject({
      usage: true,
      select: 'some',
      update: 'some',
      delete: true,
      truncate: false,
    })
    const rules = await policies(await w.as('alice@example.com'), 'newsroom', 'articles')
    expect(rules.map((p) => p.name)).toEqual(['own_articles', 'published_articles'])
    expect(rules.every((p) => p.applies)).toBe(true)
  })

  test('only others see the whole role graph when they are operators', async () => {
    const seen = await roles(await w.as('alice@example.com'))
    expect(seen.roles.map((r) => r.name)).not.toContain('sales')
    expect(seen.memberships.every((m) => m.member === 'alice@example.com')).toBe(true)
  })
})

describe('the model and its metadata', () => {
  test('a collection is made with statements shown first, as its owner', async () => {
    const db = await w.as('bob@example.com')
    const statements = collectionStatements('crm', 'visits', 'Who we went to see.', [
      {
        name: 'account',
        type: 'relation',
        relation: 'accounts',
        onDelete: 'cascade',
        required: true,
      },
      {
        name: 'kind',
        type: 'text',
        choices: ['call', "on site's"],
        default: 'call',
        indexed: true,
      },
      { name: 'minutes', type: 'integer', min: 0, max: 600 },
      {
        name: 'place',
        type: 'text',
        maxLength: 80,
        views: { list: 'hide' },
        renderers: { list: 'truncate' },
      },
    ])
    expect(statements[0]).toBe(`SELECT platform.create_collection('crm', 'visits');`)
    await transaction(db, async () => {
      for (const statement of statements) await db.query(statement)
    })
    const cat = await catalog(db)
    expect(columnsOf(cat, 'crm', 'visits').map((c) => c.name)).toEqual([
      'id',
      'created_at',
      'updated_at',
      'created_by',
      'updated_by',
      'version',
      'account',
      'kind',
      'minutes',
      'place',
    ])
    expect(choicesOf(cat, 'crm', 'visits', 'kind')).toEqual(['call', "on site's"])
    expect(cat.relations).toContainEqual(
      expect.objectContaining({
        table: 'visits',
        column: 'account',
        target_table: 'accounts',
        on_delete: 'c',
      })
    )
    const said = indexFields(await fieldMetadata(db, 'crm', 'visits'))
    expect(said.place?.views).toMatchObject({ list: 'hide', record: 'show' })
    expect(said.place?.renderers).toEqual({ list: { renderer: 'truncate', options: {} } })
    expect(said.id?.views).toMatchObject({ list: 'show' })
    // New collections have row security and no policies: a grant alone shows no row.
    expect(cat.tables.find((t) => t.name === 'visits')).toMatchObject({
      rls: true,
      owner: 'bob@example.com',
    })
  })

  test('metadata is read by who reaches the item and written by its owner alone', async () => {
    const alice = await w.as('alice@example.com')
    const labels = indexFields(await fieldMetadata(alice, 'newsroom', 'articles'))
    expect(labels.title?.label).toBe('Headline')
    expect(labels.internal_notes).toBeUndefined()
    expect(
      await refused(
        alice.query(
          `INSERT INTO platform.item_metadata (scope, schema_name, key, value) VALUES ('workspace','newsroom','x','1')`
        )
      )
    ).toBe('42501')
  })
})
