import { beforeAll, describe, expect, test } from 'bun:test'
import {
  catalog,
  countLinked,
  insertRecordWithLinks,
  linkedRows,
  records,
  setLinks,
  type RelationPath,
  transaction,
} from '../src/index.ts'
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

describe('a join table', () => {
  test('the catalog sees it as a link and not as a copy', async () => {
    const cat = await catalog(await w.as('alice@example.com'))
    const join = cat.joins.find((one) => one.table === 'article_tags')
    expect(join).toMatchObject({
      schema: 'newsroom',
      table: 'article_tags',
      uniquePair: true,
      left: { column: 'article', target_table: 'articles' },
      right: { column: 'tag', target_table: 'tags' },
    })
    // A collection that is not made of two keys is not a link.
    expect(cat.joins.find((one) => one.table === 'articles')).toBeUndefined()
  })

  test('a record reads the rows it is linked to', async () => {
    const db = await w.as('alice@example.com')
    const cat = await catalog(db)
    const tag = (
      await records(db, { schema: 'newsroom', table: 'tags', columns: ['id'], limit: 1 })
    ).rows[0]!
    const found = await records(db, {
      schema: 'newsroom',
      table: 'articles',
      columns: ['id', 'title'],
      filter: { tags: { op: 'has_any', value: [String(tag.id)] } },
      reaches: { tags: path() },
      limit: 50,
    })
    const article = found.rows[0]!
    const links = await linkedRows(db, cat, path(), String(article.id))
    expect(links.length).toBeGreaterThan(0)
    expect(links[0]!.label).not.toBe(links[0]!.id)
    expect(await countLinked(db, path(), String(article.id))).toBe(links.length)
  })

  test('a link is written and taken away', async () => {
    const db = await w.as('alice@example.com')
    const cat = await catalog(db)
    const tags = await records(db, {
      schema: 'newsroom',
      table: 'tags',
      columns: ['id'],
      limit: 50,
    })
    const article = (
      await records(db, {
        schema: 'newsroom',
        table: 'articles',
        columns: ['id'],
        filter: { tags: { op: 'has_any', value: [String(tags.rows[0]!.id)] } },
        reaches: { tags: path() },
        limit: 1,
      })
    ).rows[0]!
    const held = await linkedRows(db, cat, path(), String(article.id))
    const other = tags.rows.find((tag) => !held.some((one) => one.id === String(tag.id)))!
    await transaction(db, () =>
      setLinks(db, path(), String(article.id), [...held.map((l) => l.id), String(other.id)])
    )
    const grown = await linkedRows(db, cat, path(), String(article.id))
    expect(grown.length).toBe(held.length + 1)
    // The pair is unique: the same link written twice is one link.
    await transaction(db, () =>
      setLinks(db, path(), String(article.id), [...grown.map((l) => l.id), String(other.id)])
    )
    expect((await linkedRows(db, cat, path(), String(article.id))).length).toBe(grown.length)
    await transaction(db, () =>
      setLinks(
        db,
        path(),
        String(article.id),
        held.map((l) => l.id)
      )
    )
    expect((await linkedRows(db, cat, path(), String(article.id))).length).toBe(held.length)
  })

  test('a new record is written with the links it starts with', async () => {
    const db = await w.as('alice@example.com')
    const cat = await catalog(db)
    const tags = await records(db, {
      schema: 'newsroom',
      table: 'tags',
      columns: ['id'],
      limit: 2,
    })
    const wanted = tags.rows.map((tag) => String(tag.id))
    await transaction(db, () =>
      insertRecordWithLinks(
        db,
        'newsroom',
        'articles',
        { title: 'A story with tags of its own', status: 'draft' },
        [{ path: path(), ids: wanted }]
      )
    )
    const found = await records(db, {
      schema: 'newsroom',
      table: 'articles',
      columns: ['id', 'title'],
      filter: { title: { op: 'eq', value: 'A story with tags of its own' } },
      reaches: {},
      limit: 1,
    })
    const article = found.rows[0]!
    const links = await linkedRows(db, cat, path(), String(article.id))
    expect(links.map((one) => one.id).sort()).toEqual([...wanted].sort())
  })
})

describe('a condition that crosses a relation', () => {
  const tagIds = async () => {
    const db = await w.as('alice@example.com')
    const tags = await records(db, {
      schema: 'newsroom',
      table: 'tags',
      columns: ['id'],
      limit: 50,
    })
    return tags.rows.map((tag) => String(tag.id))
  }
  const linked = async (op: 'has_any' | 'has_none' | 'has_all', value: string[]) => {
    const db = await w.as('alice@example.com')
    return records(db, {
      schema: 'newsroom',
      table: 'articles',
      columns: ['id', 'title'],
      filter: { tags: { op, value } },
      reaches: { tags: path() },
      limit: 50,
    })
  }
  test('is linked to any of them, to none of them, or to all of them', async () => {
    const ids = await tagIds()
    const any = await linked('has_any', [ids[0]!])
    const none = await linked('has_none', [ids[0]!])
    expect(any.total).toBeGreaterThan(0)
    expect(any.total + none.total).toBeLessThanOrEqual(50)
    const both = await linked('has_all', ids.slice(0, 2))
    expect(both.total).toBeLessThanOrEqual(any.total)
  })
})
