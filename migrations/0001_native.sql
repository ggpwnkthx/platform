-- PostgreSQL 18+. Run once, as the database administrator, in a NEW database.
-- Installs Platform 2.0.0 in a dedicated empty database.
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
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('platform_core','platform_users')
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

CREATE TABLE platform.installation (
  version text PRIMARY KEY CHECK (version='2.0.0'),
  installed_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO platform.installation VALUES ('2.0.0',now());
GRANT SELECT ON platform.installation TO platform_users;

CREATE TABLE platform.activity (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT clock_timestamp(),
  transaction_id bigint NOT NULL DEFAULT txid_current(),
  actor text NOT NULL,
  actor_oid oid NOT NULL,
  workspace_owner oid NOT NULL,
  schema_name text NOT NULL,
  table_name text NOT NULL,
  operation text NOT NULL,
  before_row jsonb,
  after_row jsonb
);
CREATE INDEX ON platform.activity(schema_name,table_name,at);
ALTER TABLE platform.activity ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON platform.activity TO platform_users;
-- Only workspace owners (or members inheriting the owner's rights) see full revisions.
-- Letting all actors read their own entries would leak columns hidden by column GRANTs.
CREATE POLICY owner_reads ON platform.activity FOR SELECT TO platform_users
  USING (CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE oid=workspace_owner)
    THEN pg_has_role(session_user,workspace_owner,'USAGE') ELSE false END);

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
  INSERT INTO platform.activity(actor,actor_oid,workspace_owner,schema_name,table_name,operation,before_row,after_row)
  VALUES (session_user,(SELECT oid FROM pg_roles WHERE rolname=session_user),owner_oid,
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
RESET ROLE;
