-- The guard: what an ordinary role may not do to a table. The owner of a table may do
-- anything to it, and the owner of a table is often an ordinary member of a schema:
-- without the guard, they could turn its row security off, or drop, disable or rewrite the
-- triggers that stamp its rows and write its history, or let writes pass by those triggers.
--
-- An audited table is one that carries a trigger calling platform.record_change(), whatever
-- the trigger is named. Before every DDL command of an ordinary role, the guard notes each
-- table's row security (on, forced), its audit and stamp triggers (enabled, and what
-- each does: function, events, timing, columns, arguments, WHEN), its rules and the tables
-- that inherit from it. After the command, it refuses (42501) the command if any table
-- that had row security has it no longer or lost FORCE; lost, disabled or changed one of those
-- triggers (CREATE OR REPLACE TRIGGER keeps a trigger's oid, not what it does); gained a rule
-- or had one rewritten or enabled (DO INSTEAD sends a write elsewhere, past the triggers); or
-- gained a child table (rows written to a child show through the table, with no history).
-- It reads what the catalogs say, not what the statement said, so comments, dynamic SQL in DO
-- blocks, renamed triggers and DISABLE TRIGGER ALL are all the same to it. Adding columns and
-- writing policies remain the owner's.
--
-- Dropping a whole table remains the owner's too, and its rows go with it: a dropped
-- table has nothing left to read, so no DELETE revision is written for them. The guard writes
-- one revision of the drop instead (operation DROP, no rows), which the schema's owners
-- read like any other; a table made afterwards under the same name is a new table, and not a
-- table until it is made one.
--
-- The superusers and the operators (the members of platform_core and platform_admins) are not
-- refused, nor is their drop recorded: they administer the deployment. Run as the cluster
-- superuser, after the migration (psql -1 -f deploy/sql/guard.sql); run again, it leaves the
-- guard as it is. restore.sql takes it away.
DO $$
BEGIN
  IF current_setting('is_superuser') <> 'on' THEN
    RAISE EXCEPTION 'The guard is an event trigger: run guard.sql as the cluster superuser.' USING ERRCODE = '42501';
  END IF;
END $$;

-- Who is trusted to do this: a superuser, or an operator.
CREATE OR REPLACE FUNCTION platform.guard_trusted() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = session_user AND rolsuper)
      OR pg_has_role(session_user, 'platform_core', 'MEMBER')
      OR pg_has_role(session_user, 'platform_admins', 'MEMBER')
$$;

-- What a trigger does, apart from its name and whether it is enabled: its function, its
-- events and timing, the columns it watches, its arguments and its WHEN condition.
CREATE OR REPLACE FUNCTION platform.guard_trigger(trigger_oid oid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_array(t.tgfoid::int8, t.tgtype, t.tgattr::text, encode(t.tgargs, 'hex'),
                           t.tgqual::text, t.tgconstraint::int8, t.tgdeferrable, t.tginitdeferred)
    FROM pg_trigger t WHERE t.oid = trigger_oid
$$;

-- Each table: its name and schema owner (for the revision of its drop), its row
-- security, its audit and stamp triggers by oid (enabled, and what each does), its rules by
-- oid (enabled, and their definition) and the tables that inherit from it.
CREATE OR REPLACE FUNCTION platform.guard_state() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(jsonb_object_agg(c.oid::text, jsonb_build_object(
           'schema', n.nspname,
           'table', c.relname,
           'owner', n.nspowner::int8,
           'rls', c.relrowsecurity,
           'force', c.relforcerowsecurity,
           'triggers', (SELECT coalesce(jsonb_object_agg(t.oid::text, jsonb_build_object(
                                 'enabled', t.tgenabled::text, 'does', platform.guard_trigger(t.oid))), '{}')
                          FROM pg_trigger t
                         WHERE t.tgrelid = c.oid
                           AND t.tgfoid IN ('platform.record_change()'::regprocedure, 'platform.stamp()'::regprocedure)),
           'rules', (SELECT coalesce(jsonb_object_agg(r.oid::text, r.ev_enabled::text || ' ' || pg_get_ruledef(r.oid)), '{}')
                       FROM pg_rewrite r WHERE r.ev_class = c.oid),
           'children', (SELECT coalesce(jsonb_agg(i.inhrelid::text), '[]')
                          FROM pg_inherits i WHERE i.inhparent = c.oid))), '{}')
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE EXISTS (SELECT FROM pg_trigger a
                  WHERE a.tgrelid = c.oid AND a.tgfoid = 'platform.record_change()'::regprocedure)
$$;

-- What was noted before each command still running in a session: commands nest (DDL in a DO
-- block, or in a function a command calls), so the notes are a stack. Nobody else may read
-- or write it; a transaction that fails takes its notes with it.
CREATE UNLOGGED TABLE IF NOT EXISTS platform.guard_notes (
  pid integer NOT NULL,
  xact xid8 NOT NULL,
  depth integer NOT NULL,
  state jsonb NOT NULL,
  PRIMARY KEY (pid, depth)
);
REVOKE ALL ON platform.guard_notes FROM PUBLIC;

CREATE OR REPLACE FUNCTION platform.guard_start() RETURNS event_trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF platform.guard_trusted() THEN RETURN; END IF;
  DELETE FROM platform.guard_notes WHERE pid = pg_backend_pid() AND xact <> pg_current_xact_id();
  INSERT INTO platform.guard_notes (pid, xact, depth, state)
  SELECT pg_backend_pid(), pg_current_xact_id(), coalesce(max(depth), 0) + 1, platform.guard_state()
    FROM platform.guard_notes WHERE pid = pg_backend_pid();
END $$;

CREATE OR REPLACE FUNCTION platform.guard_end() RETURNS event_trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  noted platform.guard_notes;
  rel text;
  was jsonb;
  cur pg_class;
BEGIN
  IF platform.guard_trusted() THEN RETURN; END IF;
  SELECT * INTO noted FROM platform.guard_notes
   WHERE pid = pg_backend_pid() ORDER BY depth DESC LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  DELETE FROM platform.guard_notes WHERE pid = noted.pid AND depth = noted.depth;
  FOR rel IN SELECT jsonb_object_keys(noted.state) LOOP
    was := noted.state->rel;
    SELECT * INTO cur FROM pg_class WHERE oid = rel::oid;
    IF NOT FOUND THEN
      -- A table dropped whole is its owner's to drop; its history says that it was.
      INSERT INTO platform.activity (actor, actor_oid, schema_owner, relation, schema_name, table_name, operation)
      VALUES (session_user, (SELECT oid FROM pg_roles WHERE rolname = session_user), (was->>'owner')::oid,
              rel::oid, was->>'schema', was->>'table', 'DROP');
      CONTINUE;
    END IF;
    IF ((was->>'rls')::boolean AND NOT cur.relrowsecurity)
       OR ((was->>'force')::boolean AND NOT cur.relforcerowsecurity) THEN
      RAISE EXCEPTION 'Row security on a table is not yours to turn off.'
        USING ERRCODE = '42501', DETAIL = format('%s had row security before this command.', cur.oid::regclass);
    END IF;
    IF EXISTS (SELECT FROM jsonb_each(was->'triggers') t
                WHERE t.value->>'enabled' IN ('O', 'A')
                  AND NOT EXISTS (SELECT FROM pg_trigger g
                                   WHERE g.oid = t.key::oid AND g.tgenabled IN ('O', 'A')
                                     AND platform.guard_trigger(g.oid) = t.value->'does')) THEN
      RAISE EXCEPTION 'The triggers that write a table''s history are not yours to drop, disable or change.'
        USING ERRCODE = '42501', DETAIL = format('%s lost or changed an audit or stamp trigger in this command.', cur.oid::regclass);
    END IF;
    IF EXISTS (SELECT FROM pg_rewrite r
                WHERE r.ev_class = cur.oid AND r.ev_enabled <> 'D'
                  AND (was->'rules'->>r.oid::text) IS DISTINCT FROM r.ev_enabled::text || ' ' || pg_get_ruledef(r.oid)) THEN
      RAISE EXCEPTION 'A rule on a table is not yours to write: it would send writes past the table''s history.'
        USING ERRCODE = '42501', DETAIL = format('%s gained a rule, or had one changed or enabled, in this command.', cur.oid::regclass);
    END IF;
    IF EXISTS (SELECT FROM pg_inherits i
                WHERE i.inhparent = cur.oid AND NOT (was->'children') ? i.inhrelid::text) THEN
      RAISE EXCEPTION 'A table is not yours to make the parent of another table: rows written there would have no history.'
        USING ERRCODE = '42501', DETAIL = format('%s gained a child table in this command.', cur.oid::regclass);
    END IF;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION platform.guard_trusted(), platform.guard_trigger(oid), platform.guard_state() FROM PUBLIC;
DROP EVENT TRIGGER IF EXISTS platform_guard_start;
DROP EVENT TRIGGER IF EXISTS platform_guard_end;
CREATE EVENT TRIGGER platform_guard_start ON ddl_command_start EXECUTE FUNCTION platform.guard_start();
CREATE EVENT TRIGGER platform_guard_end ON ddl_command_end EXECUTE FUNCTION platform.guard_end();
