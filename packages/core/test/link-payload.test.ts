import { beforeAll, describe, expect, test } from 'bun:test'
import {
  catalog,
  linkedRows,
  selectRows,
  setLinks,
  type RelationPath,
  transaction,
} from '../src/index.ts'
import { world } from './world.ts'

let w: Awaited<ReturnType<typeof world>>
beforeAll(async () => {
  w = await world()
})

/**
 * A link may carry something of its own: columns beside the two keys, holding what the
 * link is worth or when it began. The keys are what the pair is, and the unique index
 * over them is what makes the pair one link.
 */
describe('a link that carries something of its own', () => {
  /** A table of links with a column beside the two keys: what the link is worth. */
  const makePayloadJoin = async () => {
    const db = await w.root()
    const exists = await db.query(`SELECT to_regclass('newsroom.tag_notes') AS t`)
    if (!exists.rows[0]?.t) {
      await db.query(`SELECT platform.create_table('newsroom','tag_notes')`)
      await db.query(`ALTER TABLE newsroom.tag_notes ADD COLUMN note text`)
      await db.query(
        `ALTER TABLE newsroom.tag_notes ADD COLUMN article uuid REFERENCES newsroom.articles(id) ON DELETE CASCADE`
      )
      await db.query(
        `ALTER TABLE newsroom.tag_notes ADD COLUMN tag uuid REFERENCES newsroom.tags(id) ON DELETE CASCADE`
      )
      await db.query(`CREATE UNIQUE INDEX ON newsroom.tag_notes (article, tag)`)
    }
    return db
  }
  const notesPath = (): RelationPath => ({
    kind: 'rows',
    schema: 'newsroom',
    table: 'tag_notes',
    fk: 'article',
    target: 'tag',
    target_schema: 'newsroom',
    target_table: 'tags',
    payload: ['note'],
  })

  test('is a link, and the payload is named', async () => {
    const db = await makePayloadJoin()
    const cat = await catalog(db)
    const join = cat.joins.find((one) => one.table === 'tag_notes')
    expect(join).toMatchObject({
      schema: 'newsroom',
      table: 'tag_notes',
      uniquePair: true,
      payload: ['note'],
      left: { column: 'article', target_table: 'articles' },
      right: { column: 'tag', target_table: 'tags' },
    })
  })

  test('is written without the payload, which the database leaves empty', async () => {
    const db = await makePayloadJoin()
    const cat = await catalog(db)
    const tag = (
      await selectRows(db, { schema: 'newsroom', table: 'tags', columns: ['id'], limit: 1 })
    ).rows[0]!
    const article = (
      await selectRows(db, { schema: 'newsroom', table: 'articles', columns: ['id'], limit: 1 })
    ).rows[0]!
    await transaction(db, () => setLinks(db, notesPath(), String(article.id), [String(tag.id)]))
    const links = await linkedRows(db, cat, notesPath(), String(article.id))
    expect(links.map((one) => one.id)).toEqual([String(tag.id)])
  })

  test('is read back with what it carries', async () => {
    const db = await makePayloadJoin()
    const cat = await catalog(db)
    const tag = (
      await selectRows(db, { schema: 'newsroom', table: 'tags', columns: ['id'], limit: 1 })
    ).rows[0]!
    const article = (
      await selectRows(db, { schema: 'newsroom', table: 'articles', columns: ['id'], limit: 1 })
    ).rows[0]!
    await transaction(db, () => setLinks(db, notesPath(), String(article.id), [String(tag.id)]))
    await db.query(`UPDATE newsroom.tag_notes SET note = 'a note'`)
    const links = await linkedRows(db, cat, notesPath(), String(article.id))
    expect(links[0]!.payload).toEqual({ note: 'a note' })
  })

  test('is not a link when the payload may not be left out', async () => {
    const db = await makePayloadJoin()
    await db.query(`UPDATE newsroom.tag_notes SET note = 'a note'`)
    await db.query(`ALTER TABLE newsroom.tag_notes ALTER COLUMN note SET NOT NULL`)
    const cat = await catalog(db)
    expect(cat.joins.find((one) => one.table === 'tag_notes')).toBeUndefined()
    await db.query(`ALTER TABLE newsroom.tag_notes ALTER COLUMN note DROP NOT NULL`)
  })
})
