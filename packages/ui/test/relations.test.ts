import { beforeAll, describe, expect, test } from 'bun:test'
import { PGlite } from '@electric-sql/pglite'
import {
  applyFolder,
  catalog,
  countLinked,
  linkedRows,
  records,
  setLinks,
  transaction,
} from '@platform/core'
import { fromPglite, pgliteParsers } from '@platform/core/pglite'
import models from '../../../examples/newsroom/apply/models.ts'
import { resolveFields } from '../src/fields/resolve.ts'

const text = (path: string) => Bun.file(new URL(`../../../${path}`, import.meta.url)).text()

let db: Awaited<ReturnType<typeof PGlite.create>>
beforeAll(async () => {
  const pg = await PGlite.create({ parsers: pgliteParsers })
  db = fromPglite(pg)
  await pg.exec(await text('migrations/0001_platform.sql'))
  const migration = await text('examples/newsroom/apply/migration.sql')
  const demo = await text('examples/newsroom/apply/demo.sql')
  await transaction(db, () => applyFolder(db, { models, migration, demo }))
})

/** The fields of a collection, as the interface meets them. */
const fieldsOf = async (schema: string, table: string) => {
  const cat = await catalog(db)
  return resolveFields(cat, schema, table)
}

describe('the interface and the relations of the newsroom', () => {
  test('an article holds the tags it is linked to, and the corrections that point at it', async () => {
    const fields = await fieldsOf('newsroom', 'articles')
    const links = fields.find((f) => f.link?.kind === 'links')!
    const children = fields.find((f) => f.link?.kind === 'children')!
    expect(links.name).toBe('tags')
    expect(children.name).toBe('corrections')
    expect(links.virtual).toBe(true)
    expect(children.virtual).toBe(true)
  })

  test('a link is added and taken away, as the interface writes it', async () => {
    const fields = await fieldsOf('newsroom', 'articles')
    const path = fields.find((f) => f.link?.kind === 'links')!.link!.path
    const article = (
      await records(db, {
        schema: 'newsroom',
        table: 'articles',
        columns: ['id'],
        filter: { tags: { op: 'has_any', value: [] } },
        reaches: { tags: path },
        limit: 1,
      })
    ).rows
    expect(article.length).toBe(0)
    const any = (
      await records(db, { schema: 'newsroom', table: 'articles', columns: ['id'], limit: 1 })
    ).rows[0]!
    const tags = await records(db, {
      schema: 'newsroom',
      table: 'tags',
      columns: ['id'],
      limit: 5,
    })
    const held = await linkedRows(db, await catalog(db), path, String(any.id))
    const spare = tags.rows.find((tag) => !held.some((one) => one.id === String(tag.id)))!
    await transaction(db, () =>
      setLinks(db, path, String(any.id), [...held.map((one) => one.id), String(spare.id)])
    )
    const grown = await linkedRows(db, await catalog(db), path, String(any.id))
    expect(grown.length).toBe(held.length + 1)
    expect(await countLinked(db, path, String(any.id))).toBe(grown.length)
    // And the condition that crosses the relation finds it.
    const found = await records(db, {
      schema: 'newsroom',
      table: 'articles',
      columns: ['id'],
      filter: { tags: { op: 'has_any', value: [String(spare.id)] } },
      reaches: { tags: path },
      limit: 50,
    })
    expect(found.rows.map((row) => String(row.id))).toContain(String(any.id))
  })

  test('the rows that point at an article are counted, and are found by the condition', async () => {
    const fields = await fieldsOf('newsroom', 'articles')
    const path = fields.find((f) => f.link?.kind === 'children')!.link!.path
    const corrected = (
      await records(db, {
        schema: 'newsroom',
        table: 'articles',
        columns: ['id'],
        filter: { corrections: { op: 'has_any', value: [] } },
        reaches: { corrections: path },
        limit: 1,
      })
    ).rows
    expect(corrected.length).toBe(0)
    const any = (
      await records(db, { schema: 'newsroom', table: 'articles', columns: ['id'], limit: 1 })
    ).rows[0]!
    const count = await countLinked(db, path, String(any.id))
    expect(count).toBeGreaterThanOrEqual(0)
    const corrections = await records(db, {
      schema: 'newsroom',
      table: 'corrections',
      columns: ['id'],
      filter: { article: { op: 'eq', value: String(any.id) } },
      limit: 50,
    })
    expect(corrections.total).toBe(count)
  })
})
