import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { collectionTarget } from '../packages/vocabulary/src/index.ts'
import { metadata } from '../packages/data/src/metadata/query.ts'
import { refusal } from './page.ts'
import { removeMetadata } from '../packages/data/src/metadata/query.ts'
import { setMetadata } from '../packages/data/src/metadata/query.ts'
import { workspaceTarget } from '../packages/vocabulary/src/index.ts'
import { as, collection, keys, role, w, workspace, setup, teardown } from './metadata-world.ts'

/**
 * The metadata of a workspace and of a collection, and who may read it.
 */
beforeAll(async () => {
  await setup()
}, 30000)
afterAll(async () => {
  await teardown()
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
})
