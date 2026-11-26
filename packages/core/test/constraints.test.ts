import { beforeAll, describe, expect, test } from 'bun:test'
import {
  catalog,
  checkConstraintStatement,
  dropConstraintStatement,
  columnStatements,
  foreignKeyStatement,
  notNullStatement,
  uniqueConstraintStatement,
} from '../src/index.ts'
import { world } from './world.ts'

let w: Awaited<ReturnType<typeof world>>
beforeAll(async () => {
  w = await world()
})

describe('the statements a constraint is written as', () => {
  test('a unique key is named as PostgreSQL names it', () => {
    const statement = uniqueConstraintStatement('newsroom', 'articles', ['title'])
    expect(statement).toContain('ADD CONSTRAINT "articles_title_key" UNIQUE ("title")')
  })
  test('a pair is one key, and is named after both of its columns', () => {
    const statement = uniqueConstraintStatement('newsroom', 'article_tags', ['article', 'tag'])
    expect(statement).toContain(
      'ADD CONSTRAINT "article_tags_article_tag_key" UNIQUE ("article", "tag")'
    )
  })
  test('a foreign key says where it points and what happens when that row goes', () => {
    const statement = foreignKeyStatement('newsroom', 'articles', 'section', {
      schema: 'newsroom',
      table: 'sections',
    })
    expect(statement).toContain('ADD CONSTRAINT "articles_section_fkey" FOREIGN KEY ("section")')
    expect(statement).toContain('REFERENCES "newsroom"."sections" (id) ON DELETE RESTRICT')
  })
  test('a check is the owner’s own SQL, and is named after the column it is about', () => {
    expect(checkConstraintStatement('newsroom', 'articles', 'word_count >= 0')).toContain(
      'ADD CONSTRAINT "articles_check" CHECK (word_count >= 0)'
    )
    expect(
      checkConstraintStatement('newsroom', 'articles', 'word_count >= 0', undefined, 'word_count')
    ).toContain('ADD CONSTRAINT "articles_word_count_check" CHECK (word_count >= 0)')
  })
  test('a column may not be empty, and may be again', () => {
    expect(notNullStatement('newsroom', 'articles', 'title')).toContain(
      'ALTER COLUMN "title" SET NOT NULL'
    )
  })
  test('a column that points at another is indexed', () => {
    const statements = columnStatements('newsroom', 'articles', {
      name: 'section',
      type: 'relation',
      relation: 'sections',
    })
    expect(statements.some((one) => one.includes('FOREIGN KEY ("section")'))).toBe(true)
    expect(
      statements.some((one) => one.includes('CREATE INDEX ON "newsroom"."articles" ("section")'))
    ).toBe(true)
  })
})

describe('the constraints a table holds', () => {
  test('a key is indexed: the rows that point at another are found without a scan', async () => {
    const found = await (await w.root()).query<{ name: string }>(
      `SELECT ic.relname::text AS name FROM pg_index x
         JOIN pg_class c ON c.oid = x.indrelid
         JOIN pg_class ic ON ic.oid = x.indexrelid
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = x.indkey[0]
        WHERE c.relname = 'articles' AND a.attname = 'section'`
    )
    expect(found.rows.length).toBeGreaterThan(0)
  })

  test('a constraint made in the interface is the one the catalog holds', async () => {
    const db = await w.root()
    await db.query(uniqueConstraintStatement('newsroom', 'sections', ['desk_email']))
    const held = await catalog(await w.root())
    expect(held.constraints.find((c) => c.name === 'sections_desk_email_key')).toMatchObject({
      type: 'u',
      columns: ['desk_email'],
    })
    await db.query(dropConstraintStatement('newsroom', 'sections', 'sections_desk_email_key'))
    const gone = await catalog(await w.root())
    expect(gone.constraints.find((c) => c.name === 'sections_desk_email_key')).toBeUndefined()
  })
})
