-- Hides the role catalogs from ordinary connections. Run as the cluster superuser:
--
--   psql -1 -f deploy/sql/harden.sql -f deploy/sql/guard.sql
--
-- PostgreSQL publishes pg_auth_members, pg_roles, pg_user and pg_group to every connection:
-- who belongs to which group (pg_group is that graph again, under another name), and which
-- role is privileged. After this, psql's \du and pg_dump need a
-- platform operator or a superuser; the interface is unchanged, because it reads roles through
-- platform.visible_roles() and platform.visible_memberships(), which answer about the caller.
-- pg_auth_members is a shared catalog: the rule reaches every database in this cluster.
-- deploy/sql/restore.sql puts PostgreSQL's default back.
REVOKE SELECT ON pg_auth_members FROM PUBLIC;
REVOKE SELECT ON pg_roles FROM PUBLIC;
REVOKE SELECT ON pg_user FROM PUBLIC;
REVOKE SELECT ON pg_group FROM PUBLIC;
-- To leave role names readable, so that pg_dump and GRANT keep working for everyone:
--   GRANT SELECT (oid, rolname) ON pg_roles TO PUBLIC;
--   GRANT SELECT (usename, usesysid) ON pg_user TO PUBLIC;
--   GRANT SELECT (groname, grosysid) ON pg_group TO PUBLIC;
-- The operators keep the whole catalog: they administer roles.
GRANT SELECT ON pg_auth_members, pg_roles, pg_user, pg_group TO platform_core, platform_admins;
