import { beforeAll, describe, expect, test } from 'bun:test'
import { alice, as, guarded, pg, state } from './guard-world.ts'

beforeAll(guarded, 120000)

describe('the guard', () => {
  test('is installed as two event triggers', async () => {
    const installed = await pg.query<{ evtname: string }>(
      "SELECT evtname FROM pg_event_trigger WHERE evtname LIKE 'platform_guard%' ORDER BY 1"
    )
    expect(installed.rows.map((r) => r.evtname)).toEqual([
      'platform_guard_end',
      'platform_guard_start',
    ])
  })

  test('leaves an owner the ordinary changes: a field, a policy, a renamed trigger, a collection of their own', async () => {
    expect(await as(alice, 'ALTER TABLE alice_ws.notes ADD COLUMN body text;')).toBe('done')
    expect(
      await as(alice, 'CREATE POLICY mine ON alice_ws.notes USING (created_by = session_user);')
    ).toBe('done')
    expect(
      await as(alice, 'ALTER TRIGGER platform_audit ON alice_ws.notes RENAME TO history;')
    ).toBe('done')
    expect(
      await as(
        alice,
        "SELECT platform.create_collection('alice_ws', 'drafts'); DROP TABLE alice_ws.drafts;"
      )
    ).toBe('done')
    expect(await state()).toEqual({ rls: true, force: true, enabled: 'OOO' })
  })

  test('refuses an ordinary owner row security off, however it is said', async () => {
    for (const statement of [
      'ALTER TABLE alice_ws.notes DISABLE ROW LEVEL SECURITY;',
      'ALTER TABLE alice_ws.notes DISABLE/**/ROW LEVEL SECURITY;',
      'ALTER TABLE alice_ws.notes NO FORCE ROW LEVEL SECURITY;',
      "DO $$ BEGIN EXECUTE 'ALTER TABLE alice_ws.notes ' || 'DISABLE ROW LEVEL SECURITY'; END $$;",
    ])
      expect(await as(alice, statement), statement).toBe(
        '42501: Row security on a collection is not yours to turn off.'
      )
    expect(await state()).toMatchObject({ rls: true, force: true })
  })

  test('refuses an ordinary owner the triggers that write a collection’s history, by any name', async () => {
    for (const statement of [
      'DROP TRIGGER history ON alice_ws.notes;',
      'DROP TRIGGER platform_stamp ON alice_ws.notes;',
      'ALTER TABLE alice_ws.notes DISABLE TRIGGER ALL;',
      'ALTER TABLE alice_ws.notes DISABLE TRIGGER USER;',
      'ALTER TABLE alice_ws.notes DISABLE TRIGGER platform_audit_truncate;',
      'ALTER TABLE alice_ws.notes ENABLE REPLICA TRIGGER history;',
      'ALTER TRIGGER history ON alice_ws.notes RENAME TO quiet; DROP TRIGGER quiet ON alice_ws.notes;',
      "DO $$ BEGIN EXECUTE format('DROP TRIGGER %I ON alice_ws.notes', 'history'); END $$;",
    ])
      expect(await as(alice, statement), statement).toBe(
        "42501: The triggers that write a collection's history are not yours to drop, disable or change."
      )
    expect(await state()).toEqual({ rls: true, force: true, enabled: 'OOO' })
  })

  test('refuses an ordinary owner a trigger replaced in place: same oid, same name, another job', async () => {
    const definitions = () =>
      pg
        .query<{ def: string }>(
          "SELECT pg_get_triggerdef(oid) AS def FROM pg_trigger WHERE tgrelid = 'alice_ws.notes'::regclass AND NOT tgisinternal ORDER BY tgname"
        )
        .then((r) => r.rows.map((row) => row.def))
    const before = await definitions()
    expect(
      await as(
        alice,
        'CREATE FUNCTION alice_ws.nothing() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;'
      )
    ).toBe('done')
    for (const statement of [
      // Another function.
      'CREATE OR REPLACE TRIGGER history AFTER INSERT OR UPDATE OR DELETE ON alice_ws.notes FOR EACH ROW EXECUTE FUNCTION alice_ws.nothing();',
      // The same function, never called.
      'CREATE OR REPLACE TRIGGER history AFTER INSERT OR UPDATE OR DELETE ON alice_ws.notes FOR EACH ROW WHEN (false) EXECUTE FUNCTION platform.record_change();',
      // The same function, on fewer events.
      'CREATE OR REPLACE TRIGGER history AFTER TRUNCATE ON alice_ws.notes FOR EACH STATEMENT EXECUTE FUNCTION platform.record_change();',
      'CREATE OR REPLACE TRIGGER history AFTER INSERT ON alice_ws.notes FOR EACH ROW EXECUTE FUNCTION platform.record_change();',
      // The stamp, on one column only: the version guard and who wrote a row, forged.
      'CREATE OR REPLACE TRIGGER platform_stamp BEFORE INSERT OR UPDATE OF body ON alice_ws.notes FOR EACH ROW EXECUTE FUNCTION platform.stamp();',
    ])
      expect(await as(alice, statement), statement).toBe(
        "42501: The triggers that write a collection's history are not yours to drop, disable or change."
      )
    expect(await definitions()).toEqual(before)
    // The same trigger again, as it was, changes nothing and is the owner's.
    expect(
      await as(
        alice,
        'CREATE OR REPLACE TRIGGER history AFTER INSERT OR UPDATE OR DELETE ON alice_ws.notes FOR EACH ROW EXECUTE FUNCTION platform.record_change();'
      )
    ).toBe('done')
  })
})
