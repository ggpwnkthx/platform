import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type pg from 'pg'
import {
  ident,
  collectionTarget,
  fieldTarget,
  workspaceTarget,
} from '../packages/vocabulary/src/index.ts'
import {
  fieldMetadata,
  metadata,
  presentations,
  removeMetadata,
  setMetadata,
} from '../packages/data/src/metadata/query.ts'
import type { Connection } from '../packages/pg-client/src/wire.ts'
import { adminUrl } from './administrator.ts'
import { refusal } from './page.ts'
import { prefix, world, type World } from './world.ts'

/**
 * Metadata is stored in the platform schema and gated by PostgreSQL's own
 * privilege functions. These tests hold the line between three people: the owner
 * of a workspace, a reader of one of its collections, and a stranger. Each of them
 * signs in to the page's own client with a token, and row security decides.
 */

const roles = ['owner', 'reader', 'writer', 'blind', 'outsider']
let w: World
let owner: pg.Client, reader: pg.Client

/** A direct connection, as psql would make it: the role, and a token that names it. */
const connect = (name: string) => w.connect(name)
/** The name of a role in this world: one person among the others. */
const role = (name: string) => w.role(name)
/** Runs some work in the page's client as this person, then signs them out. */
const as = <T>(name: string, work: (db: Connection) => Promise<T>) => w.as(name, work)
/** The metadata of the newsroom workspace, or of its articles collection. */
const workspace = (db: Connection) => metadata(db, workspaceTarget('newsroom'))
const collection = (db: Connection) => metadata(db, collectionTarget('newsroom', 'articles'))
/** The metadata of one field of the articles collection. */
const field = (db: Connection, column: string) =>
  metadata(db, fieldTarget('newsroom', 'articles', column))
const keys = (entries: { key: string }[]) => entries.map((one) => one.key)

beforeAll(async () => {
  w = await world(prefix('m'), adminUrl)
  await w.makeRoles(roles)
  owner = await connect('owner')
  reader = await connect('reader')
  // A workspace is made with CREATE on the database, so the owner holds it.
  await w.admin.query(`GRANT CREATE ON DATABASE ${ident(w.dbName)} TO ${ident(w.role('owner'))}`)
  // The owner builds the workspace and its collection, so it owns both.
  await owner.query(
    "CREATE SCHEMA newsroom; SELECT platform.create_collection('newsroom','articles')"
  )
  await owner.query('ALTER TABLE newsroom.articles ADD COLUMN title text')
  // A second column that nobody is granted: the field nobody may reach.
  await owner.query('ALTER TABLE newsroom.articles ADD COLUMN summary text')
  await owner.query(
    `GRANT USAGE ON SCHEMA newsroom TO ${['reader', 'writer', 'blind'].map((n) => ident(w.role(n))).join(',')}`
  )
  // A reader of one column of the collection, a writer of rows, and a reader of the
  // workspace alone.
  await owner.query(`GRANT SELECT (id,title) ON newsroom.articles TO ${ident(w.role('reader'))}`)
  await owner.query(`GRANT INSERT (title) ON newsroom.articles TO ${ident(w.role('writer'))}`)
}, 30000)
afterAll(async () => {
  await Promise.all([owner?.end(), reader?.end()])
  if (w) await w.drop(roles)
}, 30000)

describe('metadata of a workspace and of a collection', () => {
  test('the owner writes the metadata of both and reads it back', async () => {
    await as('owner', async (db) => {
      expect(
        await setMetadata(db, workspaceTarget('newsroom'), 'description', 'The newsroom')
      ).toBe(1)
      expect(
        await setMetadata(db, collectionTarget('newsroom', 'articles'), 'display_field', 'title')
      ).toBe(1)
      expect(await workspace(db)).toEqual([
        expect.objectContaining({
          key: 'description',
          value: 'The newsroom',
          version: 1,
          updated_by: role('owner'),
        }),
      ])
      expect(await collection(db)).toEqual([
        expect.objectContaining({ key: 'display_field', value: 'title' }),
      ])
    })
  })

  test('writing a key that is there replaces its value', async () => {
    await as('owner', async (db) => {
      expect(await setMetadata(db, workspaceTarget('newsroom'), 'description', 'First')).toBe(1)
      expect((await workspace(db)).find((one) => one.key === 'description')?.version).toBe(2)
      expect(await setMetadata(db, workspaceTarget('newsroom'), 'description', 'Second')).toBe(1)
      const found = (await workspace(db)).find((one) => one.key === 'description')
      expect(found?.value).toBe('Second')
    })
  })

  test('the same key in another workspace is another key', async () => {
    await w.admin.query('CREATE SCHEMA IF NOT EXISTS other')
    await as('owner', async (db) => {
      expect(
        await refusal(setMetadata(db, workspaceTarget('other'), 'description', 'Somewhere else'))
      ).toBe('42501')
      expect(await metadata(db, workspaceTarget('other'))).toEqual([])
    })
  })

  test('a value may be any JSON', async () => {
    const rules = { publish: ['draft', 'published'], limit: 10, live: false }
    await as('owner', async (db) => {
      expect(await setMetadata(db, collectionTarget('newsroom', 'articles'), 'rules', rules)).toBe(
        1
      )
      const read = (await collection(db)).find((one) => one.key === 'rules')
      expect(read?.value).toEqual(rules)
    })
  })

  test('a reader of the collection reads its metadata and may not change it', async () => {
    await as('reader', async (db) => {
      expect(keys(await collection(db)).sort()).toEqual(['display_field', 'rules'])
      // The write's new row fails the owner's WITH CHECK, so PostgreSQL refuses it.
      expect(
        await refusal(
          setMetadata(db, collectionTarget('newsroom', 'articles'), 'display_field', 'headline')
        )
      ).toBe('42501')
      // A delete reaches only the rows the reader owns: none.
      expect(
        await removeMetadata(db, collectionTarget('newsroom', 'articles'), 'display_field')
      ).toBe(0)
    })
    // The reader's writes changed nothing.
    const display = (await as('owner', collection)).find((one) => one.key === 'display_field')
    expect(display?.value).toBe('title')
  })

  test('a writer of rows reads the metadata of the collection', async () => {
    expect(await as('writer', collection)).toHaveLength(2)
  })

  test('one who may only use the workspace reads the workspace, not the collection', async () => {
    await as('blind', async (db) => {
      expect(keys(await workspace(db))).toEqual(['description'])
      expect(await collection(db)).toEqual([])
    })
  })

  test('a stranger sees nothing and may write nothing', async () => {
    await as('outsider', async (db) => {
      expect(await workspace(db)).toEqual([])
      expect(await collection(db)).toEqual([])
      expect(await refusal(setMetadata(db, workspaceTarget('newsroom'), 'mine', 'mine'))).toBe(
        '42501'
      )
    })
  })

  test('the rules are PostgreSQL’s, so a direct session sees the same thing', async () => {
    const rows = await reader.query(
      'SELECT key FROM platform.item_metadata WHERE scope=$1 ORDER BY key',
      ['collection']
    )
    expect(rows.rows.map((one: { key: string }) => one.key)).toEqual(['display_field', 'rules'])
    await expect(
      reader.query(
        `INSERT INTO platform.item_metadata (scope,schema_name,table_name,key,value)
         VALUES ('collection','newsroom','articles','mine','1')`
      )
    ).rejects.toMatchObject({ code: '42501' })
  })

  test('a right that is taken away takes the metadata with it, at once', async () => {
    expect(await as('reader', collection)).toHaveLength(2)
    await owner.query(`REVOKE SELECT (id,title) ON newsroom.articles FROM ${ident(role('reader'))}`)
    try {
      expect(await as('reader', collection)).toEqual([])
    } finally {
      await owner.query(`GRANT SELECT (id,title) ON newsroom.articles TO ${ident(role('reader'))}`)
    }
    expect(await as('reader', collection)).toHaveLength(2)
  })

  test('a version names the row it changes', async () => {
    await as('owner', async (db) => {
      const first = (await collection(db)).find((one) => one.key === 'rules')
      if (!first) throw new Error('The rules were written above')
      const set = (value: unknown, version: number) =>
        setMetadata(db, collectionTarget('newsroom', 'articles'), 'rules', value, version)
      // A version the row does not carry touches nothing.
      expect(await set({ publish: ['draft'] }, first.version + 5)).toBe(0)
      expect(await set({ publish: ['draft'] }, first.version)).toBe(1)
      const changed = (await collection(db)).find((one) => one.key === 'rules')
      expect(changed).toMatchObject({ value: { publish: ['draft'] }, version: first.version + 1 })
      expect(await set({ publish: [] }, first.version)).toBe(0)
      expect((await collection(db)).find((one) => one.key === 'rules')?.value).toEqual({
        publish: ['draft'],
      })
    })
  })

  test('an owner may not write the metadata of a workspace they do not own', async () => {
    // A workspace of somebody else's: the owner of newsroom has no right on it.
    await w.admin.query('CREATE SCHEMA IF NOT EXISTS other')
    await as('owner', async (db) => {
      expect(await refusal(setMetadata(db, workspaceTarget('other'), 'mine', 'mine'))).toBe('42501')
      expect(await metadata(db, workspaceTarget('other'))).toEqual([])
    })
  })

  test('a key that is not there and a key that may not be touched are the same answer', async () => {
    expect(
      await as('owner', (db) =>
        removeMetadata(db, collectionTarget('newsroom', 'articles'), 'nothing')
      )
    ).toBe(0)
    expect(
      await as('reader', (db) =>
        removeMetadata(db, collectionTarget('newsroom', 'articles'), 'rules')
      )
    ).toBe(0)
  })

  test('the owner removes a key it owns', async () => {
    await as('owner', async (db) => {
      expect(await setMetadata(db, collectionTarget('newsroom', 'articles'), 'scratch', true)).toBe(
        1
      )
      expect(await removeMetadata(db, collectionTarget('newsroom', 'articles'), 'scratch')).toBe(1)
      expect(keys(await collection(db)).sort()).toEqual(['display_field', 'rules'])
    })
  })

  test('the page’s client reads the metadata of what it may reach', async () => {
    expect(await as('owner', collection)).toHaveLength(2)
  })
})

describe('the metadata of a field', () => {
  const title = fieldTarget('newsroom', 'articles', 'title')
  const summary = fieldTarget('newsroom', 'articles', 'summary')

  test('the owner writes the metadata of a field', async () => {
    await as('owner', async (db) => {
      expect(await setMetadata(db, title, 'display_name', 'Headline')).toBe(1)
      expect(await setMetadata(db, summary, 'display_name', 'Summary')).toBe(1)
    })
    const shown = await as('owner', (db) => field(db, 'title'))
    expect(shown.find((one) => one.key === 'display_name')?.value).toBe('Headline')
  })

  test('a reader of the column reads its metadata, and one who may not read it does not', async () => {
    await as('reader', async (db) => {
      expect(keys(await field(db, 'title'))).toEqual(['display_name'])
      // The field nobody may reach: its metadata is not returned at all.
      expect(await field(db, 'summary')).toEqual([])
    })
  })

  test('a writer of the column reads its metadata', async () => {
    expect(await as('writer', (db) => field(db, 'title'))).toHaveLength(1)
    expect(await as('writer', (db) => field(db, 'summary'))).toEqual([])
  })

  test('only the owner of the collection may change the metadata of its fields', async () => {
    await as('reader', async (db) => {
      expect(await refusal(setMetadata(db, title, 'display_name', 'Mine'))).toBe('42501')
      expect(await removeMetadata(db, title, 'display_name')).toBe(0)
    })
    const after = await as('owner', (db) => field(db, 'title'))
    expect(after.find((one) => one.key === 'display_name')?.value).toBe('Headline')
  })

  test('one who may only use the workspace reaches no field of it', async () => {
    expect(await as('blind', (db) => field(db, 'title'))).toEqual([])
    expect(await as('outsider', (db) => field(db, 'title'))).toEqual([])
  })

  test('the metadata of every field of a collection is read at once, and only what reaches the reader', async () => {
    const rows = await as('owner', (db) => fieldMetadata(db, 'newsroom', 'articles'))
    expect(rows.map((row) => row.column_name).sort()).toEqual(['summary', 'title'])
    const reader = await as('reader', (db) => fieldMetadata(db, 'newsroom', 'articles'))
    expect(reader.map((row) => row.column_name)).toEqual(['title'])
    expect(await as('blind', (db) => fieldMetadata(db, 'newsroom', 'articles'))).toEqual([])
    expect(await as('outsider', (db) => fieldMetadata(db, 'newsroom', 'articles'))).toEqual([])
  })

  test('the owner says where a field appears, and only a reader of the column learns it', async () => {
    await as('owner', async (db) => {
      expect(
        await setMetadata(db, title, 'views', { list: 'show', record: 'readonly', filter: 'hide' })
      ).toBe(1)
    })
    const shown = await as('owner', (db) => field(db, 'title'))
    expect(shown.find((one) => one.key === 'views')?.value).toEqual({
      list: 'show',
      record: 'readonly',
      filter: 'hide',
    })
    // A reader of the column reads the saying.
    const read = await as('reader', (db) => field(db, 'title'))
    expect(read.find((one) => one.key === 'views')?.value).toEqual({
      list: 'show',
      record: 'readonly',
      filter: 'hide',
    })
    // The field nobody may reach: its saying is not returned at all.
    expect(await as('reader', (db) => field(db, 'summary'))).toEqual([])
    // And only the owner of the collection may change it.
    await as('reader', async (db) => {
      expect(await refusal(setMetadata(db, title, 'views', { list: 'hide' }))).toBe('42501')
    })
    const after = await as('owner', (db) => field(db, 'title'))
    expect(after.find((one) => one.key === 'views')?.value).toMatchObject({ list: 'show' })
  })

  test('a field that is dropped leaves its metadata behind, unread', async () => {
    await owner.query('ALTER TABLE newsroom.articles DROP COLUMN summary')
    expect(await as('owner', (db) => field(db, 'summary'))).toEqual([])
    // The collection's own metadata is untouched by the loss of one of its fields.
    expect(await as('owner', collection)).toHaveLength(2)
  })
})

describe('the presentation of an item', () => {
  test('the owner writes the name, the icon and the colour of a workspace', async () => {
    await as('owner', async (db) => {
      expect(await setMetadata(db, workspaceTarget('newsroom'), 'display_name', 'Newsroom')).toBe(1)
      expect(await setMetadata(db, workspaceTarget('newsroom'), 'icon', 'newspaper')).toBe(1)
      expect(await setMetadata(db, workspaceTarget('newsroom'), 'color', 'steel')).toBe(1)
    })
    const shown = await as('owner', workspace)
    expect(shown.find((one) => one.key === 'display_name')?.value).toBe('Newsroom')
    expect(shown.find((one) => one.key === 'icon')?.value).toBe('newspaper')
    expect(shown.find((one) => one.key === 'color')?.value).toBe('steel')
  })

  test('a reader of the workspace reads its presentation and may not change it', async () => {
    const shown = await as('blind', workspace)
    expect(shown.find((one) => one.key === 'display_name')?.value).toBe('Newsroom')
    await as('blind', async (db) => {
      expect(
        await refusal(setMetadata(db, workspaceTarget('newsroom'), 'display_name', 'Mine'))
      ).toBe('42501')
    })
    const after = await as('owner', workspace)
    expect(after.find((one) => one.key === 'display_name')?.value).toBe('Newsroom')
  })

  test('the presentation of every item the reader may reach is read at once', async () => {
    await as('owner', async (db) => {
      expect(
        await setMetadata(db, collectionTarget('newsroom', 'articles'), 'display_name', 'Articles')
      ).toBe(1)
      expect(
        await setMetadata(db, collectionTarget('newsroom', 'articles'), 'icon', 'file-text')
      ).toBe(1)
    })
    const rows = await as('owner', presentations)
    expect(
      rows
        .filter((row) => row.key === 'display_name')
        .map((row) => `${row.schema_name}.${row.table_name ?? ''}`)
        .sort()
    ).toEqual(['newsroom.', 'newsroom.articles'])
    // One who may use the workspace alone reads the workspace, and no collection.
    const blind = await as('blind', presentations)
    expect(blind.map((row) => row.key).sort()).toEqual(['color', 'display_name', 'icon'])
    expect(blind.every((row) => row.table_name === null)).toBe(true)
    // A stranger reaches nothing at all.
    expect(await as('outsider', presentations)).toEqual([])
  })
})
