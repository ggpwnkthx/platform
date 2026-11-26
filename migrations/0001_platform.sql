-- PostgreSQL 18+. Run once, as the database administrator, in a NEW database.
-- Installs Platform 3.0.0 in a dedicated empty database.
--
-- Everything the platform keeps in a database is made here, in the order it depends on
-- itself: the reserved roles; the platform's own schema, with its marker, its revisions and
-- the functions that make a table; the answers it gives about the caller's own roles;
-- and metadata, with the rules it is read and written by.
--
-- Nothing here grants a person anything: identity, rights and row security are PostgreSQL's
-- own, and the platform's functions run with the caller's privileges unless they say why not.
DO $$
BEGIN
  -- People sign in with tokens, which PostgreSQL can check from version 18.
  IF current_setting('server_version_num')::int < 180000 THEN
    RAISE EXCEPTION 'PostgreSQL 18 or newer is required';
  END IF;
  IF to_regnamespace('sys') IS NOT NULL THEN
    RAISE EXCEPTION 'Existing sys schema found. Install in a dedicated empty database.';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='platform_core') THEN
    CREATE ROLE platform_core NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='platform_users') THEN
    CREATE ROLE platform_users NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  -- The group that keeps the raw role catalogs, for the operators who administer roles.
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='platform_admins') THEN
    CREATE ROLE platform_admins NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('platform_core','platform_users','platform_admins')
    AND (rolcanlogin OR rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls)) THEN
    RAISE EXCEPTION 'Reserved platform roles must be unprivileged NOLOGIN groups';
  END IF;
  EXECUTE format('GRANT platform_core TO %I', current_user);
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO platform_users', current_database());
  EXECUTE format('GRANT CREATE ON DATABASE %I TO platform_core', current_database());
END $$;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
-- SET ROLE, not SET LOCAL: the installer may run this file through psql, where each statement is its
-- own transaction and a local setting would not survive it.
SET ROLE platform_core;
CREATE SCHEMA platform AUTHORIZATION platform_core;
REVOKE ALL ON SCHEMA platform FROM PUBLIC;
GRANT USAGE ON SCHEMA platform TO platform_users;
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- The marker: the one version this database holds. The interface and the operator's tools
-- are built for one version, and refuse an installation of another.
CREATE TABLE platform.installation (
  version text PRIMARY KEY CONSTRAINT installation_version_check CHECK (version = '3.0.0'),
  installed_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO platform.installation VALUES ('3.0.0', now());
GRANT SELECT ON platform.installation TO platform_users;

CREATE TABLE platform.activity (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT clock_timestamp(),
  transaction_id bigint NOT NULL DEFAULT txid_current(),
  actor text NOT NULL,
  actor_oid oid NOT NULL,
  schema_owner oid NOT NULL,
  -- The table the row was in, as PostgreSQL knows it: a name can be given to another table,
  -- and the rights on a row's columns are the rights on this one.
  relation oid NOT NULL,
  schema_name text NOT NULL,
  table_name text NOT NULL,
  operation text NOT NULL,
  before_row jsonb,
  after_row jsonb
);
CREATE INDEX ON platform.activity(schema_name,table_name,at);
ALTER TABLE platform.activity ENABLE ROW LEVEL SECURITY;
-- What happened, to whom it may be told: every column but the rows themselves. The rows hold
-- every column of the table, whatever its column grants say, so they are read through
-- platform.revisions, below, and from this table by its owner's members alone.
GRANT SELECT (id,at,transaction_id,actor,actor_oid,schema_owner,relation,schema_name,table_name,operation)
  ON platform.activity TO platform_users;
-- Only schema owners (or members inheriting the owner's rights) see revisions.
-- Letting all actors read their own entries would leak columns hidden by column GRANTs.
-- The policy runs as the reader, so it asks PostgreSQL and reads no catalog: pg_roles may be
-- hidden from the reader (`cli harden`). An owner that has been dropped is nobody's role.
CREATE POLICY owner_reads ON platform.activity FOR SELECT TO platform_users
  USING (pg_has_role(session_user,schema_owner,'USAGE'));

-- A logged row, as the reader may read it: the columns they hold SELECT on, in the table the
-- row was in, and no others. Owning the schema is not a right on a column: a column that is
-- withheld from a reader in the table is withheld from them in its history too. The
-- table is the one the row was logged from, by its OID: a table that has been dropped has no
-- columns anybody may read, and another table given its name is another table. A column that
-- has been dropped or renamed is not a column of it any more, and is not shown.
CREATE FUNCTION platform.readable_row(p_relation oid, p_row jsonb) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE WHEN p_row IS NOT NULL THEN coalesce((
    SELECT jsonb_object_agg(e.key, e.value)
      FROM jsonb_each(p_row) e
      JOIN pg_attribute a ON a.attrelid = p_relation AND a.attname = e.key
       AND a.attnum > 0 AND NOT a.attisdropped
     WHERE has_column_privilege(session_user, p_relation, a.attnum, 'SELECT')
  ), '{}'::jsonb) END
$$;
GRANT EXECUTE ON FUNCTION platform.readable_row(oid, jsonb) TO platform_users;

-- The revisions a reader may read, with the rows cut down to the columns they may read. It
-- reads the log with its owner's rights, so it carries the log's own rule: a schema's
-- owners, asked of PostgreSQL as the policy above asks. A barrier, so that nothing the
-- reader writes into a query is run on a row before that rule has passed it.
CREATE VIEW platform.revisions WITH (security_barrier) AS
  SELECT a.id, a.at, a.transaction_id, a.actor, a.actor_oid, a.schema_owner, a.relation,
         a.schema_name, a.table_name, a.operation,
         platform.readable_row(a.relation, a.before_row) AS before_row,
         platform.readable_row(a.relation, a.after_row) AS after_row
    FROM platform.activity a
   WHERE pg_has_role(session_user, a.schema_owner, 'USAGE');
GRANT SELECT ON platform.revisions TO platform_users;

CREATE FUNCTION platform.stamp() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    NEW.created_at := statement_timestamp();
    NEW.created_by := session_user;
    NEW.version := 1;
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'id is immutable' USING ERRCODE='23514';
    END IF;
    NEW.created_at := OLD.created_at;
    NEW.created_by := OLD.created_by;
    NEW.version := OLD.version+1;
  END IF;
  NEW.updated_at := statement_timestamp();
  NEW.updated_by := session_user;
  RETURN NEW;
END $$;

-- The ONLY elevated application function: it appends a trigger's actual OLD/NEW values.
-- It accepts no caller-supplied actor or target SQL. It cannot be called as an ordinary function.
CREATE FUNCTION platform.record_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE owner_oid oid;
BEGIN
  SELECT n.nspowner INTO STRICT owner_oid FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.oid=TG_RELID;
  INSERT INTO platform.activity(actor,actor_oid,schema_owner,relation,schema_name,table_name,operation,before_row,after_row)
  VALUES (session_user,(SELECT oid FROM pg_roles WHERE rolname=session_user),owner_oid,TG_RELID,
          TG_TABLE_SCHEMA,TG_TABLE_NAME,TG_OP,
          CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END,
          CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END);
  RETURN NULL;
END $$;

-- All modeling executes with the caller's privileges. No privileged schema connection exists.
CREATE FUNCTION platform.create_table(schema_name text, table_name text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
  IF octet_length(schema_name)>63 OR octet_length(table_name)>63 OR schema_name='' OR table_name='' THEN
    RAISE EXCEPTION 'Invalid identifier length' USING ERRCODE='22023';
  END IF;
  IF schema_name IN ('platform','information_schema') OR schema_name LIKE 'pg\_%' ESCAPE '\' THEN
    RAISE EXCEPTION 'Reserved schema' USING ERRCODE='22023';
  END IF;
  EXECUTE format('CREATE TABLE %I.%I (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    created_by text NOT NULL DEFAULT session_user,
    updated_by text NOT NULL DEFAULT session_user,
    version bigint NOT NULL DEFAULT 1
  )',schema_name,table_name);
  -- New tables start with RLS enabled and no policies: owners administer, everyone else denied.
  EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',schema_name,table_name);
  EXECUTE format('CREATE TRIGGER platform_stamp BEFORE INSERT OR UPDATE ON %I.%I
    FOR EACH ROW EXECUTE FUNCTION platform.stamp()',schema_name,table_name);
  EXECUTE format('CREATE TRIGGER platform_audit AFTER INSERT OR UPDATE OR DELETE ON %I.%I
    FOR EACH ROW EXECUTE FUNCTION platform.record_change()',schema_name,table_name);
  EXECUTE format('CREATE TRIGGER platform_audit_truncate AFTER TRUNCATE ON %I.%I
    FOR EACH STATEMENT EXECUTE FUNCTION platform.record_change()',schema_name,table_name);
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA platform FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.stamp(),platform.record_change(),platform.create_table(text,text)
  TO platform_users;

-- ---------------------------------------------------------------------------------------
-- The caller's own roles and memberships.
--
-- PostgreSQL publishes the role catalogs to every connected user: pg_auth_members says who
-- belongs to which group, and pg_roles says which role is privileged. The platform answers
-- for itself, with a filtered view of the caller's own roles and memberships, and with the
-- questions its own operator tools need to ask.
--
-- The catalogs themselves are PostgreSQL's, and their access rules are the cluster
-- superuser's to change: hiding them from psql is a separate, explicit step,
-- `bun run cli harden <deployment>`. This file touches only this database.

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
  create_role boolean, bypass_rls boolean, superuser boolean, connection_limit integer)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp STABLE AS $$
  SELECT r.rolname::text, r.rolcanlogin, r.rolinherit, r.rolcreaterole, r.rolbypassrls, r.rolsuper,
         r.rolconnlimit
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
-- The connection limit is PostgreSQL's own: how many sessions the role may hold at once on
-- this server, through every relay together, and -1 where there is none.
CREATE FUNCTION platform.role_attributes(role_name text) RETURNS TABLE(
  name text, login boolean, create_role boolean, connection_limit integer)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp STABLE AS $$
  SELECT r.rolname::text, r.rolcanlogin, r.rolcreaterole, r.rolconnlimit
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


-- ---------------------------------------------------------------------------------------
-- Metadata.
--
-- Metadata describes an item rather than holding its rows: what a schema is for, how
-- a table should be read, who answers for it, what a column holds. It is kept in one
-- table of the platform's own — `platform.item_metadata` — because it describes every
-- schema at once: a row names the schema it is about, and the table or the column
-- in it.
--
-- Its access rules are PostgreSQL's own, asked of PostgreSQL's own privilege functions, so a
-- grant, a revoke or a membership change takes effect on the next statement:
--
--   * a reader sees the metadata of the items they may reach: a schema they may use, a
--     table they hold a right on, a column they hold a right on;
--   * only the owner of an item may change its metadata: the schema's owner for the
--     schema, the table's owner for a table and its columns.
--
-- Both rules are row security policies on the table. Nothing in the application
-- decides them, and a row the caller may not reach is not merely hidden: PostgreSQL does
-- not return it at all. A row that names a schema, a table or a column that has been
-- dropped is unreachable in the same way, and the metadata of a column is as private as the
-- column: a reader who may not read a column never learns what it is called.
--
-- Row security is forced on the table, so its owner is held to the same rules as
-- everyone else: a member of platform_core reads and writes the metadata of the items they
-- may reach, and no more. The table carries no audit trigger — a revision is read by a
-- schema's owners, and the metadata of a column is not theirs to read by owning the
-- schema — so metadata is not in the activity log; its rows carry their own created_by,
-- updated_by and version.
--
-- A row names its item by name, so a schema, a table or a column that is renamed by
-- hand leaves its metadata behind, as unreachable as that of an item that was dropped: the old
-- name owns nothing, so nobody the policies bind can carry the rows across afterwards. The
-- interface carries them in the rename's own transaction: the rows are deleted under the old
-- name before the rename, and written again under the new one after it.

-- Any right on a table: on the table, or on one of its columns. A reader who
-- holds a single column may read the table's metadata.
CREATE FUNCTION platform.has_item_right(p_oid oid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT p_oid IS NOT NULL AND (
    has_table_privilege(p_oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES')
    OR has_any_column_privilege(p_oid, 'SELECT,INSERT,UPDATE,REFERENCES')
  )
$$;

-- The relation a table is, and the relation a column belongs to: the table that holds the
-- column. The names are the ones the row carries, and they are looked up in the catalogs
-- rather than resolved: resolving a qualified name asks PostgreSQL for permission on the
-- schema, and a reader who may not use a schema must still be able to learn that they may
-- not read its metadata.
CREATE FUNCTION platform.metadata_relation(p_schema text, p_table text)
RETURNS oid LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = p_schema AND c.relname = p_table
     AND c.relkind IN ('r','p','v','m','f')
$$;

-- The object a metadata row names: the schema itself, the table itself, the
-- table a column belongs to.
CREATE FUNCTION platform.metadata_item(p_scope text, p_schema text, p_table text)
RETURNS oid LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE p_scope
    WHEN 'schema' THEN
      (SELECT n.oid FROM pg_namespace n WHERE n.nspname = p_schema)
    WHEN 'table' THEN
      platform.metadata_relation(p_schema, p_table)
    WHEN 'column' THEN
      platform.metadata_relation(p_schema, p_table)
    ELSE NULL
  END
$$;

-- May the caller read this column? A column is reached by whoever holds a right on its column:
-- the rule the tables already follow, asked of the column itself. A column that is gone
-- is reached by nobody.
CREATE FUNCTION platform.can_read_column(p_schema text, p_table text, p_column text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce((
    SELECT has_column_privilege(c.oid, a.attnum, 'SELECT,INSERT,UPDATE,REFERENCES')
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid
     WHERE n.nspname = p_schema AND c.relname = p_table AND a.attname = p_column
       AND a.attnum > 0 AND NOT a.attisdropped
       AND c.relkind IN ('r','p','v','m','f')
  ), false)
$$;

-- May the caller read the metadata of this item? A schema is read by whoever may use it;
-- a table by whoever holds any right on it; a column by whoever holds any right on its
-- column.
CREATE FUNCTION platform.can_read_metadata(
  p_scope text, p_schema text, p_table text, p_column text
) RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE p_scope
    WHEN 'schema' THEN coalesce(
      has_schema_privilege(platform.metadata_item(p_scope, p_schema, p_table), 'USAGE'), false)
    WHEN 'table' THEN
      platform.has_item_right(platform.metadata_item(p_scope, p_schema, p_table))
    WHEN 'column' THEN
      platform.can_read_column(p_schema, p_table, p_column)
    ELSE false
  END
$$;

-- Does the caller own the item? The schema owner owns the schema; the table owner owns the
-- table and every column in it. A group that owns the table owns it for its members,
-- which is how a model is delegated without handing over the database.
CREATE FUNCTION platform.owns_metadata(
  p_scope text, p_schema text, p_table text, p_column text
) RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE p_scope
    WHEN 'schema' THEN coalesce(pg_has_role(current_user,
      (SELECT nspowner FROM pg_namespace WHERE nspname = p_schema), 'USAGE'), false)
    WHEN 'table' THEN coalesce(pg_has_role(current_user,
      (SELECT relowner FROM pg_class
        WHERE oid = platform.metadata_item(p_scope, p_schema, p_table)), 'USAGE'), false)
    WHEN 'column' THEN coalesce(pg_has_role(current_user,
      (SELECT relowner FROM pg_class
        WHERE oid = platform.metadata_item(p_scope, p_schema, p_table)), 'USAGE'), false)
    ELSE false
  END
$$;

CREATE TABLE platform.item_metadata (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL,
  schema_name text NOT NULL,
  table_name text,
  column_name text,
  key text NOT NULL,
  value jsonb NOT NULL DEFAULT 'null'::jsonb,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  created_by text NOT NULL DEFAULT session_user,
  updated_by text NOT NULL DEFAULT session_user,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT item_metadata_scope_check CHECK (scope IN ('schema','table','column')),
  CONSTRAINT item_metadata_schema_check CHECK (octet_length(schema_name) BETWEEN 1 AND 63),
  CONSTRAINT item_metadata_key_check CHECK (octet_length(key) BETWEEN 1 AND 128),
  CONSTRAINT item_metadata_value_check CHECK (octet_length(value::text) <= 65536),
  -- A schema names a schema; a table names a table in one; a column names a column of
  -- one. The shape is checked here, so no row can name an item in more than one form.
  CONSTRAINT item_metadata_target_check CHECK (
    (scope = 'schema' AND table_name IS NULL AND column_name IS NULL)
    OR (scope = 'table' AND table_name IS NOT NULL AND column_name IS NULL)
    OR (scope = 'column' AND table_name IS NOT NULL AND column_name IS NOT NULL))
);
-- One row per key per item: the table's one rule of its own. The names are empty where
-- an item has none, so the keys of a schema are unique as well as the keys of a column.
CREATE UNIQUE INDEX item_metadata_key ON platform.item_metadata
  (scope, schema_name, coalesce(table_name, ''), coalesce(column_name, ''), key);
-- The metadata of one schema, and of one table in it, is read together.
CREATE INDEX item_metadata_item ON platform.item_metadata (schema_name, table_name);
COMMENT ON TABLE platform.item_metadata IS
  'What every schema, its tables and their columns are: one row for each key of each item.';
-- The same stamp every table carries: who wrote it, when, and which version.
CREATE TRIGGER platform_stamp BEFORE INSERT OR UPDATE ON platform.item_metadata
  FOR EACH ROW EXECUTE FUNCTION platform.stamp();
-- Forced: the owner of the table reads and writes by the same rules as everyone else.
ALTER TABLE platform.item_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.item_metadata FORCE ROW LEVEL SECURITY;

-- Reading: the rows of the items the caller may reach.
CREATE POLICY metadata_read ON platform.item_metadata FOR SELECT TO platform_users
  USING (platform.can_read_metadata(scope, schema_name, table_name, column_name));

-- Writing: the rows of the items the caller owns. The check runs on the new row too, so a
-- row cannot be moved into an item the caller does not own.
CREATE POLICY metadata_write ON platform.item_metadata FOR ALL TO platform_users
  USING (platform.owns_metadata(scope, schema_name, table_name, column_name))
  WITH CHECK (platform.owns_metadata(scope, schema_name, table_name, column_name));

-- Open to every member of platform_users; the policies decide which rows each reaches.
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.item_metadata TO platform_users;

-- The helpers answer about the caller, so they are read with the caller's own rights and are
-- given to the same people.
REVOKE ALL ON FUNCTION platform.metadata_relation(text,text), platform.metadata_item(text,text,text),
  platform.has_item_right(oid), platform.can_read_column(text,text,text),
  platform.can_read_metadata(text,text,text,text), platform.owns_metadata(text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.metadata_relation(text,text), platform.metadata_item(text,text,text),
  platform.has_item_right(oid), platform.can_read_column(text,text,text),
  platform.can_read_metadata(text,text,text,text), platform.owns_metadata(text,text,text,text) TO platform_users;

-- ---------------------------------------------------------------------------------------
-- The catalog and the access rules, as the caller may see them.
--
-- These are the questions the interface asks, written once, so that psql gets the answers
-- the interface gets: SELECT * FROM platform.catalog_tables. Each view reads PostgreSQL's
-- catalogs with the caller's own rights (security_invoker) and asks PostgreSQL's own
-- privilege functions, which answer for the caller. Nothing here decides a right.
--
-- A schema listed here is one the caller may use that is not PostgreSQL's own; the platform's
-- schema is the one system schema, whose model nobody may change.

CREATE VIEW platform.session WITH (security_invoker) AS
  SELECT session_user::text AS username, current_user::text AS effective_role,
         current_database()::text AS database,
         (SELECT version FROM platform.installation) AS platform_version,
         current_setting('server_version') AS server_version,
         has_database_privilege(current_database(), 'CREATE') AS can_create_schema,
         platform.is_operator() AS is_operator,
         -- The roles the caller may admit members to: held WITH ADMIN OPTION, PostgreSQL says.
         ARRAY(SELECT r.name FROM platform.visible_roles() r
                WHERE pg_has_role(r.name::name, 'MEMBER WITH ADMIN OPTION') ORDER BY 1) AS admits;

CREATE VIEW platform.catalog_schemas WITH (security_invoker) AS
  SELECT n.oid, n.nspname::text AS name, pg_get_userbyid(n.nspowner)::text AS owner,
         CASE WHEN n.nspname = 'platform' THEN 'system' ELSE 'user' END AS kind,
         has_schema_privilege(n.oid, 'CREATE') AND n.nspname <> 'platform' AS can_create,
         pg_has_role(current_user, n.nspowner, 'USAGE') AND n.nspname <> 'platform' AS can_alter,
         -- Who may grant is PostgreSQL's answer: the owner, or a holder WITH GRANT OPTION.
         has_schema_privilege(n.oid, 'USAGE WITH GRANT OPTION, CREATE WITH GRANT OPTION')
           AND n.nspname <> 'platform' AS can_grant
    FROM pg_namespace n
   WHERE n.nspname NOT LIKE 'pg\_%' ESCAPE '\' AND n.nspname NOT IN ('information_schema','public')
     AND has_schema_privilege(n.oid, 'USAGE');

-- The relations of those schemas: the platform's own views of the catalog are not tables, nor are the guard's notes.
CREATE VIEW platform.catalog_relations WITH (security_invoker) AS
  SELECT c.oid, s.name AS schema, c.relname::text AS name, s.kind = 'system' AS system, c.relkind,
         c.relrowsecurity, c.relforcerowsecurity, c.relowner
    FROM pg_class c JOIN platform.catalog_schemas s ON s.oid = c.relnamespace
   WHERE c.relkind IN ('r','p','v','m')
     AND NOT (s.kind = 'system' AND c.relname ~ '^(catalog|access|guard)_|^session$');

CREATE VIEW platform.catalog_tables WITH (security_invoker) AS
  SELECT c.schema, c.name, c.relkind::text AS kind, c.relrowsecurity AS rls,
         c.relforcerowsecurity AS force_rls, pg_get_userbyid(c.relowner)::text AS owner,
         obj_description(c.oid, 'pg_class') AS comment, c.system,
         has_table_privilege(c.oid, 'SELECT') AS can_select,
         has_table_privilege(c.oid, 'INSERT') AS can_insert,
         has_table_privilege(c.oid, 'UPDATE') AS can_update,
         has_table_privilege(c.oid, 'DELETE') AS can_delete,
         has_table_privilege(c.oid, 'TRUNCATE') AND NOT c.system AS can_truncate,
         pg_has_role(current_user, c.relowner, 'USAGE') AND NOT c.system AS can_alter,
         NOT c.system AND (
           has_table_privilege(c.oid, 'SELECT WITH GRANT OPTION, INSERT WITH GRANT OPTION, UPDATE WITH GRANT OPTION, DELETE WITH GRANT OPTION, TRUNCATE WITH GRANT OPTION, REFERENCES WITH GRANT OPTION, TRIGGER WITH GRANT OPTION')
           OR has_any_column_privilege(c.oid, 'SELECT WITH GRANT OPTION, INSERT WITH GRANT OPTION, UPDATE WITH GRANT OPTION, REFERENCES WITH GRANT OPTION')) AS can_grant
    FROM platform.catalog_relations c
   WHERE has_any_column_privilege(c.oid, 'SELECT,INSERT,UPDATE')
      OR has_table_privilege(c.oid, 'DELETE,TRUNCATE')
      OR pg_has_role(current_user, c.relowner, 'USAGE');

CREATE VIEW platform.catalog_columns WITH (security_invoker) AS
  SELECT c.schema, c.name AS "table", a.attname::text AS name, a.attnum::int AS position,
         format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS required,
         pg_get_expr(d.adbin, d.adrelid) AS "default", col_description(c.oid, a.attnum) AS comment,
         a.attgenerated::text AS generated, a.attidentity::text AS identity,
         has_column_privilege(c.oid, a.attnum, 'SELECT') AS can_select,
         has_column_privilege(c.oid, a.attnum, 'INSERT') AS can_insert,
         has_column_privilege(c.oid, a.attnum, 'UPDATE') AS can_update
    FROM platform.catalog_relations c
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum;

-- Every constraint, as PostgreSQL defines it. A foreign key says where it points; a key over
-- one column also says which column of the target it points at, which is what a relation is.
CREATE VIEW platform.catalog_constraints WITH (security_invoker) AS
  SELECT c.schema, c.name AS "table", con.conname::text AS name, con.contype::text AS type,
         pg_get_constraintdef(con.oid) AS definition,
         ARRAY(SELECT a.attname::text FROM unnest(con.conkey) WITH ORDINALITY k(attnum, i)
                 JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
                ORDER BY k.i) AS columns,
         rn.nspname::text AS target_schema, rc.relname::text AS target_table,
         (SELECT a.attname::text FROM pg_attribute a
           WHERE a.attrelid = con.confrelid AND a.attnum = con.confkey[1]) AS target_column,
         CASE WHEN con.contype = 'f' THEN con.confdeltype::text END AS on_delete,
         CASE WHEN con.contype = 'f' THEN con.confupdtype::text END AS on_update,
         con.convalidated AS validated, con.condeferrable AS deferrable
    FROM pg_constraint con
    JOIN platform.catalog_relations c ON c.oid = con.conrelid
    LEFT JOIN pg_class rc ON con.contype = 'f' AND rc.oid = con.confrelid
    LEFT JOIN pg_namespace rn ON rn.oid = rc.relnamespace
   WHERE con.contype IN ('c','u','p','f','x');

CREATE VIEW platform.catalog_indexes WITH (security_invoker) AS
  SELECT c.schema, c.name AS "table", ic.relname::text AS name,
         ARRAY(SELECT a.attname::text FROM unnest(x.indkey::int2[]) WITH ORDINALITY k(attnum, i)
                 JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
                ORDER BY k.i) AS columns,
         x.indisunique AS "unique", x.indisprimary AS "primary"
    FROM pg_index x
    JOIN platform.catalog_relations c ON c.oid = x.indrelid
    JOIN pg_class ic ON ic.oid = x.indexrelid
   WHERE x.indisvalid AND x.indpred IS NULL;

-- Every index of those relations as PostgreSQL would write it again: partial ones, ones over
-- expressions, of any method. catalog_indexes above holds the ones a relation can lean on.
CREATE VIEW platform.catalog_index_definitions WITH (security_invoker) AS
  SELECT c.schema, c.name AS "table", ic.relname::text AS name,
         pg_get_indexdef(x.indexrelid) AS definition, x.indisunique AS "unique",
         x.indisprimary AS "primary", x.indisvalid AS valid,
         EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conindid = x.indexrelid
                    AND k.conrelid = x.indrelid) AS backs_constraint
    FROM pg_index x
    JOIN platform.catalog_relations c ON c.oid = x.indrelid
    JOIN pg_class ic ON ic.oid = x.indexrelid;

-- The types a column may be given beside PostgreSQL's own: enums, domains, ranges, composites.
CREATE VIEW platform.catalog_types WITH (security_invoker) AS
  SELECT n.nspname::text AS schema, t.typname::text AS bare, n.nspname || '.' || t.typname AS name,
         t.typtype::text AS kind, format_type(t.oid, NULL) AS label
    FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
   WHERE t.typtype IN ('b','c','d','e','r','m') AND t.typrelid = 0
     AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
     AND has_schema_privilege(n.oid, 'USAGE')
     AND NOT EXISTS (SELECT 1 FROM pg_type e WHERE e.oid = t.typelem AND e.typarray = t.oid);

-- Every grant, from the ACLs themselves: on a schema, on its tables, on their columns.
CREATE VIEW platform.access_grants WITH (security_invoker) AS
  SELECT x.schema, x."table", x."column",
         CASE WHEN g.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(g.grantee)::text END AS grantee,
         g.privilege_type::text AS privilege, pg_get_userbyid(g.grantor)::text AS grantor,
         g.is_grantable AS grantable
    FROM (
      SELECT s.name AS schema, NULL::text AS "table", NULL::text AS "column",
             coalesce(n.nspacl, acldefault('n', n.nspowner)) AS acl
        FROM platform.catalog_schemas s JOIN pg_namespace n ON n.oid = s.oid
      UNION ALL
      SELECT c.schema, c.name, NULL, coalesce(k.relacl, acldefault('r', k.relowner))
        FROM platform.catalog_relations c JOIN pg_class k ON k.oid = c.oid
      UNION ALL
      SELECT c.schema, c.name, a.attname::text, a.attacl
        FROM platform.catalog_relations c
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
       WHERE a.attacl IS NOT NULL
    ) x, LATERAL aclexplode(x.acl) g;

-- Row policies, and whether each applies to the caller: by name, through a group, or as PUBLIC.
CREATE VIEW platform.access_policies WITH (security_invoker) AS
  SELECT schemaname::text AS schema, tablename::text AS "table", policyname::text AS name,
         permissive, roles::text[] AS roles, cmd AS command, qual AS "using", with_check AS "check",
         EXISTS (SELECT 1 FROM unnest(roles) r
                  WHERE r = 'public'
                     OR pg_has_role(session_user, to_regrole(quote_ident(r::text))::oid, 'MEMBER')) AS applies
    FROM pg_policies;

-- The rights a role's new objects start with in a schema, or everywhere: ALTER DEFAULT
-- PRIVILEGES. Each row is one privilege a future table, sequence, function or type is born with.
CREATE VIEW platform.access_default_grants WITH (security_invoker) AS
  SELECT pg_get_userbyid(d.defaclrole)::text AS for_role, n.nspname::text AS schema,
         CASE d.defaclobjtype WHEN 'r' THEN 'TABLES' WHEN 'S' THEN 'SEQUENCES'
           WHEN 'f' THEN 'FUNCTIONS' WHEN 'T' THEN 'TYPES' WHEN 'n' THEN 'SCHEMAS' END AS objects,
         CASE WHEN g.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(g.grantee)::text END AS grantee,
         g.privilege_type::text AS privilege, g.is_grantable AS grantable
    FROM pg_default_acl d
    LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace,
         LATERAL aclexplode(d.defaclacl) g
   WHERE n.oid IS NULL OR has_schema_privilege(n.oid, 'USAGE');

-- What a schema holds beside its tables: sequences, functions and procedures, types.
-- The platform's own schema is left out, as it is from the tables.
CREATE VIEW platform.catalog_routines WITH (security_invoker) AS
  SELECT s.name AS schema, p.proname::text AS name, p.oid::regprocedure::text AS signature,
         pg_get_function_identity_arguments(p.oid) AS arguments,
         CASE p.prokind WHEN 'p' THEN NULL ELSE pg_get_function_result(p.oid) END AS returns,
         CASE p.prokind WHEN 'f' THEN 'function' WHEN 'p' THEN 'procedure'
           WHEN 'a' THEN 'aggregate' WHEN 'w' THEN 'window' END AS kind,
         l.lanname::text AS language, p.prosecdef AS security_definer,
         CASE p.provolatile WHEN 'i' THEN 'immutable' WHEN 's' THEN 'stable' ELSE 'volatile' END AS volatility,
         pg_get_userbyid(p.proowner)::text AS owner, obj_description(p.oid, 'pg_proc') AS comment,
         CASE WHEN l.lanname IN ('sql','plpgsql') AND p.prokind IN ('f','p') THEN p.prosrc END AS body,
         EXISTS (SELECT 1 FROM pg_depend e WHERE e.objid = p.oid AND e.deptype = 'e') AS from_extension,
         has_function_privilege(p.oid, 'EXECUTE') AS can_execute,
         pg_has_role(current_user, p.proowner, 'USAGE') AS can_alter
    FROM pg_proc p
    JOIN platform.catalog_schemas s ON s.oid = p.pronamespace AND s.kind = 'user'
    JOIN pg_language l ON l.oid = p.prolang;

CREATE VIEW platform.catalog_sequences WITH (security_invoker) AS
  SELECT s.name AS schema, c.relname::text AS name, format_type(q.seqtypid, NULL) AS type,
         q.seqstart AS start, q.seqincrement AS increment, q.seqmin AS minimum, q.seqmax AS maximum,
         q.seqcycle AS cycle, pg_get_userbyid(c.relowner)::text AS owner,
         (SELECT dn.nspname || '.' || dc.relname || '.' || a.attname
            FROM pg_depend e JOIN pg_class dc ON dc.oid = e.refobjid
            JOIN pg_namespace dn ON dn.oid = dc.relnamespace
            JOIN pg_attribute a ON a.attrelid = e.refobjid AND a.attnum = e.refobjsubid
           WHERE e.objid = c.oid AND e.classid = 'pg_class'::regclass AND e.deptype IN ('a','i')
           LIMIT 1) AS owned_by,
         has_sequence_privilege(c.oid, 'USAGE') AS can_use,
         pg_has_role(current_user, c.relowner, 'USAGE') AS can_alter
    FROM pg_class c
    JOIN platform.catalog_schemas s ON s.oid = c.relnamespace AND s.kind = 'user'
    JOIN pg_sequence q ON q.seqrelid = c.oid
   WHERE c.relkind = 'S';

-- Types made in a schema: enums with their values, domains with their base and rules,
-- composites with their columns, and ranges.
CREATE VIEW platform.catalog_user_types WITH (security_invoker) AS
  SELECT s.name AS schema, t.typname::text AS name,
         CASE t.typtype WHEN 'e' THEN 'enum' WHEN 'd' THEN 'domain' WHEN 'c' THEN 'composite'
           WHEN 'r' THEN 'range' WHEN 'm' THEN 'multirange' ELSE 'base' END AS kind,
         ARRAY(SELECT e.enumlabel::text FROM pg_enum e WHERE e.enumtypid = t.oid ORDER BY e.enumsortorder) AS "values",
         CASE WHEN t.typtype = 'd' THEN format_type(t.typbasetype, t.typtypmod) END AS base,
         CASE WHEN t.typtype = 'd' THEN t.typnotnull END AS not_null,
         t.typdefault AS "default",
         ARRAY(SELECT pg_get_constraintdef(k.oid) FROM pg_constraint k WHERE k.contypid = t.oid ORDER BY k.conname) AS checks,
         CASE WHEN t.typtype = 'c' THEN (SELECT string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod), ', ' ORDER BY a.attnum)
                                          FROM pg_attribute a WHERE a.attrelid = t.typrelid AND a.attnum > 0 AND NOT a.attisdropped) END AS columns,
         pg_get_userbyid(t.typowner)::text AS owner, obj_description(t.oid, 'pg_type') AS comment,
         has_type_privilege(t.oid, 'USAGE') AS can_use,
         pg_has_role(current_user, t.typowner, 'USAGE') AS can_alter
    FROM pg_type t
    JOIN platform.catalog_schemas s ON s.oid = t.typnamespace AND s.kind = 'user'
   WHERE t.typtype IN ('e','d','c','r','m')
     AND (t.typtype <> 'c' OR (SELECT relkind FROM pg_class WHERE oid = t.typrelid) = 'c');

-- The triggers on a table that are not the platform's own: the guard keeps those.
CREATE VIEW platform.catalog_triggers WITH (security_invoker) AS
  SELECT c.schema, c.name AS "table", t.tgname::text AS name, pg_get_triggerdef(t.oid) AS definition,
         t.tgfoid::regprocedure::text AS function, t.tgenabled <> 'D' AS enabled
    FROM pg_trigger t
    JOIN platform.catalog_relations c ON c.oid = t.tgrelid
   WHERE NOT t.tgisinternal
     AND t.tgfoid NOT IN ('platform.record_change()'::regprocedure, 'platform.stamp()'::regprocedure);

-- What a view is, as PostgreSQL would write it again, and whether it reads as its caller.
CREATE VIEW platform.catalog_views WITH (security_invoker) AS
  SELECT c.schema, c.name, c.relkind::text AS kind, pg_get_viewdef(c.oid) AS definition,
         coalesce((SELECT option_value::boolean FROM pg_options_to_table(k.reloptions)
                    WHERE option_name = 'security_invoker'), false) AS security_invoker,
         c.relkind = 'm' AND k.relispopulated AS populated
    FROM platform.catalog_relations c JOIN pg_class k ON k.oid = c.oid
   WHERE c.relkind IN ('v','m') AND NOT c.system;

-- Extensions: the ones installed, and the ones the server could install.
CREATE VIEW platform.catalog_extensions WITH (security_invoker) AS
  SELECT a.name::text, a.default_version::text AS available, a.installed_version::text AS installed,
         a.comment, n.nspname::text AS schema, x.trusted
    FROM pg_available_extensions a
    LEFT JOIN pg_extension e ON e.extname = a.name
    LEFT JOIN pg_namespace n ON n.oid = e.extnamespace
    LEFT JOIN LATERAL (SELECT bool_or(v.trusted) AS trusted FROM pg_available_extension_versions v
                        WHERE v.name = a.name) x ON true;

-- Grants on what a schema holds beside its tables, from their ACLs.
CREATE VIEW platform.access_object_grants WITH (security_invoker) AS
  SELECT x.schema, x.objects, x.name,
         CASE WHEN g.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(g.grantee)::text END AS grantee,
         g.privilege_type::text AS privilege, g.is_grantable AS grantable
    FROM (
      SELECT s.name AS schema, 'SEQUENCE' AS objects, quote_ident(s.name) || '.' || quote_ident(c.relname) AS name,
             coalesce(c.relacl, acldefault('s', c.relowner)) AS acl
        FROM pg_class c JOIN platform.catalog_schemas s ON s.oid = c.relnamespace AND s.kind = 'user'
       WHERE c.relkind = 'S'
      UNION ALL
      SELECT s.name, CASE p.prokind WHEN 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END, p.oid::regprocedure::text,
             coalesce(p.proacl, acldefault('f', p.proowner))
        FROM pg_proc p JOIN platform.catalog_schemas s ON s.oid = p.pronamespace AND s.kind = 'user'
       WHERE p.prokind IN ('f','p')
      UNION ALL
      SELECT s.name, CASE t.typtype WHEN 'd' THEN 'DOMAIN' ELSE 'TYPE' END, format_type(t.oid, NULL),
             coalesce(t.typacl, acldefault('T', t.typowner))
        FROM pg_type t JOIN platform.catalog_schemas s ON s.oid = t.typnamespace AND s.kind = 'user'
       WHERE t.typtype IN ('e','d','r','m')
          OR (t.typtype = 'c' AND (SELECT relkind FROM pg_class WHERE oid = t.typrelid) = 'c')
    ) x, LATERAL aclexplode(x.acl) g;

-- Grants on the database itself: who may connect, make schemas, make temporary tables.
CREATE VIEW platform.access_database_grants WITH (security_invoker) AS
  SELECT CASE WHEN g.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(g.grantee)::text END AS grantee,
         g.privilege_type::text AS privilege, g.is_grantable AS grantable
    FROM pg_database d, LATERAL aclexplode(coalesce(d.datacl, acldefault('d', d.datdba))) g
   WHERE d.datname = current_database();

-- The sessions on this database, as PostgreSQL shows them to the caller: what another role's
-- session is running is shown only to that role and to members of pg_read_all_stats.
CREATE VIEW platform.catalog_sessions WITH (security_invoker) AS
  SELECT a.pid, a.usename::text AS role, a.application_name AS application, a.state,
         a.backend_start::text AS since, a.xact_start::text AS transaction_since,
         a.query_start::text AS query_since, a.wait_event_type AS waiting_on, a.query,
         pg_blocking_pids(a.pid) AS blocked_by, a.pid = pg_backend_pid() AS this_one
    FROM pg_stat_activity a
   WHERE a.datname = current_database() AND a.backend_type = 'client backend';

-- How large each relation the caller may reach is, how many rows PostgreSQL counts in it, and
-- when it was last vacuumed and analyzed.
CREATE VIEW platform.catalog_table_stats WITH (security_invoker) AS
  SELECT c.schema, c.name, c.relkind::text AS kind, s.n_live_tup AS live_rows, s.n_dead_tup AS dead_rows,
         pg_total_relation_size(c.oid) AS bytes, pg_size_pretty(pg_total_relation_size(c.oid)) AS size,
         greatest(s.last_vacuum, s.last_autovacuum)::text AS vacuumed,
         greatest(s.last_analyze, s.last_autoanalyze)::text AS analyzed,
         s.seq_scan AS scans, s.idx_scan AS index_scans,
         pg_has_role(current_user, c.relowner, 'USAGE') OR has_table_privilege(c.oid, 'MAINTAIN') AS can_maintain
    FROM platform.catalog_relations c
    JOIN pg_stat_all_tables s ON s.relid = c.oid
   WHERE NOT c.system AND (has_any_column_privilege(c.oid, 'SELECT,INSERT,UPDATE')
      OR pg_has_role(current_user, c.relowner, 'USAGE'));

-- The roles worth asking about in a schema: the ones the caller sees and the ones its
-- ACLs name, where each is still a role. PUBLIC is asked about as a role named public.
CREATE FUNCTION platform.roles_in(p_schema text) RETURNS TABLE(name text)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT known.name FROM (
    SELECT r.name FROM platform.visible_roles() r WHERE r.name NOT LIKE 'pg\_%' ESCAPE '\'
    UNION SELECT g.grantee FROM platform.access_grants g
           WHERE g.schema = p_schema AND g.grantee <> 'PUBLIC'
    UNION SELECT 'public') known
   WHERE known.name = 'public' OR to_regrole(quote_ident(known.name)) IS NOT NULL
$$;

-- What each role may do with each table of a schema: PostgreSQL's own answer for that
-- role, so a right held through a group or through PUBLIC counts. A privilege that may be
-- held on columns is all, some or none of them.
CREATE FUNCTION platform.reach(p_schema text, p_role text DEFAULT NULL, p_table text DEFAULT NULL)
RETURNS TABLE(role text, "table" text, usage boolean, "select" text, "insert" text, "update" text,
              "references" text, "delete" boolean, "truncate" boolean, "trigger" boolean)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT w.name, c.name, has_schema_privilege(w.name::name, p_schema, 'USAGE'),
         h.held[1], h.held[2], h.held[3], h.held[4],
         has_table_privilege(w.name::name, c.oid, 'DELETE'),
         has_table_privilege(w.name::name, c.oid, 'TRUNCATE'),
         has_table_privilege(w.name::name, c.oid, 'TRIGGER')
    FROM platform.roles_in(p_schema) w, platform.catalog_relations c,
         LATERAL (SELECT array_agg(CASE
                    WHEN has_table_privilege(w.name::name, c.oid, p) THEN 'all'
                    WHEN has_any_column_privilege(w.name::name, c.oid, p) THEN 'some'
                    ELSE 'none' END ORDER BY i) AS held
                    FROM unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) WITH ORDINALITY x(p, i)) h
   WHERE c.schema = p_schema AND (p_role IS NULL OR w.name = p_role)
     AND (p_table IS NULL OR c.name = p_table)
   ORDER BY 2, 1
$$;

CREATE FUNCTION platform.schema_reach(p_schema text)
RETURNS TABLE(role text, usage boolean, "create" boolean)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT w.name, has_schema_privilege(w.name::name, p_schema, 'USAGE'),
         has_schema_privilege(w.name::name, p_schema, 'CREATE')
    FROM platform.roles_in(p_schema) w ORDER BY 1
$$;

GRANT SELECT ON platform.session, platform.catalog_schemas, platform.catalog_relations,
  platform.catalog_tables, platform.catalog_columns, platform.catalog_constraints,
  platform.catalog_indexes, platform.catalog_index_definitions, platform.catalog_types, platform.access_grants,
  platform.access_policies, platform.access_default_grants, platform.catalog_routines,
  platform.catalog_sequences, platform.catalog_user_types, platform.catalog_triggers,
  platform.catalog_views, platform.catalog_extensions, platform.access_object_grants,
  platform.access_database_grants, platform.catalog_sessions, platform.catalog_table_stats
  TO platform_users;
GRANT EXECUTE ON FUNCTION platform.roles_in(text), platform.reach(text, text, text),
  platform.schema_reach(text) TO platform_users;

RESET ROLE;

-- Only these functions read the catalogs for a caller. Each one answers about the caller alone,
-- so anyone who may connect the database may ask; the schema itself stays out of PUBLIC's reach.
GRANT EXECUTE ON FUNCTION platform.is_operator(), platform.visible_roles(), platform.visible_memberships(),
  platform.role_attributes(text), platform.is_member(text, text), platform.has_admin_option(text)
  TO PUBLIC, platform_users, platform_admins;
GRANT USAGE ON SCHEMA platform TO platform_admins;
