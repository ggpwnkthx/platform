import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { collectionTarget } from '../packages/vocabulary/src/index.ts'
import { ident } from '../packages/vocabulary/src/index.ts'
import { metadata } from '../packages/data/src/metadata/query.ts'
import { refusal } from './page.ts'
import { removeMetadata } from '../packages/data/src/metadata/query.ts'
import { setMetadata } from '../packages/data/src/metadata/query.ts'
import { workspaceTarget } from '../packages/vocabulary/src/index.ts'
import { as, collection, keys, owner, reader, role, w, setup, teardown } from './metadata-world.ts'

/**
 * The metadata of a workspace and of a collection, and who may read it.
 */
beforeAll(async () => {
  await setup()
}, 30000)
afterAll(async () => {
  await teardown()
}, 30000)

describe('the metadata of a workspace, and who may reach it', () => {
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
