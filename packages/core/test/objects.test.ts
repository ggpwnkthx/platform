import { beforeAll, describe, expect, test } from 'bun:test'
import {
  alterSequenceStatement,
  type Db,
  dropRoutineStatement,
  enumValueStatement,
  columnStatements,
  refreshViewStatement,
  routineStatement,
  sequenceStatement,
  transaction,
  triggerStatement,
  typeStatement,
  viewStatement,
} from '../src/index.ts'
import { admin, world } from './world.ts'

let w: Awaited<ReturnType<typeof world>>
beforeAll(async () => {
  w = await world()
})
const run = async (db: Db, statements: string[]) =>
  transaction(db, async () => {
    for (const statement of statements) await db.query(statement)
  })
const one = async <T>(db: Db, text: string) => (await db.query<T>(text)).rows

describe('what a schema holds beside its tables', () => {
  test('a view reads as its reader unless its owner says otherwise', async () => {
    const db = await w.as(admin)
    await run(db, [
      viewStatement({
        schema: 'newsroom',
        name: 'published',
        query: "SELECT title FROM newsroom.articles WHERE status = 'published';",
      }),
      viewStatement({
        schema: 'newsroom',
        name: 'counts',
        query: 'SELECT status, count(*) FROM newsroom.articles GROUP BY 1',
        materialized: true,
      }),
      refreshViewStatement('newsroom', 'counts'),
    ])
    const views = await one<{ name: string; kind: string; security_invoker: boolean }>(
      db,
      `SELECT name, kind, security_invoker FROM platform.catalog_views WHERE schema = 'newsroom' ORDER BY name`
    )
    expect(views).toEqual([
      { name: 'counts', kind: 'm', security_invoker: false },
      { name: 'published', kind: 'v', security_invoker: true },
    ])
  })
  test('a function, a trigger that calls it, and a definer whose search path is fixed', async () => {
    const db = await w.as(admin)
    const definer = routineStatement({
      schema: 'newsroom',
      name: 'shout',
      kind: 'function',
      arguments: 'words text',
      returns: 'text',
      language: 'sql',
      body: 'SELECT upper(words) || $$!$$',
      volatility: 'immutable',
      securityDefiner: true,
    })
    expect(definer).toContain('SECURITY DEFINER SET search_path = pg_catalog, pg_temp')
    expect(definer).toContain('AS $body$')
    // A body that holds the quote is quoted with one it does not hold.
    expect(
      routineStatement({
        schema: 'n',
        name: 'f',
        kind: 'procedure',
        language: 'sql',
        body: 'SELECT $body$x$body$',
      })
    ).toContain('AS $body_$')
    await run(db, [
      definer,
      routineStatement({
        schema: 'newsroom',
        name: 'title_case',
        kind: 'function',
        returns: 'trigger',
        language: 'plpgsql',
        body: 'BEGIN NEW.title := initcap(NEW.title); RETURN NEW; END',
      }),
      triggerStatement({
        schema: 'newsroom',
        table: 'articles',
        name: 'articles_title_case',
        timing: 'BEFORE',
        events: ['INSERT', 'UPDATE'],
        row: true,
        function: 'newsroom.title_case()',
        when: undefined,
      }),
    ])
    expect((await one<{ s: string }>(db, `SELECT newsroom.shout('hey') AS s`))[0]!.s).toBe('HEY!')
    const triggers = await one<{ name: string }>(
      db,
      `SELECT name FROM platform.catalog_triggers WHERE "table" = 'articles'`
    )
    expect(triggers.map((t) => t.name)).toEqual(['articles_title_case'])
    await expect(run(db, [dropRoutineStatement('newsroom.title_case()')])).rejects.toThrow()
  })
  test('sequences, enums and domains, and a column of a schema’s own type', async () => {
    const db = await w.as(admin)
    await run(db, [
      sequenceStatement({
        schema: 'newsroom',
        name: 'issue_no',
        type: 'integer',
        start: 100,
        increment: 5,
      }),
      alterSequenceStatement('newsroom', 'issue_no', { start: 200, cycle: true })!,
      typeStatement({ schema: 'newsroom', name: 'mood', kind: 'enum', values: ['calm', 'tense'] }),
      enumValueStatement('newsroom', 'mood', 'wry', 'tense'),
      typeStatement({
        schema: 'newsroom',
        name: 'positive',
        kind: 'domain',
        base: 'integer',
        check: 'VALUE > 0',
        notNull: true,
      }),
      ...columnStatements('newsroom', 'articles', { name: 'mood', type: 'newsroom.mood' }),
      ...columnStatements('newsroom', 'articles', {
        name: 'slug',
        type: 'text',
        generated: "lower(replace(title, ' ', '-'))",
      }),
      ...columnStatements('newsroom', 'articles', {
        name: 'number',
        type: 'bigint',
        identity: true,
      }),
    ])
    expect(
      (await one<{ n: number }>(db, `SELECT nextval('newsroom.issue_no')::int AS n`))[0]!.n
    ).toBe(200)
    const types = await one<{ name: string; values: string[] }>(
      db,
      `SELECT name, "values" FROM platform.catalog_user_types ORDER BY name`
    )
    expect(types.find((t) => t.name === 'mood')!.values).toEqual(['calm', 'wry', 'tense'])
    const columns = await one<{ name: string; generated: string; identity: string }>(
      db,
      `SELECT name, generated, identity FROM platform.catalog_columns WHERE "table" = 'articles' AND name IN ('slug', 'number') ORDER BY name`
    )
    expect(columns).toEqual([
      { name: 'number', generated: '', identity: 'a' },
      { name: 'slug', generated: 's', identity: '' },
    ])
  })
})
