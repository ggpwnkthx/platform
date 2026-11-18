-- PostgreSQL 18+. Run after 0001_native.sql, once, as the database administrator.
-- Installs Platform 2.0.1 in a database that already holds 2.0.0.
--
-- PostgreSQL publishes the role catalogs to every connected user: pg_auth_members says who
-- belongs to which group, and pg_roles says which role is privileged. The platform now answers
-- for itself, with a filtered view of the caller's own roles and memberships, and with the
-- questions its own operator tools need to ask. It also creates the group that keeps the raw
-- catalogs for the operators who administer roles.
--
-- The catalogs themselves are PostgreSQL's, and their access rules are the cluster
-- superuser's to change: hiding them from psql is a separate, explicit step,
-- `bun run cli harden <deployment>`. This migration touches only this database.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='platform_admins') THEN
    CREATE ROLE platform_admins NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='platform_admins'
    AND (rolcanlogin OR rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls)) THEN
    RAISE EXCEPTION 'Reserved platform roles must be unprivileged NOLOGIN groups';
  END IF;
END $$;

-- SET ROLE, not SET LOCAL: the installer may run this file through psql, where each
-- statement is its own transaction and a local setting would not survive it.
SET ROLE platform_core;

-- An operator is a superuser, or a member of a group that administers roles: the installer
-- through platform_core, and every administrator through platform_admins.
CREATE FUNCTION platform.is_operator() RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM pg_roles me WHERE me.rolname = session_user AND me.rolsuper)
      OR EXISTS (SELECT 1 FROM pg_roles g
                  WHERE g.rolname IN ('platform_core','platform_admins')
                    AND pg_has_role(session_user, g.oid, 'MEMBER'))
$$;

-- The roles a caller may use: their own, and the groups they belong to. An operator, who can
-- grant any role to anyone, sees them all.
CREATE FUNCTION platform.visible_roles() RETURNS TABLE(
  name text, login boolean, inherit boolean,
  create_role boolean, bypass_rls boolean, superuser boolean)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp STABLE AS $$
  SELECT r.rolname::text, r.rolcanlogin, r.rolinherit, r.rolcreaterole, r.rolbypassrls, r.rolsuper
    FROM pg_roles r
   WHERE platform.is_operator() OR pg_has_role(session_user, r.oid, 'MEMBER')
   ORDER BY r.rolname
$$;

-- The memberships a caller may see: their own, or every one of them for an operator.
CREATE FUNCTION platform.visible_memberships() RETURNS TABLE(
  role text, member text, admin_option boolean, inherit_option boolean, set_option boolean)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp STABLE AS $$
  SELECT pg_get_userbyid(m.roleid)::text, pg_get_userbyid(m.member)::text,
         m.admin_option, m.inherit_option, m.set_option
    FROM pg_auth_members m
   WHERE platform.is_operator()
      OR m.member = (SELECT oid FROM pg_roles WHERE rolname = session_user)
   ORDER BY 1, 2
$$;

-- The attributes of a role. An operator reads the truth; anyone else reads only their own.
CREATE FUNCTION platform.role_attributes(role_name text) RETURNS TABLE(
  name text, login boolean, create_role boolean)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp STABLE AS $$
  SELECT r.rolname::text, r.rolcanlogin, r.rolcreaterole
    FROM pg_roles r
   WHERE r.rolname = role_name
     AND (platform.is_operator() OR r.rolname = session_user)
$$;

-- Whether a role is a direct member of a group. An operator reads the truth; anyone else may
-- only ask about themselves, so that the answer about other people is always "no".
CREATE FUNCTION platform.is_member(member_name text, group_name text) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM pg_auth_members m
      JOIN pg_roles g ON g.oid = m.roleid
      JOIN pg_roles r ON r.oid = m.member
     WHERE g.rolname = group_name AND r.rolname = member_name
       AND (platform.is_operator() OR r.rolname = session_user)
  )
$$;

-- Whether a role may admit others to the platform: the administrator's own right.
CREATE FUNCTION platform.has_admin_option(member_name text) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp STABLE AS $$
  SELECT CASE WHEN platform.is_operator() THEN EXISTS (
    SELECT 1 FROM pg_auth_members m
      JOIN pg_roles g ON g.oid = m.roleid
      JOIN pg_roles r ON r.oid = m.member
     WHERE g.rolname = 'platform_users' AND m.admin_option AND r.rolname = member_name
  ) ELSE false END
$$;

-- The marker moves to this version. Its check constraint is named after the table.
DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT conname INTO constraint_name FROM pg_constraint
   WHERE conrelid = 'platform.installation'::regclass AND contype = 'c';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE platform.installation DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;
UPDATE platform.installation SET version = '2.0.1';
ALTER TABLE platform.installation ADD CONSTRAINT installation_version_check CHECK (version = '2.0.1');

RESET ROLE;

-- Only these functions read the catalogs for a caller. Each one answers about the caller alone,
-- so anyone who may connect the database may ask; the schema itself stays out of PUBLIC's reach.
GRANT EXECUTE ON FUNCTION platform.is_operator(), platform.visible_roles(), platform.visible_memberships(),
  platform.role_attributes(text), platform.is_member(text, text), platform.has_admin_option(text)
  TO PUBLIC, platform_users, platform_admins;
GRANT USAGE ON SCHEMA platform TO platform_admins;

-- The operators that already administer roles keep the raw catalogs, so that `apply` and the
-- operator's own psql session still read them.
DO $$
DECLARE
  member name;
BEGIN
  FOR member IN
    SELECT pg_get_userbyid(m.member) FROM pg_auth_members m
      JOIN pg_roles g ON g.oid = m.roleid
      JOIN pg_roles r ON r.oid = m.member
     WHERE g.rolname = 'platform_users' AND m.admin_option AND r.rolcreaterole
  LOOP
    BEGIN
      EXECUTE format('GRANT platform_admins TO %I WITH ADMIN OPTION', member);
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'Could not add % to platform_admins; grant it by hand.', member;
    END;
  END LOOP;
END $$;
