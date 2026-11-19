-- PostgreSQL 18+. Run after 0003_metadata.sql, once, as the database administrator.
-- Installs Platform 2.2.0 in a database that already holds 2.1.0.
--
-- A field may carry metadata too, and it is secured by the field's own rights. The rules are
-- the ones a collection already follows, asked of PostgreSQL's own privilege functions:
--
--   * a reader sees the metadata of the fields they may reach: any right on the column,
--     whether the right is on the table or on the column itself;
--   * only the owner of the collection may change a field's metadata: the table owner, or a
--     group that owns the table.
--
-- A field is a column of a collection, so a metadata row names a table and a column. A row
-- that names a column that has been dropped is unreachable, as a row that names a dropped
-- collection is: PostgreSQL does not return it at all. The metadata of a field is as private
-- as the field: a reader who may not read a column never learns what it is called.

-- SET ROLE, not SET LOCAL: the installer may run this file through psql, where each
-- statement is its own transaction and a local setting would not survive it.
SET ROLE platform_core;

-- A field names a column: the table gains the column's name.
ALTER TABLE platform.item_metadata ADD COLUMN column_name text;

-- The shape of a row now names three things: a workspace, a collection, or a field of one.
-- The constraints are dropped by the names the catalog holds, so the file does not depend on
-- how PostgreSQL named them.
DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'platform.item_metadata'::regclass AND contype = 'c'
       AND conname IN ('item_metadata_scope_check', 'item_metadata_target_check')
  LOOP
    EXECUTE format('ALTER TABLE platform.item_metadata DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;
ALTER TABLE platform.item_metadata ADD CONSTRAINT item_metadata_scope_check
  CHECK (scope IN ('workspace','collection','field'));
ALTER TABLE platform.item_metadata ADD CONSTRAINT item_metadata_target_check CHECK (
  (scope = 'workspace' AND table_name IS NULL AND column_name IS NULL)
  OR (scope = 'collection' AND table_name IS NOT NULL AND column_name IS NULL)
  OR (scope = 'field' AND table_name IS NOT NULL AND column_name IS NOT NULL)
);

-- One row per key per item. A field's keys are filed under its collection and its column, so
-- two fields of one collection may carry the same key.
DROP INDEX platform.item_metadata_key;
CREATE UNIQUE INDEX item_metadata_key ON platform.item_metadata
  (scope, schema_name, coalesce(table_name, ''), coalesce(column_name, ''), key);

-- The policies ask the helpers below, so they go first: a function a policy depends on
-- cannot be dropped while the policy is there.
DROP POLICY metadata_read ON platform.item_metadata;
DROP POLICY metadata_write ON platform.item_metadata;
DROP FUNCTION platform.can_read_metadata(text,text,text);
DROP FUNCTION platform.owns_metadata(text,text,text);
DROP FUNCTION platform.metadata_item(text,text,text);

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

-- Reading: the rows of the items the caller may reach.
CREATE POLICY metadata_read ON platform.item_metadata FOR SELECT TO platform_users
  USING (platform.can_read_metadata(scope, schema_name, table_name, column_name));

-- Writing: the rows of the items the caller owns. The check runs on the new row too, so a
-- row cannot be moved into an item the caller does not own.
CREATE POLICY metadata_write ON platform.item_metadata FOR ALL TO platform_users
  USING (platform.owns_metadata(scope, schema_name, table_name, column_name))
  WITH CHECK (platform.owns_metadata(scope, schema_name, table_name, column_name));

-- The table itself is open to every member of platform_users, and the policies
-- above decide which rows each of them reaches.
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.item_metadata TO platform_users;
-- The helpers answer about the caller, so they are read with the caller's own
-- rights and are given to the same people.
REVOKE ALL ON FUNCTION platform.metadata_relation(text,text), platform.metadata_item(text,text,text),
  platform.can_read_field(text,text,text), platform.can_read_metadata(text,text,text,text),
  platform.owns_metadata(text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.metadata_relation(text,text), platform.metadata_item(text,text,text),
  platform.can_read_field(text,text,text), platform.can_read_metadata(text,text,text,text),
  platform.owns_metadata(text,text,text,text) TO platform_users;

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
UPDATE platform.installation SET version = '2.2.0';
ALTER TABLE platform.installation ADD CONSTRAINT installation_version_check CHECK (version = '2.2.0');

RESET ROLE;
