-- PostgreSQL 18+. Run once, as the database administrator, in a NEW database.
-- Installs Platform 2.3.0 in a dedicated empty database.
--
-- Everything the platform keeps in a database is made here, in the order it depends on
-- itself: the reserved roles; the platform's own schema, with its marker, its revisions and
-- the functions that make a collection; the answers it gives about the caller's own roles;
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
  version text PRIMARY KEY CONSTRAINT installation_version_check CHECK (version = '2.3.0'),
  installed_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO platform.installation VALUES ('2.3.0', now());
GRANT SELECT ON platform.installation TO platform_users;

CREATE TABLE platform.activity (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT clock_timestamp(),
  transaction_id bigint NOT NULL DEFAULT txid_current(),
  actor text NOT NULL,
  actor_oid oid NOT NULL,
  workspace_owner oid NOT NULL,
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
-- every column of the collection, whatever its column grants say, so they are read through
-- platform.revisions, below, and from this table by its owner's members alone.
GRANT SELECT (id,at,transaction_id,actor,actor_oid,workspace_owner,relation,schema_name,table_name,operation)
  ON platform.activity TO platform_users;
-- Only workspace owners (or members inheriting the owner's rights) see revisions.
-- Letting all actors read their own entries would leak columns hidden by column GRANTs.
-- The policy runs as the reader, so it asks PostgreSQL and reads no catalog: pg_roles may be
-- hidden from the reader (`cli harden`). An owner that has been dropped is nobody's role.
CREATE POLICY owner_reads ON platform.activity FOR SELECT TO platform_users
  USING (pg_has_role(session_user,workspace_owner,'USAGE'));

-- A logged row, as the reader may read it: the columns they hold SELECT on, in the table the
-- row was in, and no others. Owning the workspace is not a right on a column: a field that is
-- withheld from a reader in the collection is withheld from them in its history too. The
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
-- reads the log with its owner's rights, so it carries the log's own rule: a workspace's
-- owners, asked of PostgreSQL as the policy above asks. A barrier, so that nothing the
-- reader writes into a query is run on a row before that rule has passed it.
CREATE VIEW platform.revisions WITH (security_barrier) AS
  SELECT a.id, a.at, a.transaction_id, a.actor, a.actor_oid, a.workspace_owner, a.relation,
         a.schema_name, a.table_name, a.operation,
         platform.readable_row(a.relation, a.before_row) AS before_row,
         platform.readable_row(a.relation, a.after_row) AS after_row
    FROM platform.activity a
   WHERE pg_has_role(session_user, a.workspace_owner, 'USAGE');
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
  INSERT INTO platform.activity(actor,actor_oid,workspace_owner,relation,schema_name,table_name,operation,before_row,after_row)
  VALUES (session_user,(SELECT oid FROM pg_roles WHERE rolname=session_user),owner_oid,TG_RELID,
          TG_TABLE_SCHEMA,TG_TABLE_NAME,TG_OP,
          CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END,
          CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END);
  RETURN NULL;
END $$;

-- All modeling executes with the caller's privileges. No privileged schema connection exists.
CREATE FUNCTION platform.create_collection(schema_name text, table_name text) RETURNS void
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
GRANT EXECUTE ON FUNCTION platform.stamp(),platform.record_change(),platform.create_collection(text,text)
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


-- ---------------------------------------------------------------------------------------
-- Metadata.
--
-- Metadata describes an item rather than holding its records: what a workspace is for, how
-- a collection should be read, who answers for it, what a field holds. It is kept in one
-- collection of the platform's own — `platform.item_metadata` — because it describes every
-- workspace at once: a row names the workspace it is about, and the collection or the field
-- in it.
--
-- Its access rules are PostgreSQL's own, asked of PostgreSQL's own privilege functions, so a
-- grant, a revoke or a membership change takes effect on the next statement:
--
--   * a reader sees the metadata of the items they may reach: a workspace they may use, a
--     collection they hold a right on, a field they hold a right on;
--   * only the owner of an item may change its metadata: the schema's owner for the
--     workspace, the table's owner for a collection and its fields.
--
-- Both rules are row security policies on the collection. Nothing in the application
-- decides them, and a row the caller may not reach is not merely hidden: PostgreSQL does
-- not return it at all. A row that names a workspace, a collection or a column that has been
-- dropped is unreachable in the same way, and the metadata of a field is as private as the
-- field: a reader who may not read a column never learns what it is called.
--
-- Row security is forced on the collection, so its owner is held to the same rules as
-- everyone else: a member of platform_core reads and writes the metadata of the items they
-- may reach, and no more. The collection carries no audit trigger — a revision is read by a
-- workspace's owners, and the metadata of a field is not theirs to read by owning the
-- workspace — so metadata is not in the activity log; its rows carry their own created_by,
-- updated_by and version.
--
-- A row names its item by name, so a workspace, a collection or a field that is renamed
-- leaves its metadata behind, as unreachable as that of an item that was dropped: the old
-- name owns nothing, so nobody the policies bind can carry the rows across.

-- Any right on a collection: on the table, or on one of its columns. A reader who
-- holds a single column may read the collection's metadata.
CREATE FUNCTION platform.has_item_right(p_oid oid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT p_oid IS NOT NULL AND (
    has_table_privilege(p_oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES')
    OR has_any_column_privilege(p_oid, 'SELECT,INSERT,UPDATE,REFERENCES')
  )
$$;

-- The relation a collection is, and the relation a field belongs to: the table that holds the
-- column. The names are the ones the row carries, and they are looked up in the catalogs
-- rather than resolved: resolving a qualified name asks PostgreSQL for permission on the
-- schema, and a reader who may not use a workspace must still be able to learn that they may
-- not read its metadata.
CREATE FUNCTION platform.metadata_relation(p_schema text, p_table text)
RETURNS oid LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = p_schema AND c.relname = p_table
     AND c.relkind IN ('r','p','v','m','f')
$$;

-- The object a metadata row names: the schema of a workspace, the table of a collection, the
-- table a field belongs to.
CREATE FUNCTION platform.metadata_item(p_scope text, p_schema text, p_table text)
RETURNS oid LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE p_scope
    WHEN 'workspace' THEN
      (SELECT n.oid FROM pg_namespace n WHERE n.nspname = p_schema)
    WHEN 'collection' THEN
      platform.metadata_relation(p_schema, p_table)
    WHEN 'field' THEN
      platform.metadata_relation(p_schema, p_table)
    ELSE NULL
  END
$$;

-- May the caller read this field? A field is reached by whoever holds a right on its column:
-- the rule the collections already follow, asked of the column itself. A column that is gone
-- is reached by nobody.
CREATE FUNCTION platform.can_read_field(p_schema text, p_table text, p_column text)
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

-- May the caller read the metadata of this item? A workspace is read by whoever may use it;
-- a collection by whoever holds any right on it; a field by whoever holds any right on its
-- column.
CREATE FUNCTION platform.can_read_metadata(
  p_scope text, p_schema text, p_table text, p_column text
) RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE p_scope
    WHEN 'workspace' THEN coalesce(
      has_schema_privilege(platform.metadata_item(p_scope, p_schema, p_table), 'USAGE'), false)
    WHEN 'collection' THEN
      platform.has_item_right(platform.metadata_item(p_scope, p_schema, p_table))
    WHEN 'field' THEN
      platform.can_read_field(p_schema, p_table, p_column)
    ELSE false
  END
$$;

-- Does the caller own the item? The schema owner owns the workspace; the table owner owns the
-- collection and every field in it. A group that owns the collection owns it for its members,
-- which is how a model is delegated without handing over the database.
CREATE FUNCTION platform.owns_metadata(
  p_scope text, p_schema text, p_table text, p_column text
) RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE p_scope
    WHEN 'workspace' THEN coalesce(pg_has_role(current_user,
      (SELECT nspowner FROM pg_namespace WHERE nspname = p_schema), 'USAGE'), false)
    WHEN 'collection' THEN coalesce(pg_has_role(current_user,
      (SELECT relowner FROM pg_class
        WHERE oid = platform.metadata_item(p_scope, p_schema, p_table)), 'USAGE'), false)
    WHEN 'field' THEN coalesce(pg_has_role(current_user,
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
  CONSTRAINT item_metadata_scope_check CHECK (scope IN ('workspace','collection','field')),
  CONSTRAINT item_metadata_schema_check CHECK (octet_length(schema_name) BETWEEN 1 AND 63),
  CONSTRAINT item_metadata_key_check CHECK (octet_length(key) BETWEEN 1 AND 128),
  CONSTRAINT item_metadata_value_check CHECK (octet_length(value::text) <= 65536),
  -- A workspace names a schema; a collection names a table in one; a field names a column of
  -- one. The shape is checked here, so no row can name an item in more than one form.
  CONSTRAINT item_metadata_target_check CHECK (
    (scope = 'workspace' AND table_name IS NULL AND column_name IS NULL)
    OR (scope = 'collection' AND table_name IS NOT NULL AND column_name IS NULL)
    OR (scope = 'field' AND table_name IS NOT NULL AND column_name IS NOT NULL))
);
-- One row per key per item: the collection's one rule of its own. The names are empty where
-- an item has none, so the keys of a workspace are unique as well as the keys of a field.
CREATE UNIQUE INDEX item_metadata_key ON platform.item_metadata
  (scope, schema_name, coalesce(table_name, ''), coalesce(column_name, ''), key);
-- The metadata of one workspace, and of one collection in it, is read together.
CREATE INDEX item_metadata_item ON platform.item_metadata (schema_name, table_name);
COMMENT ON TABLE platform.item_metadata IS
  'What every workspace, its collections and their fields are: one row for each key of each item.';
-- The same stamp every collection carries: who wrote it, when, and which version.
CREATE TRIGGER platform_stamp BEFORE INSERT OR UPDATE ON platform.item_metadata
  FOR EACH ROW EXECUTE FUNCTION platform.stamp();
-- Forced: the owner of the collection reads and writes by the same rules as everyone else.
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
  platform.has_item_right(oid), platform.can_read_field(text,text,text),
  platform.can_read_metadata(text,text,text,text), platform.owns_metadata(text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.metadata_relation(text,text), platform.metadata_item(text,text,text),
  platform.has_item_right(oid), platform.can_read_field(text,text,text),
  platform.can_read_metadata(text,text,text,text), platform.owns_metadata(text,text,text,text) TO platform_users;

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
