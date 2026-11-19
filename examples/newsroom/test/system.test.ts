import { beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import {
  catalog,
  deleteRecord,
  fieldMetadata,
  insertRecord,
  isSystemWorkspace,
  labelColumn,
  metadata,
  metadataCollection,
  metadataFilter,
  metadataOfWorkspace,
  metadataStart,
  presentations,
  records,
  removeMetadata,
  setMetadata,
  systemWorkspace,
  tablesIn,
  updateRecord,
  userSchemas,
  workspacesWithMetadata,
} from '@platform/data'
import { collectionTarget, type DataSource, workspaceTarget } from '@platform/vocabulary'

/**
 * The platform's own schema is a workspace like any other, of another kind: its tables are
 * system collections, read by the same questions as the installation's own, and PostgreSQL's
 * row security decides which rows reach the reader. This asks the real thing — PostgreSQL,
 * installed with the platform's own script and seeded with the example — as each of the
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
    // Named, not RESET: this PostgreSQL runs as one user, and a reset leaves the last one chosen.
    await pg.query('SET SESSION AUTHORIZATION postgres')
  }
}

beforeAll(async () => {
  pg = await PGlite.create()
  await pg.exec(text('../../../migrations/0001_platform.sql'))
  await pg.exec(text('../seed.sql'))
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

  test('its tables are system collections, and so is each workspace’s own metadata', async () => {
    const read = await as('alice@example.com', () => catalog(db))
    expect(tablesIn(read, 'platform').map((t) => t.name)).toEqual(['activity', 'installation'])
    for (const table of read.tables)
      expect(table.system).toBe(table.schema === 'platform' || table.name === 'item_metadata')
    expect(workspacesWithMetadata(read)).toEqual(['crm', 'newsroom'])
    expect(metadataOfWorkspace(read, 'newsroom')?.owner).toBe('admin@example.com')
    expect(metadataOfWorkspace(read, 'crm')?.owner).toBe('sales')
  })

  test('the model of a system collection is nobody’s to change from here', async () => {
    for (const role of ['admin@example.com', 'alice@example.com', 'bob@example.com']) {
      const read = await as(role, () => catalog(db))
      const platform = systemWorkspace(read)!
      expect(platform.can_create).toBe(false)
      expect(platform.can_alter).toBe(false)
      for (const table of read.tables.filter((t) => t.system)) {
        expect(table.can_alter).toBe(false)
        expect(table.can_truncate).toBe(false)
      }
    }
    // The workspace itself is still its owner's: only its metadata's model is the platform's.
    const mine = await as('admin@example.com', () => catalog(db))
    expect(mine.schemas.find((s) => s.name === 'newsroom')?.can_alter).toBe(true)
    expect(tablesIn(mine, 'newsroom').find((t) => t.name === 'articles')?.can_alter).toBe(true)
  })

  test('PostgreSQL’s own grants are the reader’s rights on a system collection', async () => {
    const read = await as('alice@example.com', () => catalog(db))
    const rights = (schema: string, name: string) => {
      const t = tablesIn(read, schema).find((one) => one.name === name)!
      return [t.can_select, t.can_insert, t.can_update, t.can_delete]
    }
    // Metadata is written by whoever may write its item; the rest is read, and no more.
    expect(rights('newsroom', 'item_metadata')).toEqual([true, true, true, true])
    expect(rights('platform', 'activity')).toEqual([true, false, false, false])
    expect(rights('platform', 'installation')).toEqual([true, false, false, false])
  })

  test('a row of a system collection is named by what names it', async () => {
    const read = await as('alice@example.com', () => catalog(db))
    expect(labelColumn(read, 'newsroom', 'item_metadata')).toBe('key')
    expect(labelColumn(read, 'platform', 'activity')).toBe('operation')
    expect(labelColumn(read, 'platform', 'installation')).toBe('version')
  })
})

describe('a workspace’s own metadata', () => {
  const target = collectionTarget('newsroom', 'articles')
  const { schema, table } = metadataCollection('newsroom')
  /** The rows of a workspace's metadata, read as the records page reads a collection. */
  const all = async (workspace: string) =>
    (
      await records(db, {
        schema: workspace,
        table,
        columns: ['id', 'scope', 'table_name', 'column_name', 'key'],
        searchable: [],
        filter: {},
        search: '',
        sort: ['id'],
        limit: 500,
        offset: 0,
      })
    ).rows as { scope: string; table_name: string | null; column_name: string | null }[]
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

  test('every workspace keeps its own, owned by its owner and under forced row security', async () => {
    const installed = await pg.query<{ version: string }>(
      'SELECT version FROM platform.installation'
    )
    expect(installed.rows[0]?.version).toBe('2.3.0')
    const kept = await pg.query<{ workspace: string; owner: string; forced: boolean }>(
      `SELECT n.nspname::text AS workspace, pg_get_userbyid(c.relowner)::text AS owner,
              c.relforcerowsecurity AS forced
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = 'item_metadata' ORDER BY 1`
    )
    expect(kept.rows).toEqual([
      { workspace: 'crm', owner: 'sales', forced: true },
      { workspace: 'newsroom', owner: 'admin@example.com', forced: true },
    ])
  })

  test('row security decides which rows reach the reader, in each workspace', async () => {
    const count = (role: string, workspace: string) =>
      as(role, async () => (await all(workspace)).length)
    // Bob is of the group that owns the crm: he reads all of it. Alice holds a few rights there.
    const bob = await count('bob@example.com', 'crm')
    const alice = await count('alice@example.com', 'crm')
    expect(alice).toBeGreaterThan(0)
    expect(bob).toBeGreaterThan(alice)
    // Nobody is shown a row about a field they may not reach.
    const hidden = await as('alice@example.com', async () =>
      (await all('newsroom')).filter((row) => row.column_name === 'internal_notes')
    )
    expect(hidden).toEqual([])
    const shown = await as('admin@example.com', async () =>
      (await all('newsroom')).filter((row) => row.column_name === 'internal_notes')
    )
    expect(shown.length).toBeGreaterThan(0)
  })

  test('the rows of an item are the collection, filtered to the item', async () => {
    const rows = await as('admin@example.com', rowsOf)
    expect(rows.map((row) => row.key)).toEqual(
      ['color', 'display_field', 'display_name', 'icon', 'retention'].sort()
    )
    expect(rows.find((row) => row.key === 'retention')?.value).toEqual({
      drafts_days: 90,
      published: 'forever',
    })
    // The questions written for an item's metadata read the same rows.
    const asked = await as('admin@example.com', () => metadata(db, target))
    expect(asked.map((entry) => entry.key)).toEqual(rows.map((row) => row.key))
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

  test('the statements the editors write go to the workspace’s own collection', async () => {
    await as('admin@example.com', async () => {
      expect(await setMetadata(db, target, 'scratch', { a: 1 })).toBe(1)
      expect(await setMetadata(db, target, 'scratch', { a: 2 })).toBe(1)
      expect((await rowsOf()).find((one) => one.key === 'scratch')?.value).toEqual({ a: 2 })
      expect(await removeMetadata(db, target, 'scratch')).toBe(1)
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

  test('the owner of a workspace is held to the same rules as everyone else', async () => {
    // The crm's collection is owned by the group sales, and bob is of it: row security is
    // forced, so even its owner writes only what the policies let through.
    await as('bob@example.com', async () => {
      expect(
        await refusal(
          insertRecord(db, 'crm', table, { scope: 'collection', table_name: 'nowhere', key: 'k' })
        )
      ).toBe('42501')
    })
  })

  test('every workspace’s presentation is read in one question', async () => {
    const shown = await as('alice@example.com', async () =>
      presentations(db, workspacesWithMetadata(await catalog(db)))
    )
    const named = (workspace: string) =>
      shown.find(
        (row) =>
          row.scope === 'workspace' && row.schema_name === workspace && row.key === 'display_name'
      )?.value
    expect(named('newsroom')).toBe('Newsroom')
    expect(named('crm')).toBe('CRM')
  })

  test('a workspace that keeps no metadata yet has none, and its owner gives it its collection', async () => {
    await pg.exec('CREATE SCHEMA drafts AUTHORIZATION "admin@example.com"')
    const fresh = workspaceTarget('drafts')
    await as('alice@example.com', async () => {
      expect(await metadata(db, fresh)).toEqual([])
      expect(await fieldMetadata(db, 'drafts', 'anything')).toEqual([])
    })
    await as('admin@example.com', async () => {
      expect(await metadata(db, fresh)).toEqual([])
      expect(metadataOfWorkspace(await catalog(db), 'drafts')).toBeUndefined()
      await db.query("SELECT platform.create_metadata('drafts')")
      // Safe to repeat: a workspace that has its collection is left as it is.
      await db.query("SELECT platform.create_metadata('drafts')")
      expect(metadataOfWorkspace(await catalog(db), 'drafts')?.system).toBe(true)
      expect(await setMetadata(db, fresh, 'purpose', 'Work in progress')).toBe(1)
      expect((await metadata(db, fresh)).map((entry) => entry.key)).toEqual(['purpose'])
    })
    await pg.exec('DROP SCHEMA drafts CASCADE')
  })

  test('nobody but its owner gives a workspace its collection', async () => {
    await pg.exec('CREATE SCHEMA drafts AUTHORIZATION "admin@example.com"')
    await as('alice@example.com', async () => {
      expect(await refusal(db.query("SELECT platform.create_metadata('drafts')"))).toBe('42501')
    })
    await pg.exec('DROP SCHEMA drafts CASCADE')
  })
})
