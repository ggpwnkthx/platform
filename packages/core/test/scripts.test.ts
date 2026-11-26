import { beforeAll, describe, expect, test } from 'bun:test'
import { type Db, parseCsv, selectRows, splitStatements, toCsv } from '../src/index.ts'
import { admin, world } from './world.ts'

let w: Awaited<ReturnType<typeof world>>
beforeAll(async () => {
  w = await world()
})
const one = async <T>(db: Db, text: string) => (await db.query<T>(text)).rows

describe('scripts, files and searches', () => {
  test('a script is cut at the semicolons that end a statement', () => {
    expect(splitStatements('SELECT 1; SELECT \'a;b\'; -- c;\nSELECT "x;" FROM t;')).toEqual([
      'SELECT 1',
      "SELECT 'a;b'",
      '-- c;\nSELECT "x;" FROM t',
    ])
    expect(
      splitStatements(
        'CREATE FUNCTION f() RETURNS int AS $body$ SELECT 1; $body$ LANGUAGE sql; SELECT 2'
      )
    ).toHaveLength(2)
    expect(splitStatements("SELECT E'it\\'s;'; /* a; /* b; */ c; */ SELECT $$x;$$;")).toHaveLength(
      2
    )
    expect(splitStatements("SELECT 'it''s;'; ;; -- only\n")).toEqual(["SELECT 'it''s;'"])
  })
  test('rows go out to CSV and come back as they were', () => {
    const csv = toCsv(
      ['title', 'notes', 'tags'],
      [
        { title: 'A, "quoted" one', notes: 'two\nlines', tags: ['x'] },
        { title: 'B', notes: null },
      ]
    )
    expect(parseCsv(csv)).toEqual([
      ['title', 'notes', 'tags'],
      ['A, "quoted" one', 'two\nlines', '["x"]'],
      ['B', '', ''],
    ])
  })
  test('a row is found by its words, as a web search reads them', async () => {
    const db = await w.as(admin)
    const found = async (value: string) =>
      (
        await selectRows(db, {
          schema: 'newsroom',
          table: 'articles',
          columns: ['title'],
          filter: { title: { op: 'matches', value } },
          limit: 100,
        })
      ).rows.length
    const all = (
      await selectRows(db, {
        schema: 'newsroom',
        table: 'articles',
        columns: ['title'],
        limit: 100,
      })
    ).rows.length
    const word = String(
      (
        await one<{ title: string }>(
          db,
          `SELECT title FROM newsroom.articles ORDER BY title LIMIT 1`
        )
      )[0]!.title
    ).split(/\s+/)[0]!
    expect(await found(word)).toBeGreaterThan(0)
    expect(await found(`${word} -${word}`)).toBe(0)
    expect(all).toBeGreaterThan(0)
  })
})
