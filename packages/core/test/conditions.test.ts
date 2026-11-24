import { beforeAll, describe, expect, test } from 'bun:test'
import { records, type RelationPath } from '../src/index.ts'
import { world } from './world.ts'

let w: Awaited<ReturnType<typeof world>>
beforeAll(async () => {
  w = await world()
})

/** The way an article reaches its tags: through the join table that links them. */
const path = (): RelationPath => ({
  kind: 'rows',
  schema: 'newsroom',
  table: 'article_tags',
  fk: 'article',
  target: 'tag',
  target_schema: 'newsroom',
  target_table: 'tags',
})

describe('the names on the other side', () => {
  test('the search finds a record by the name of the row it points at', async () => {
    const db = await w.as('alice@example.com')
    const bySection = await records(db, {
      schema: 'newsroom',
      table: 'articles',
      columns: ['id', 'title'],
      search: 'Sport',
      searchable: ['title'],
      reaches: {
        section: {
          kind: 'column',
          schema: 'newsroom',
          table: 'sections',
          column: 'section',
          target_column: 'id',
          label: 'name',
        },
      },
      limit: 50,
    })
    expect(bySection.total).toBeGreaterThan(0)
    // The search of the columns alone finds nothing: the name is on the other side.
    const byTitle = await records(db, {
      schema: 'newsroom',
      table: 'articles',
      columns: ['id'],
      search: 'Sport',
      searchable: ['title'],
      limit: 50,
    })
    expect(byTitle.total).toBe(0)
  })

  test('the search follows the links of a join table', async () => {
    const db = await w.as('alice@example.com')
    const found = await records(db, {
      schema: 'newsroom',
      table: 'articles',
      columns: ['id'],
      search: 'Sport',
      searchable: ['title'],
      reaches: { tags: { ...path(), label: 'name' } },
      limit: 50,
    })
    expect(found.total).toBeGreaterThan(0)
  })

  test('the search follows the rows that point at a record', async () => {
    const db = await w.as('alice@example.com')
    // The corrections are the rows that point at an article, and the table they live in
    // is also the table of the rows themselves: it may not be joined to itself.
    const found = await records(db, {
      schema: 'newsroom',
      table: 'articles',
      columns: ['id'],
      search: 'misattributed',
      searchable: ['title'],
      reaches: {
        corrections: {
          kind: 'rows',
          schema: 'newsroom',
          table: 'corrections',
          fk: 'article',
          target: 'id',
          target_schema: 'newsroom',
          target_table: 'corrections',
          label: 'wording',
        },
      },
      limit: 50,
    })
    expect(found.total).toBeGreaterThan(0)
  })
})

describe('a condition on the rows a relation reaches', () => {
  test('by the column of the row it points at', async () => {
    const db = await w.as('alice@example.com')
    const found = await records(db, {
      schema: 'newsroom',
      table: 'articles',
      columns: ['id', 'title'],
      filter: {
        section: {
          op: 'eq',
          value: 'Sport',
          through: { column: 'name', op: 'eq', value: 'Sport' },
        },
      },
      reaches: {
        section: {
          kind: 'column',
          schema: 'newsroom',
          table: 'sections',
          column: 'section',
          target_column: 'id',
        },
      },
      limit: 50,
    })
    expect(found.total).toBeGreaterThan(0)
    const desks = await records(db, {
      schema: 'newsroom',
      table: 'articles',
      columns: ['id'],
      filter: {
        section: {
          op: 'eq',
          value: 'Sport',
          through: { column: 'name', op: 'eq', value: 'Sport' },
        },
      },
      reaches: {
        section: {
          kind: 'column',
          schema: 'newsroom',
          table: 'sections',
          column: 'section',
          target_column: 'id',
        },
      },
      limit: 50,
    })
    expect(desks.total).toBe(found.total)
  })

  test('by the column of the row it is linked to, through a join table', async () => {
    const db = await w.as('alice@example.com')
    const found = await records(db, {
      schema: 'newsroom',
      table: 'articles',
      columns: ['id'],
      filter: {
        tags: {
          op: 'eq',
          value: 'Sport',
          through: { column: 'name', op: 'eq', value: 'Sport' },
        },
      },
      reaches: { tags: path() },
      limit: 50,
    })
    expect(found.total).toBeGreaterThan(0)
  })
})
