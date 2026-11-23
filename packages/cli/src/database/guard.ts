/**
 * The guard: what an ordinary role may not do to a collection's row security, or to the
 * triggers that write its history. A table owner may do both, and a table owner is often an
 * ordinary member of a workspace: without this, the owner of a collection could turn its row
 * security off, or drop the triggers that write what happened to it.
 *
 * The guard is an event trigger: it sees every DDL statement, and refuses the two that take
 * a collection out of the platform's hands. Superusers and the operators (the members of
 * platform_core and platform_admins) are not refused: they administer the deployment.
 */
export const guardSql = () => `
-- Two helpers, and the rule they share: who is trusted to do this.
CREATE OR REPLACE FUNCTION platform.guard_trusted() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = session_user AND rolsuper)
      OR pg_has_role(session_user, 'platform_core', 'MEMBER')
      OR pg_has_role(session_user, 'platform_admins', 'MEMBER')
$$;

CREATE OR REPLACE FUNCTION platform.guard_ddl() RETURNS event_trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  said text;
BEGIN
  IF platform.guard_trusted() THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_event_trigger_ddl_commands()
                  WHERE command_tag IN ('ALTER TABLE', 'ALTER MATERIALIZED VIEW')) THEN
    RETURN;
  END IF;
  said := current_query();
  IF said ~* 'disable\\s+row\\s+level\\s+security'
     OR said ~* 'no\\s+force\\s+row\\s+level\\s+security' THEN
    RAISE EXCEPTION 'Row security on a collection is not yours to turn off.' USING ERRCODE = '42501';
  END IF;
  RETURN;
END $$;

CREATE OR REPLACE FUNCTION platform.guard_drop() RETURNS event_trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF platform.guard_trusted() THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_event_trigger_dropped_objects()
              WHERE object_identity LIKE 'platform\\_audit% on %'
                 OR object_identity LIKE 'platform\\_stamp% on %') THEN
    RAISE EXCEPTION 'The audit triggers of a collection are not yours to drop.' USING ERRCODE = '42501';
  END IF;
  RETURN;
END $$;

DROP EVENT TRIGGER IF EXISTS platform_guard_ddl;
DROP EVENT TRIGGER IF EXISTS platform_guard_drop;
CREATE EVENT TRIGGER platform_guard_ddl ON ddl_command_end EXECUTE FUNCTION platform.guard_ddl();
CREATE EVENT TRIGGER platform_guard_drop ON sql_drop EXECUTE FUNCTION platform.guard_drop();
REVOKE ALL ON FUNCTION platform.guard_trusted() FROM PUBLIC;
`

/** The guard taken away again: the event triggers, and the functions behind them. */
export const unguardSql = () => `
DROP EVENT TRIGGER IF EXISTS platform_guard_ddl;
DROP EVENT TRIGGER IF EXISTS platform_guard_drop;
DROP FUNCTION IF EXISTS platform.guard_drop();
DROP FUNCTION IF EXISTS platform.guard_ddl();
DROP FUNCTION IF EXISTS platform.guard_trusted();
`
