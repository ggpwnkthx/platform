import { beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import {
  type Catalog,
  catalog,
  columnsOf,
  deleteRecord,
  insertRecord,
  isSystemWorkspace,
  labelColumn,
  metadataCollection,
  metadataFilter,
  metadataStart,
  record,
  records,
  systemWorkspace,
  tablesIn,
  updateRecord,
  userSchemas,
} from '@platform/data'
import { collectionTarget, type DataSource } from '@platform/vocabulary'

/**
 * The platform's own schema is a workspace like any other, of another kind: its tables are
 * system collections, read by the same questions as the installation's own, and PostgreSQL's
 * row security decides which rows reach the reader. This asks the real thing — PostgreSQL,
 * installed with the platform's migrations and seeded with the example — as each of the
 * example's people.
 */
const text = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

let pg: PGlite
const db: DataSource = {
  // PGlite counts the rows a statement touched under another name than the platform's sources do.
  query: (async (statement: string, values?: unknown[]) => {
    const result = await pg.query(statement, values as never)
    return { rows: result.rows, affected: result.affectedRows }
  }) as DataSource['query'],
}

/** Asks as one person, as a page is one person. */
async function as<T>(role: string, ask: () => Promise<T>): Promise<T> {
  await pg.query(`SET SESSION AUTHORIZATION ${JSON.stringify(role)}`)
  try {
    return await ask()
  } finally {
    await pg.query('RESET SESSION AUTHORIZATION')
  }
}

/** One page of a collection, read as the records page reads it: every column the reader may. */
async function page(read: Catalog, table: string) {
  const columns = columnsOf(read, 'platform', table)
    .filter((c) => c.can_select)
    .map((c) => c.name)
  return records(db, {
    schema: 'platform',
    table,
    columns,
    searchable: [],
    filter: {},
    search: '',
    sort: columns.includes('id') ? ['id'] : [],
    limit: 500,
    offset: 0,
  })
}

beforeAll(async () => {
  pg = await PGlite.create()
  for (const file of [
    '../../../migrations/0001_native.sql',
    '../../../migrations/0002_harden_catalogs.sql',
    '../../../migrations/0003_metadata.sql',
    '../../../migrations/0004_field_metadata.sql',
    '../seed.sql',
  ])
    await pg.exec(text(file))
})

describe('the platform’s own workspace', () => {
  test('it is in the catalog as a system workspace, after the installation’s own', async () => {
    const read = await as('alice@example.com', () => catalog(db))
    expect(read.schemas.map((s) => `${s.name}:${s.kind}`)).toEqual([
      'crm:user',
      'newsroom:user',
      'platform:system',
    ])
    expect(userSchemas(read).map((s) => s.name)).toEqual(['crm', 'newsroom'])
    expect(systemWorkspace(read)?.name).toBe('platform')
    expect(isSystemWorkspace(read, 'platform')).toBe(true)
    expect(isSystemWorkspace(read, 'newsroom')).toBe(false)
  })

  test('its tables are system collections, and no table of the installation’s is', async () => {
    const read = await as('alice@example.com', () => catalog(db))
    expect(tablesIn(read, 'platform').map((t) => t.name)).toEqual([
      'activity',
      'installation',
      'item_metadata',
    ])
    for (const table of read.tables) expect(table.system).toBe(table.schema === 'platform')
  })

  test('its model is nobody’s to change from here, whoever owns a workspace', async () => {
    for (const role of ['admin@example.com', 'alice@example.com', 'bob@example.com']) {
      const read = await as(role, () => catalog(db))
      const platform = systemWorkspace(read)!
      expect(platform.can_create).toBe(false)
      expect(platform.can_alter).toBe(false)
      for (const table of tablesIn(read, 'platform')) {
        expect(table.can_alter).toBe(false)
        expect(table.can_truncate).toBe(false)
      }
    }
  })

  test('PostgreSQL’s own grants are the reader’s rights on a system collection', async () => {
    const read = await as('alice@example.com', () => catalog(db))
    const rights = Object.fromEntries(
      tablesIn(read, 'platform').map((t) => [
        t.name,
        [t.can_select, t.can_insert, t.can_update, t.can_delete],
      ])
    )
    // Metadata is written by whoever may write its item; the rest is read, and no more.
    expect(rights.item_metadata).toEqual([true, true, true, true])
    expect(rights.activity).toEqual([true, false, false, false])
    expect(rights.installation).toEqual([true, false, false, false])
  })

  test('a row of a system collection is named by what names it', async () => {
    const read = await as('alice@example.com', () => catalog(db))
    expect(labelColumn(read, 'platform', 'item_metadata')).toBe('key')
    expect(labelColumn(read, 'platform', 'activity')).toBe('operation')
    expect(labelColumn(read, 'platform', 'installation')).toBe('version')
  })
})

describe('the rows of a system collection', () => {
  test('are read by the questions every collection is read by', async () => {
    const found = await as('admin@example.com', async () => {
      const read = await catalog(db)
      const metadata = await page(read, 'item_metadata')
      const first = metadata.rows[0] as { id: string; key: string }
      const one = await record(db, 'platform', 'item_metadata', ['id', 'key'], first.id)
      return { metadata, first, one }
    })
    expect(found.metadata.rows.length).toBeGreaterThan(0)
    expect(found.metadata.total).toBe(found.metadata.rows.length)
    expect((found.one as { key: string } | null)?.key).toBe(found.first.key)
  })

  test('row security decides which of them reach the reader', async () => {
    const count = (role: string, table: string) =>
      as(role, async () => (await page(await catalog(db), table)).total)
    // Revisions reach a workspace's owners: alice owns none, bob is one of the crm's.
    expect(await count('alice@example.com', 'activity')).toBe(0)
    expect(await count('bob@example.com', 'activity')).toBeGreaterThan(0)
    // Metadata reaches whoever may reach its item, so not everyone reads the same rows.
    const alice = await count('alice@example.com', 'item_metadata')
    const bob = await count('bob@example.com', 'item_metadata')
    expect(alice).toBeGreaterThan(0)
    expect(bob).toBeGreaterThan(alice)
    // Nobody is shown a row about an item they may not reach.
    const reached = await as('alice@example.com', async () => {
      const read = await catalog(db)
      const rows = (await page(read, 'item_metadata')).rows as { schema_name: string }[]
      return new Set(rows.map((row) => row.schema_name))
    })
    expect([...reached].sort()).toEqual(['crm', 'newsroom'])
  })
})

describe('metadata, as the collection it is', () => {
  const { schema, table } = metadataCollection
  const target = collectionTarget('newsroom', 'articles')
  /** The rows of the item, read as the item's panel reads them. */
  const rowsOf = async () =>
    (
      await records(db, {
        schema,
        table,
        columns: ['id', 'key', 'value', 'version'],
        searchable: [],
        filter: metadataFilter(target),
        search: '',
        sort: ['key'],
        limit: 200,
        offset: 0,
      })
    ).rows as { id: string; key: string; value: unknown; version: number | string }[]
  const refusal = async (work: Promise<unknown>) =>
    work.then(
      () => null,
      (error: { code?: string }) => error.code ?? 'refused'
    )

  test('the rows of an item are the collection, filtered to the item', async () => {
    const rows = await as('admin@example.com', rowsOf)
    expect(rows.map((row) => row.key)).toEqual(
      ['color', 'display_field', 'display_name', 'icon', 'retention'].sort()
    )
    expect(rows.find((row) => row.key === 'retention')?.value).toEqual({
      drafts_days: 90,
      published: 'forever',
    })
  })

  test('a key is added, changed and removed as a row is: by its id and its version', async () => {
    await as('admin@example.com', async () => {
      // Added in the record form, which starts with the names of the item.
      const added = await insertRecord(db, schema, table, {
        ...metadataStart(target),
        key: 'review',
        value: JSON.stringify('Two editors'),
      })
      expect(added).toBe(1)
      const row = (await rowsOf()).find((one) => one.key === 'review')!
      expect(row.value).toBe('Two editors')
      const version = Number(row.version)
      // Changed by its id, only if it still carries the version that was read.
      const stale = await updateRecord(db, schema, table, row.id, { value: '"x"' }, version + 1)
      expect(stale).toBe(0)
      const changed = await updateRecord(
        db,
        schema,
        table,
        row.id,
        { value: JSON.stringify({ editors: 2 }) },
        version
      )
      expect(changed).toBe(1)
      const now = (await rowsOf()).find((one) => one.key === 'review')!
      expect(now.value).toEqual({ editors: 2 })
      expect(Number(now.version)).toBe(version + 1)
      // An item carries a key once: the collection's one rule of its own.
      expect(
        await refusal(
          insertRecord(db, schema, table, { ...metadataStart(target), key: 'review', value: '1' })
        )
      ).toBe('23505')
      expect(await deleteRecord(db, schema, table, row.id, version + 1)).toBe(1)
      expect((await rowsOf()).some((one) => one.key === 'review')).toBe(false)
    })
  })

  test('only the owner of an item changes its rows, whatever form they are changed in', async () => {
    const row = (await as('admin@example.com', rowsOf)).find((one) => one.key === 'retention')!
    await as('alice@example.com', async () => {
      // Alice reads the collection, so she reads what it is; it is not hers to change.
      expect((await rowsOf()).some((one) => one.key === 'retention')).toBe(true)
      expect(await updateRecord(db, schema, table, row.id, { value: '"mine"' })).toBe(0)
      expect(await deleteRecord(db, schema, table, row.id)).toBe(0)
      expect(
        await refusal(
          insertRecord(db, schema, table, { ...metadataStart(target), key: 'mine', value: '1' })
        )
      ).toBe('42501')
    })
  })
})
