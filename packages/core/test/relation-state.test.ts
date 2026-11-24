import { beforeAll, describe, expect, test } from 'bun:test'
import { catalog, dropConstraintStatement, relationStatement } from '../src/index.ts'
import { world } from './world.ts'

let w: Awaited<ReturnType<typeof world>>
beforeAll(async () => {
  w = await world()
})

/**
 * A relation is a foreign key. Dropped, the two collections are apart until it is made again,
 * and the catalog says so either way.
 */
describe('a relation that is taken away', () => {
  const keyIsThere = async () =>
    !!(await catalog(await w.root())).relations.find(
      (one) => one.table === 'articles' && one.column === 'section'
    )

  test('the key is dropped, and made again', async () => {
    const db = await w.root()
    expect(await keyIsThere()).toBe(true)
    await db.query(dropConstraintStatement('newsroom', 'articles', 'articles_section_fkey'))
    expect(await keyIsThere()).toBe(false)
    await db.query(relationStatement('newsroom', 'articles', 'section', 'sections', 'cascade'))
    const held = await catalog(await w.root())
    expect(
      held.relations.find((r) => r.table === 'articles' && r.column === 'section')
    ).toMatchObject({ on_delete: 'c', target_table: 'sections', target_column: 'id' })
  })
})
