import { beforeAll, describe, expect, test } from 'bun:test'
import { selectRows } from '../src/index.ts'
import { world } from './world.ts'

let w: Awaited<ReturnType<typeof world>>
beforeAll(async () => {
  w = await world()
})

/**
 * A condition on a relation read as a column: the row a row points at. A column holds
 * one row, and the condition says what that row must be.
 */
describe('a condition on a column relation', () => {
  /** How an article reaches its section: through the column of its own. */
  const reach = {
    kind: 'column' as const,
    schema: 'newsroom',
    table: 'sections',
    column: 'section',
    target_column: 'id',
  }
  const withSection = async (op: 'eq' | 'has_all' | 'has_none', value: string[]) => {
    const db = await w.as('alice@example.com')
    return selectRows(db, {
      schema: 'newsroom',
      table: 'articles',
      columns: ['id'],
      filter: { section: { op, value } },
      reaches: { section: reach },
      limit: 100,
    })
  }

  test('is linked to all of them, and to none of them', async () => {
    const db = await w.as('alice@example.com')
    const sections = (
      await selectRows(db, { schema: 'newsroom', table: 'sections', columns: ['id'], limit: 2 })
    ).rows
    const one = String(sections[0]!.id)
    const two = String(sections[1]!.id)
    // A column holds one row: linked to all of them means linked to that one.
    const all = await withSection('has_all', [one])
    const same = await withSection('eq', [one])
    expect(all.total).toBe(same.total)
    expect(all.total).toBeGreaterThan(0)
    // Two of them cannot both be held in one column.
    expect((await withSection('has_all', [one, two])).total).toBe(0)
    // A row with no link is linked to none of them.
    const none = await withSection('has_none', [one])
    expect(none.total + all.total).toBeLessThanOrEqual(100)
  })
})
