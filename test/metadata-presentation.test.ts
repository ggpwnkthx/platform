import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { collectionTarget } from '../packages/vocabulary/src/index.ts'
import { presentations } from '../packages/data/src/metadata/query.ts'
import { refusal } from './page.ts'
import { setMetadata } from '../packages/data/src/metadata/query.ts'
import { workspaceTarget } from '../packages/vocabulary/src/index.ts'
import { as, workspace, setup, teardown } from './metadata-world.ts'

/**
 * How an item presents itself: its name, its icon, its colour.
 */
beforeAll(async () => {
  await setup()
}, 30000)
afterAll(async () => {
  await teardown()
}, 30000)

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
