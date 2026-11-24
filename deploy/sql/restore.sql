-- Puts PostgreSQL's default back: the role catalogs readable by every connection, and no
-- guard. Run as the cluster superuser: psql -1 -f deploy/sql/restore.sql
GRANT SELECT ON pg_auth_members, pg_roles, pg_user, pg_group TO PUBLIC;
DROP EVENT TRIGGER IF EXISTS platform_guard_start;
DROP EVENT TRIGGER IF EXISTS platform_guard_end;
DROP FUNCTION IF EXISTS platform.guard_start();
DROP FUNCTION IF EXISTS platform.guard_end();
DROP FUNCTION IF EXISTS platform.guard_state();
DROP FUNCTION IF EXISTS platform.guard_trigger(oid);
DROP FUNCTION IF EXISTS platform.guard_trusted();
DROP TABLE IF EXISTS platform.guard_notes;
