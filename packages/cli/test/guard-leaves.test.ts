import { beforeAll, describe, expect, test } from 'bun:test'
import { alice, as, guarded, one, pg, sql, state } from './guard-world.ts'

beforeAll(guarded, 120000)

describe('the guard, beside what it refuses', () => {
  test('refuses an ordinary owner a rule or a child table that would let writes pass by the history', async () => {
    expect(
      await as(
        alice,
        'CREATE TABLE alice_ws.shadow (LIKE alice_ws.notes); CREATE TABLE alice_ws.loose (LIKE alice_ws.notes);'
      )
    ).toBe('done')
    for (const statement of [
      'CREATE RULE quiet AS ON INSERT TO alice_ws.notes DO INSTEAD INSERT INTO alice_ws.shadow SELECT NEW.*;',
      'CREATE RULE quiet AS ON UPDATE TO alice_ws.notes DO INSTEAD NOTHING;',
      'CREATE RULE quiet AS ON DELETE TO alice_ws.notes DO ALSO NOTHING;',
    ])
      expect(await as(alice, statement), statement).toBe(
        "42501: A rule on a collection is not yours to write: it would send writes past the collection's history."
      )
    for (const statement of [
      'CREATE TABLE alice_ws.child () INHERITS (alice_ws.notes);',
      'ALTER TABLE alice_ws.loose INHERIT alice_ws.notes;',
    ])
      expect(await as(alice, statement), statement).toBe(
        '42501: A collection is not yours to make the parent of another table: rows written there would have no history.'
      )
    expect(
      await one(`SELECT (SELECT count(*) FROM pg_rewrite WHERE ev_class = 'alice_ws.notes'::regclass)::int AS rules,
        (SELECT count(*) FROM pg_inherits WHERE inhparent = 'alice_ws.notes'::regclass)::int AS children`)
    ).toEqual({ rules: 0, children: 0 })
  })

  test('writes a revision of a collection its owner drops, whose rows leave none of their own', async () => {
    const drops = () =>
      one<{ n: number }>(
        "SELECT count(*)::int AS n FROM platform.activity WHERE operation = 'DROP' AND schema_name = 'alice_ws' AND table_name = 'gone'"
      ).then((r) => r.n)
    expect(
      await as(
        alice,
        "SELECT platform.create_collection('alice_ws', 'gone'); INSERT INTO alice_ws.gone DEFAULT VALUES;"
      )
    ).toBe('done')
    expect(await drops()).toBe(0)
    // Dropped, and made again under the same name: the new table is no collection, and the
    // old one's end is in the history its workspace's owners read.
    expect(await as(alice, 'DROP TABLE alice_ws.gone; CREATE TABLE alice_ws.gone (n int);')).toBe(
      'done'
    )
    expect(await drops()).toBe(1)
    expect(
      await one(
        "SELECT actor, before_row, after_row FROM platform.activity WHERE operation = 'DROP' AND table_name = 'gone'"
      )
    ).toEqual({ actor: 'alice@example.com', before_row: null, after_row: null })
  })

  test('is not fooled by DDL nested inside the command it watches', async () => {
    // The default is computed while the table is rewritten, between the guard's two looks:
    // the DDL it runs is noted and checked on its own, and the outer command still is.
    const nested = `CREATE FUNCTION alice_ws.busy() RETURNS int LANGUAGE plpgsql AS $$
      BEGIN EXECUTE 'CREATE TABLE IF NOT EXISTS alice_ws.scratch (n int)'; RETURN 1; END $$;
      ALTER TABLE alice_ws.notes DISABLE ROW LEVEL SECURITY, ADD COLUMN n int DEFAULT alice_ws.busy();`
    expect(await as(alice, nested)).toBe(
      '42501: Row security on a collection is not yours to turn off.'
    )
    expect(await state()).toMatchObject({ rls: true })
  })

  test('leaves the operators and the superuser free: they administer the deployment', async () => {
    const ops = `SELECT platform.create_collection('alice_ws', 'runbook');
      ALTER TABLE alice_ws.runbook DISABLE ROW LEVEL SECURITY; ALTER TABLE alice_ws.runbook DISABLE TRIGGER ALL;`
    expect(await as('"ops@example.com"', ops)).toBe('done')
    expect(await as('postgres', 'ALTER TABLE alice_ws.notes NO FORCE ROW LEVEL SECURITY;')).toBe(
      'done'
    )
    expect(await as('postgres', 'ALTER TABLE alice_ws.notes FORCE ROW LEVEL SECURITY;')).toBe(
      'done'
    )
    expect(await state()).toEqual({ rls: true, force: true, enabled: 'OOO' })
  })

  test('leaves no notes behind once a command is done', async () => {
    expect(await one('SELECT count(*)::int AS n FROM platform.guard_notes')).toEqual({ n: 0 })
    expect(await as(alice, 'SELECT * FROM platform.guard_notes;')).toStartWith('42501')
  })
})

describe('the hardening', () => {
  const reads = (what: string) =>
    one<{ can: boolean }>(
      `SELECT has_table_privilege('alice@example.com', '${what}', 'SELECT') AS can`
    ).then((r) => r.can)
  test('hides the role catalogs from ordinary roles, and restore.sql undoes it and the guard', async () => {
    expect(await reads('pg_auth_members')).toBe(false)
    expect(await reads('pg_roles')).toBe(false)
    // pg_group is the same membership graph again, under another name.
    expect(await reads('pg_group')).toBe(false)
    expect(await as(alice, 'SELECT grolist FROM pg_group;')).toStartWith('42501')
    expect(
      await one(`SELECT has_table_privilege('ops@example.com', 'pg_group', 'SELECT') AS can`)
    ).toEqual({ can: true })
    expect(
      await one(`SELECT has_table_privilege('ops@example.com', 'pg_auth_members', 'SELECT') AS can`)
    ).toEqual({ can: true })
    await pg.exec(await sql('restore.sql'))
    expect(await reads('pg_auth_members')).toBe(true)
    expect(await reads('pg_group')).toBe(true)
    expect(
      await one(
        "SELECT count(*)::int AS n FROM pg_event_trigger WHERE evtname LIKE 'platform_guard%'"
      )
    ).toEqual({ n: 0 })
    expect(await as(alice, 'ALTER TABLE alice_ws.notes DISABLE TRIGGER ALL;')).toBe('done')
  })
})
