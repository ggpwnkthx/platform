-- The administrator of a deployment that applies no site of its own: the role named in
-- deployment.admin may sign in, administers roles, admits people to the platform, and may
-- make workspaces. Run beside the server, as its own superuser:
--
--   PGOPTIONS='-c deployment.admin=admin@example.com' psql -1 -f deploy/sql/administrator.sql
DO $$
DECLARE admin text := current_setting('deployment.admin');
BEGIN
  IF to_regrole(quote_ident(admin)) IS NULL THEN EXECUTE format('CREATE ROLE %I LOGIN', admin); END IF;
  EXECUTE format('ALTER ROLE %I CREATEROLE', admin);
  EXECUTE format('GRANT platform_users, platform_admins TO %I WITH ADMIN OPTION', admin);
  EXECUTE format('GRANT CREATE ON DATABASE %I TO %I', current_database(), admin);
END $$;
