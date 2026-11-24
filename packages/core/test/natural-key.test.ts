import { beforeAll, describe, expect, test } from 'bun:test'
import { catalog, linkedRows, records, relationLabels } from '../src/index.ts'
import { world } from './world.ts'

let w: Awaited<ReturnType<typeof world>>
beforeAll(async () => {
  w = await world()
})

/**
 * A key made by hand may point at a column that is not the target's `id`: a natural key,
 * a code, a number of its own. The platform reads the key as PostgreSQL holds it, and
 * finds the rows on the other side by the column the key points at.
 */
describe('a key that points at a column of its own', () => {
  /** Give the sections a code of their own, and point a key at it. */
  const withNaturalKey = async () => {
    const db = await w.root()
    const made = await db.query(`SELECT to_regclass('newsroom.article_sections') AS t`)
    if (!made.rows[0]?.t) {
      await db.query(`ALTER TABLE newsroom.sections ADD COLUMN code text UNIQUE`)
      await db.query(`UPDATE newsroom.sections SET code = lower(name) WHERE code IS NULL`)
      await db.query(
        `ALTER TABLE newsroom.articles ADD COLUMN section_code text REFERENCES newsroom.sections(code) ON DELETE RESTRICT`
      )
      // The stories point at their section by the code, as well as by the id.
      await db.query(
        `UPDATE newsroom.articles a SET section_code = s.code FROM newsroom.sections s WHERE s.id = a.section`
      )
      // A link between an article and a section, by the code and not by the id.
      await db.query(`SELECT platform.create_collection('newsroom','article_sections')`)
      await db.query(`ALTER TABLE newsroom.article_sections ADD COLUMN article uuid`)
      await db.query(
        `ALTER TABLE newsroom.article_sections ADD COLUMN section text REFERENCES newsroom.sections(code) ON DELETE CASCADE`
      )
      await db.query(
        `ALTER TABLE newsroom.article_sections ADD CONSTRAINT article_sections_article_fkey FOREIGN KEY (article) REFERENCES newsroom.articles(id) ON DELETE CASCADE`
      )
      await db.query(`CREATE UNIQUE INDEX ON newsroom.article_sections (article, section)`)
      await db.query(
        `INSERT INTO newsroom.article_sections (article, section)
         SELECT a.id, s.code FROM newsroom.articles a JOIN newsroom.sections s ON s.name = 'Politics'
          LIMIT 1`
      )
    }
    return db
  }

  test('the catalog says which column the key points at', async () => {
    const db = await withNaturalKey()
    const cat = await catalog(db)
    const key = cat.relations.find(
      (one) => one.table === 'articles' && one.column === 'section_code'
    )
    expect(key).toMatchObject({
      target_table: 'sections',
      target_schema: 'newsroom',
      target_column: 'code',
    })
    // The keys that point at an id say so, too.
    const ordinary = cat.relations.find(
      (one) => one.table === 'articles' && one.column === 'section'
    )
    expect(ordinary?.target_column).toBe('id')
  })

  test('a condition on the row the key points at finds it', async () => {
    const db = await withNaturalKey()
    const found = await records(db, {
      schema: 'newsroom',
      table: 'articles',
      columns: ['id', 'title'],
      filter: { section_code: { op: 'has_any', value: ['politics'] } },
      reaches: {
        section_code: {
          kind: 'column',
          schema: 'newsroom',
          table: 'sections',
          column: 'section_code',
          target_column: 'code',
        },
      },
      limit: 50,
    })
    expect(found.total).toBeGreaterThan(0)
  })

  test('a condition on the other side of the key finds the row', async () => {
    const db = await withNaturalKey()
    const reach = {
      kind: 'column' as const,
      schema: 'newsroom',
      table: 'sections',
      column: 'section_code',
      target_column: 'code',
    }
    // The condition is on a column of the section the article points at: the row is found
    // by the column the key points at, and not by the section's id.
    const found = await records(db, {
      schema: 'newsroom',
      table: 'articles',
      columns: ['id'],
      filter: {
        section_code: {
          op: 'eq',
          value: 'politics',
          through: { column: 'name', op: 'eq', value: 'Politics' },
        },
      },
      reaches: { section_code: reach },
      limit: 50,
    })
    expect(found.total).toBeGreaterThan(0)
  })

  test('the names of the rows a record points at are the names of those rows', async () => {
    const db = await withNaturalKey()
    const cat = await catalog(db)
    const page = await records(db, {
      schema: 'newsroom',
      table: 'articles',
      columns: ['id', 'section_code'],
      filter: { section_code: { op: 'has_any', value: ['politics'] } },
      reaches: {
        section_code: {
          kind: 'column',
          schema: 'newsroom',
          table: 'sections',
          column: 'section_code',
          target_column: 'code',
        },
      },
      limit: 5,
    })
    const labels = await relationLabels(db, cat, 'newsroom', 'articles', page.rows, [
      'section_code',
    ])
    expect(labels.section_code?.politics).toBe('Politics')
  })

  test('a link that points at a code is read by that code', async () => {
    const db = await withNaturalKey()
    const cat = await catalog(db)
    const join = cat.joins.find((one) => one.table === 'article_sections')
    expect(join?.right.target_column).toBe('code')
    const path = {
      kind: 'rows' as const,
      schema: 'newsroom',
      table: 'article_sections',
      fk: 'article',
      target: 'section',
      target_schema: 'newsroom',
      target_table: 'sections',
      target_column: 'code',
    }
    const articles = await records(db, {
      schema: 'newsroom',
      table: 'articles',
      columns: ['id'],
      limit: 50,
    })
    const linked = await linkedRows(db, cat, path, String(articles.rows[0]!.id))
    // The row is found by the code, and it is known by its name.
    expect(linked.map((one) => one.label)).toContain('Politics')
  })
})

/**
 * A key may point at a collection of another workspace: the schemas are PostgreSQL's own,
 * and a key written across them is read as it is written.
 */
describe('a key that points at another workspace', () => {
  test('the catalog says which collection the key points at', async () => {
    const db = await w.root()
    const made = await db.query(`SELECT to_regclass('newsroom.article_accounts') AS t`)
    if (!made.rows[0]?.t) {
      await db.query(
        `ALTER TABLE newsroom.articles ADD COLUMN account uuid REFERENCES crm.accounts(id) ON DELETE SET NULL`
      )
    }
    const cat = await catalog(db)
    const key = cat.relations.find((one) => one.table === 'articles' && one.column === 'account')
    expect(key).toMatchObject({
      target_schema: 'crm',
      target_table: 'accounts',
      target_column: 'id',
      on_delete: 'n',
    })
  })
})
