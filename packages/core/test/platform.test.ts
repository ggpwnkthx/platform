import { beforeAll, describe, expect, test } from 'bun:test'
import {
  activity,
  catalog,
  choicesOf,
  columnsOf,
  type Db,
  deleteRow,
  identity,
  insertRow,
  selectRow,
  selectRows,
  sqlState,
  tablesIn,
  updateRow,
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
  test('installs from SQL files: the migration, the schema, the demonstration', async () => {
    const held = await catalog(await w.root())
    expect(tablesIn(held, 'newsroom').map((t) => t.name)).toEqual([
      'article_tags',
      'articles',
      'corrections',
      'sections',
      'tags',
    ])
    // The platform's own views of the catalog are questions, not tables.
    expect(tablesIn(held, 'platform').map((t) => t.name)).toEqual([
      'activity',
      'installation',
      'item_metadata',
      'revisions',
    ])
  })

  test('a person is their own PostgreSQL role', async () => {
    const me = await identity(await w.as('alice@example.com'))
    expect(me).toMatchObject({
      username: 'alice@example.com',
      platform_version: '3.0.0',
      is_operator: false,
    })
    expect((await identity(await w.as(admin))).is_operator).toBe(true)
  })

  test('the catalog is what the reader may reach', async () => {
    const alice = await catalog(await w.as('alice@example.com'))
    expect(alice.schemas.map((s) => s.name)).toEqual(['crm', 'newsroom', 'platform'])
    const columns = columnsOf(alice, 'newsroom', 'articles')
    expect(columns.find((c) => c.name === 'internal_notes')).toMatchObject({ can_select: false })
    expect(columns.find((c) => c.name === 'title')).toMatchObject({
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

describe('rows', () => {
  const articles = { schema: 'newsroom', table: 'articles' }
  let db: Db
  beforeAll(async () => {
    db = await w.as('alice@example.com')
  })

  test('search, filter, sort, page and count under row security', async () => {
    db = await w.as('alice@example.com')
    const page = await selectRows(db, {
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
  })

  test('a withheld column is refused by PostgreSQL, not hidden by the page', async () => {
    db = await w.as('alice@example.com')
    expect(
      await refused(selectRows(db, { ...articles, columns: ['internal_notes'], limit: 1 }))
    ).toBe('42501')
  })

  test('writes are stamped, versioned and guarded by the version the reader saw', async () => {
    db = await w.as('alice@example.com')
    expect(await insertRow(db, 'newsroom', 'articles', { title: 'A test of the remake' })).toBe(1)
    const found = await selectRows(db, {
      ...articles,
      columns: ['id', 'version', 'created_by'],
      filter: { title: { op: 'eq', value: 'A test of the remake' } },
      limit: 1,
    })
    const row = found.rows[0] as { id: string; version: number; created_by: string }
    expect(row).toMatchObject({ version: 1, created_by: 'alice@example.com' })
    expect(await updateRow(db, 'newsroom', 'articles', row.id, { status: 'review' }, 1)).toBe(1)
    expect(await updateRow(db, 'newsroom', 'articles', row.id, { status: 'draft' }, 1)).toBe(0)
    expect(await selectRow(db, 'newsroom', 'articles', ['version', 'status'], row.id)).toEqual({
      version: 2,
      status: 'review',
    })
    expect(
      await refused(updateRow(db, 'newsroom', 'articles', row.id, { status: 'nonsense' }))
    ).toBe('23514')
    expect(await deleteRow(db, 'newsroom', 'articles', row.id, 2)).toBe(1)
    // The owner reads the revisions; alice, who wrote them, does not.
    expect(await activity(db, { schema: 'newsroom', row: row.id })).toEqual([])
    const history = await activity(await w.as(admin), { schema: 'newsroom', row: row.id })
    expect(history.map((h) => h.operation)).toEqual(['DELETE', 'UPDATE', 'INSERT'])
  })
})
