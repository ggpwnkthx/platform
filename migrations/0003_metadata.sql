-- PostgreSQL 18+. Run after 0002_harden_catalogs.sql, once, as the database administrator.
-- Installs Platform 2.1.0 in a database that already holds 2.0.1.
--
-- Metadata describes an item rather than holding its records: what a workspace is for,
-- how a collection should be read, who answers for it. It is stored here, in the
-- platform schema, because it describes every workspace at once.
--
-- Its access rules are PostgreSQL's own, asked of PostgreSQL's own privilege
-- functions, so a grant, a revoke or a membership change takes effect on the next
-- statement, as everywhere else in the platform:
--
--   * a reader sees the metadata of the items they may reach: USAGE on the schema
--     for a workspace, any right on the table for a collection;
--   * only the owner of an item may change its metadata: the schema owner for a
--     workspace, the table owner for a collection.
--
-- Both rules are row security policies on the table below. Nothing in the
-- application decides them, and a row the caller may not reach is not merely hidden
-- from the console: PostgreSQL does not return it at all.

-- SET ROLE, not SET LOCAL: the installer may run this file through psql, where each
-- statement is its own transaction and a local setting would not survive it.
SET ROLE platform_core;

CREATE TABLE platform.item_metadata (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('workspace','collection')),
  schema_name text NOT NULL,
  table_name text,
  key text NOT NULL CHECK (octet_length(key) BETWEEN 1 AND 128),
  value jsonb NOT NULL DEFAULT 'null'::jsonb CHECK (octet_length(value::text) <= 65536),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  created_by text NOT NULL DEFAULT session_user,
  updated_by text NOT NULL DEFAULT session_user,
  version bigint NOT NULL DEFAULT 1,
  -- A workspace names a schema; a collection names a table in one. The shape is
  -- checked here, so no row can name an item that does not exist in one form.
  CONSTRAINT item_metadata_target_check CHECK (
    (scope = 'workspace' AND table_name IS NULL)
    OR (scope = 'collection' AND table_name IS NOT NULL)
  )
);
-- One row per key per item. The table name is empty for a workspace, so the keys of
-- a workspace are unique as well as the keys of a collection.
CREATE UNIQUE INDEX item_metadata_key ON platform.item_metadata
  (scope, schema_name, coalesce(table_name, ''), key);
-- The same stamp every collection carries: who wrote it, when, and which version.
CREATE TRIGGER platform_stamp BEFORE INSERT OR UPDATE ON platform.item_metadata
  FOR EACH ROW EXECUTE FUNCTION platform.stamp();
-- New rows are hidden from everyone but their owner, and a new table has no policy:
-- a grant alone never makes metadata visible.
ALTER TABLE platform.item_metadata ENABLE ROW LEVEL SECURITY;

-- The object a metadata row names: the schema of a workspace, the table of a
-- collection. The names are the ones the row carries, and they are looked up in
-- the catalogs rather than resolved: resolving a qualified name asks PostgreSQL
-- for permission on the schema, and a reader who may not use a workspace must
-- still be able to learn that they may not read its metadata.
CREATE FUNCTION platform.metadata_item(p_scope text, p_schema text, p_table text)
RETURNS oid LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE p_scope
    WHEN 'workspace' THEN
      (SELECT n.oid FROM pg_namespace n WHERE n.nspname = p_schema)
    WHEN 'collection' THEN
      CASE WHEN p_table IS NULL THEN NULL ELSE (
        SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = p_schema AND c.relname = p_table
           AND c.relkind IN ('r','p','v','m','f')
      ) END
    ELSE NULL
  END
$$;

-- Any right on a collection: on the table, or on one of its columns. A reader who
-- holds a single column may read the collection's metadata.
CREATE FUNCTION platform.has_item_right(p_oid oid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT p_oid IS NOT NULL AND (
    has_table_privilege(p_oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES')
    OR has_any_column_privilege(p_oid, 'SELECT,INSERT,UPDATE,REFERENCES')
  )
$$;

-- May the caller read the metadata of this item? A workspace is read by whoever
-- may use it; a collection by whoever holds any right on it.
CREATE FUNCTION platform.can_read_metadata(p_scope text, p_schema text, p_table text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE p_scope
    WHEN 'workspace' THEN coalesce(
      has_schema_privilege(platform.metadata_item(p_scope, p_schema, p_table), 'USAGE'), false)
    WHEN 'collection' THEN
      platform.has_item_right(platform.metadata_item(p_scope, p_schema, p_table))
    ELSE false
  END
$$;

-- Does the caller own the item? The schema owner owns the workspace; the table
-- owner owns the collection. A group that owns the workspace owns it for its
-- members, which is how a model is delegated without handing over the database.
CREATE FUNCTION platform.owns_metadata(p_scope text, p_schema text, p_table text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE p_scope
    WHEN 'workspace' THEN coalesce(pg_has_role(current_user,
      (SELECT nspowner FROM pg_namespace WHERE nspname = p_schema), 'USAGE'), false)
    WHEN 'collection' THEN coalesce(pg_has_role(current_user,
      (SELECT relowner FROM pg_class
        WHERE oid = platform.metadata_item(p_scope, p_schema, p_table)), 'USAGE'), false)
    ELSE false
  END
$$;

-- Reading: the rows of the items the caller may reach.
CREATE POLICY metadata_read ON platform.item_metadata FOR SELECT TO platform_users
  USING (platform.can_read_metadata(scope, schema_name, table_name));

-- Writing: the rows of the items the caller owns. The check runs on the new row
-- too, so a row cannot be moved into an item the caller does not own.
CREATE POLICY metadata_write ON platform.item_metadata FOR ALL TO platform_users
  USING (platform.owns_metadata(scope, schema_name, table_name))
  WITH CHECK (platform.owns_metadata(scope, schema_name, table_name));

-- The table itself is open to every member of platform_users, and the policies
-- above decide which rows each of them reaches.
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.item_metadata TO platform_users;
-- The helpers answer about the caller, so they are read with the caller's own
-- rights and are given to the same people.
REVOKE ALL ON FUNCTION platform.metadata_item(text,text,text), platform.has_item_right(oid),
  platform.can_read_metadata(text,text,text), platform.owns_metadata(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.metadata_item(text,text,text), platform.has_item_right(oid),
  platform.can_read_metadata(text,text,text), platform.owns_metadata(text,text,text) TO platform_users;

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
UPDATE platform.installation SET version = '2.1.0';
ALTER TABLE platform.installation ADD CONSTRAINT installation_version_check CHECK (version = '2.1.0');

RESET ROLE;
