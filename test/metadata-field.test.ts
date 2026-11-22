import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { fieldMetadata } from '../packages/data/src/metadata/query.ts'
import { fieldTarget } from '../packages/vocabulary/src/index.ts'
import { refusal } from './page.ts'
import { removeMetadata } from '../packages/data/src/metadata/query.ts'
import { setMetadata } from '../packages/data/src/metadata/query.ts'
import { as, collection, field, keys, owner, setup, teardown } from './metadata-world.ts'

/**
 * The metadata of a field, and what it says of the field.
 */
beforeAll(async () => {
  await setup()
}, 30000)
afterAll(async () => {
  await teardown()
}, 30000)

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
