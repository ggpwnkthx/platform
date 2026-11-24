import { beforeAll, describe, expect, test } from 'bun:test'
import { applyManifest, catalog } from '../src/index.ts'
import { world } from './world.ts'

let w: Awaited<ReturnType<typeof world>>
beforeAll(async () => {
  w = await world()
})

/**
 * A relation is a foreign key, and a manifest may say that a key is not to be there. The
 * relation is dropped, and the two collections are apart until it is made again.
 */
describe('a relation that is taken away', () => {
  const apart = { collection: 'articles', field: 'section', related: 'sections' }
  const keyIsThere = async () =>
    !!(await catalog(await w.root())).relations.find(
      (one) => one.table === 'articles' && one.column === 'section'
    )

  test('the key is dropped, and made again', async () => {
    const db = await w.root()
    expect(await keyIsThere()).toBe(true)
    const gone = await applyManifest(db, {
      workspaces: [{ slug: 'newsroom', relations: [{ ...apart, state: 'absent' }] }],
    })
    expect(gone.changes.some((one) => one.includes('unrelate'))).toBe(true)
    expect(await keyIsThere()).toBe(false)
    // A second apply finds nothing to take away, and changes nothing.
    const again = await applyManifest(db, {
      workspaces: [{ slug: 'newsroom', relations: [{ ...apart, state: 'absent' }] }],
    })
    expect(again.changes.length).toBe(0)
    // And it is made again.
    const back = await applyManifest(db, {
      workspaces: [{ slug: 'newsroom', relations: [apart] }],
    })
    expect(back.changes.some((one) => one.includes('relate'))).toBe(true)
    expect(await keyIsThere()).toBe(true)
  })
})
