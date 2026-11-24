-- The example's schema: the groups, the people, the two workspaces with their collections,
-- grants and row policies. It is run once, in a database the platform is installed in, by
-- the server's own superuser:
--
--   psql -1 -f migrations/0001_platform.sql -f examples/newsroom/apply/schema.sql \
--        -f examples/newsroom/apply/demo.sql
--
-- The administrator is the deployment's own (PLATFORM_ADMIN). Name them before the files
-- with PGOPTIONS='-c deployment.admin=admin@localhost'; unnamed, they are admin@example.com.
SELECT set_config('deployment.admin',
  coalesce(nullif(current_setting('deployment.admin', true), ''), 'admin@example.com'), false);

CREATE ROLE newsroom_reader NOLOGIN;
CREATE ROLE newsroom_writer NOLOGIN;
CREATE ROLE sales NOLOGIN;
CREATE ROLE "alice@example.com" LOGIN;
CREATE ROLE "bob@example.com" LOGIN;
GRANT platform_users, newsroom_reader, newsroom_writer TO "alice@example.com";
GRANT platform_users, newsroom_reader, newsroom_writer, sales TO "bob@example.com";

-- The administrator: in every group, admits people to each, and may make roles and workspaces.
DO $$
DECLARE admin text := current_setting('deployment.admin');
BEGIN
  IF to_regrole(quote_ident(admin)) IS NULL THEN EXECUTE format('CREATE ROLE %I LOGIN', admin); END IF;
  EXECUTE format('ALTER ROLE %I CREATEROLE', admin);
  EXECUTE format('GRANT platform_users, platform_admins, newsroom_reader, newsroom_writer, sales TO %I WITH ADMIN OPTION', admin);
  EXECUTE format('GRANT CREATE ON DATABASE %I TO %I', current_database(), admin);
END $$;

-- The newsroom: its owner is the administrator, who makes it as themself.
SELECT set_config('role', current_setting('deployment.admin'), false);
CREATE SCHEMA newsroom;
INSERT INTO platform.item_metadata (scope, schema_name, table_name, column_name, key, value) VALUES
  ('workspace', 'newsroom', NULL, NULL, 'display_name', '"Newsroom"'),
  ('workspace', 'newsroom', NULL, NULL, 'icon', '"newspaper"'),
  ('workspace', 'newsroom', NULL, NULL, 'color', '"steel"'),
  ('workspace', 'newsroom', NULL, NULL, 'purpose', '"The newsroom''s stories, desks and corrections."'),
  ('workspace', 'newsroom', NULL, NULL, 'contact', '"desk@example.com"');
SELECT platform.create_collection('newsroom', 'sections');
ALTER TABLE newsroom.sections ADD COLUMN name text NOT NULL UNIQUE CHECK (char_length(name) <= 60);
ALTER TABLE newsroom.sections ADD COLUMN desk_email text;
COMMENT ON TABLE newsroom.sections IS 'The desks an article is filed under.';
ALTER TABLE newsroom.sections DISABLE ROW LEVEL SECURITY;
INSERT INTO platform.item_metadata (scope, schema_name, table_name, column_name, key, value) VALUES
  ('field', 'newsroom', 'sections', 'name', 'renderers', '{"list":{"renderer":"marked","options":{"icon":"newspaper","colour":"steel"}}}'),
  ('collection', 'newsroom', 'sections', NULL, 'display_name', '"Sections"'),
  ('collection', 'newsroom', 'sections', NULL, 'icon', '"list-todo"'),
  ('collection', 'newsroom', 'sections', NULL, 'color', '"cyan"');
SELECT platform.create_collection('newsroom', 'articles');
ALTER TABLE newsroom.articles ADD COLUMN title text NOT NULL CHECK (char_length(title) <= 120);
ALTER TABLE newsroom.articles ADD COLUMN status text DEFAULT 'draft' NOT NULL CHECK (status IN ('draft', 'review', 'published'));
CREATE INDEX ON newsroom.articles (status);
ALTER TABLE newsroom.articles ADD COLUMN section uuid;
ALTER TABLE newsroom.articles ADD COLUMN word_count integer CHECK (word_count >= 0);
ALTER TABLE newsroom.articles ADD COLUMN published_at timestamptz;
ALTER TABLE newsroom.articles ADD COLUMN internal_notes text;
COMMENT ON COLUMN newsroom.articles.internal_notes IS 'Editors only: legal flags, sources, embargoes.';
COMMENT ON TABLE newsroom.articles IS 'Every story, from first draft to publication.';
INSERT INTO platform.item_metadata (scope, schema_name, table_name, column_name, key, value) VALUES
  ('field', 'newsroom', 'articles', 'word_count', 'renderers', '{"list":"reading-time"}'),
  ('collection', 'newsroom', 'articles', NULL, 'display_name', '"Articles"'),
  ('collection', 'newsroom', 'articles', NULL, 'icon', '"file-text"'),
  ('collection', 'newsroom', 'articles', NULL, 'color', '"indigo"'),
  ('collection', 'newsroom', 'articles', NULL, 'display_field', '"title"'),
  ('collection', 'newsroom', 'articles', NULL, 'retention', '{"drafts_days":90,"published":"forever"}'),
  ('field', 'newsroom', 'articles', 'title', 'display_name', '"Headline"'),
  ('field', 'newsroom', 'articles', 'internal_notes', 'display_name', '"Legal flags"');
SELECT platform.create_collection('newsroom', 'tags');
ALTER TABLE newsroom.tags ADD COLUMN name text NOT NULL UNIQUE CHECK (char_length(name) <= 40);
COMMENT ON TABLE newsroom.tags IS 'The subjects a story is filed under.';
ALTER TABLE newsroom.tags DISABLE ROW LEVEL SECURITY;
INSERT INTO platform.item_metadata (scope, schema_name, table_name, column_name, key, value) VALUES
  ('collection', 'newsroom', 'tags', NULL, 'display_name', '"Tags"'),
  ('collection', 'newsroom', 'tags', NULL, 'icon', '"tags"'),
  ('collection', 'newsroom', 'tags', NULL, 'color', '"grape"');
SELECT platform.create_collection('newsroom', 'article_tags');
ALTER TABLE newsroom.article_tags ADD COLUMN article uuid NOT NULL;
ALTER TABLE newsroom.article_tags ADD COLUMN tag uuid NOT NULL;
COMMENT ON TABLE newsroom.article_tags IS 'Which story carries which tag: a link between two rows, and nothing else.';
ALTER TABLE newsroom.article_tags DISABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX ON newsroom.article_tags (article, tag);
INSERT INTO platform.item_metadata (scope, schema_name, table_name, column_name, key, value) VALUES
  ('collection', 'newsroom', 'article_tags', NULL, 'display_name', '"Article tags"'),
  ('collection', 'newsroom', 'article_tags', NULL, 'icon', '"link"'),
  ('collection', 'newsroom', 'article_tags', NULL, 'color', '"gray"');
SELECT platform.create_collection('newsroom', 'corrections');
ALTER TABLE newsroom.corrections ADD COLUMN article uuid NOT NULL;
ALTER TABLE newsroom.corrections ADD COLUMN wording text NOT NULL;
ALTER TABLE newsroom.corrections ADD COLUMN severity text DEFAULT 'minor' NOT NULL CHECK (severity IN ('minor', 'material', 'retraction'));
ALTER TABLE newsroom.articles ADD CONSTRAINT articles_section_fkey FOREIGN KEY (section) REFERENCES newsroom.sections (id) ON DELETE RESTRICT;
CREATE INDEX ON newsroom.articles (section);
ALTER TABLE newsroom.article_tags ADD CONSTRAINT article_tags_article_fkey FOREIGN KEY (article) REFERENCES newsroom.articles (id) ON DELETE CASCADE;
ALTER TABLE newsroom.article_tags ADD CONSTRAINT article_tags_tag_fkey FOREIGN KEY (tag) REFERENCES newsroom.tags (id) ON DELETE CASCADE;
CREATE INDEX ON newsroom.article_tags (tag);
ALTER TABLE newsroom.corrections ADD CONSTRAINT corrections_article_fkey FOREIGN KEY (article) REFERENCES newsroom.articles (id) ON DELETE CASCADE;
CREATE INDEX ON newsroom.corrections (article);
INSERT INTO platform.item_metadata (scope, schema_name, table_name, column_name, key, value) VALUES
  ('collection', 'newsroom', 'corrections', NULL, 'display_name', '"Corrections"'),
  ('collection', 'newsroom', 'corrections', NULL, 'icon', '"pencil-ruler"'),
  ('collection', 'newsroom', 'corrections', NULL, 'color', '"bronze"');
GRANT USAGE ON SCHEMA newsroom TO newsroom_reader, newsroom_writer;
GRANT SELECT ON TABLE newsroom.sections TO newsroom_reader;
GRANT SELECT (id, title, status, section, word_count, published_at, created_at, updated_at, created_by, updated_by, version) ON TABLE newsroom.articles TO newsroom_reader;
GRANT INSERT (title, status, section, word_count), UPDATE (title, status, section, word_count) ON TABLE newsroom.articles TO newsroom_writer;
GRANT DELETE ON TABLE newsroom.articles TO newsroom_writer;
GRANT SELECT ON TABLE newsroom.corrections TO newsroom_reader;
GRANT SELECT ON TABLE newsroom.tags TO newsroom_reader, newsroom_writer;
GRANT SELECT ON TABLE newsroom.article_tags TO newsroom_reader;
GRANT INSERT (article, tag), DELETE ON TABLE newsroom.article_tags TO newsroom_writer;
CREATE POLICY own_articles ON newsroom.articles FOR ALL TO newsroom_writer
  USING (created_by = session_user)
  WITH CHECK (created_by = session_user);
CREATE POLICY published_articles ON newsroom.articles FOR SELECT TO newsroom_reader
  USING (status = 'published');
CREATE POLICY readable_corrections ON newsroom.corrections FOR SELECT TO newsroom_reader
  USING (true);
RESET ROLE;

-- The CRM: its owner is a group, sales, and whoever is in it administers it.
GRANT platform_users TO sales;
CREATE SCHEMA crm AUTHORIZATION sales;
SET ROLE sales;
INSERT INTO platform.item_metadata (scope, schema_name, table_name, column_name, key, value) VALUES
  ('workspace', 'crm', NULL, NULL, 'display_name', '"CRM"'),
  ('workspace', 'crm', NULL, NULL, 'icon', '"briefcase"'),
  ('workspace', 'crm', NULL, NULL, 'color', '"purple"'),
  ('workspace', 'crm', NULL, NULL, 'purpose', '"Accounts, the people at them and the deals in flight."');
SELECT platform.create_collection('crm', 'accounts');
ALTER TABLE crm.accounts ADD COLUMN name text NOT NULL;
CREATE INDEX ON crm.accounts (name);
ALTER TABLE crm.accounts ADD COLUMN type text DEFAULT 'prospect' NOT NULL CHECK (type IN ('prospect', 'customer', 'partner', 'vendor', 'former_customer'));
ALTER TABLE crm.accounts ADD COLUMN industry text;
ALTER TABLE crm.accounts ADD COLUMN employees integer CHECK (employees >= 0);
ALTER TABLE crm.accounts ADD COLUMN annual_revenue numeric(14, 2);
ALTER TABLE crm.accounts ADD COLUMN website text;
COMMENT ON TABLE crm.accounts IS 'Companies and organisations: prospects, customers, partners and vendors.';
INSERT INTO platform.item_metadata (scope, schema_name, table_name, column_name, key, value) VALUES
  ('collection', 'crm', 'accounts', NULL, 'display_name', '"Accounts"'),
  ('collection', 'crm', 'accounts', NULL, 'icon', '"building-2"'),
  ('collection', 'crm', 'accounts', NULL, 'color', '"mint"');
SELECT platform.create_collection('crm', 'contacts');
ALTER TABLE crm.contacts ADD COLUMN full_name text NOT NULL;
ALTER TABLE crm.contacts ADD COLUMN email text UNIQUE;
ALTER TABLE crm.contacts ADD COLUMN title text;
ALTER TABLE crm.contacts ADD COLUMN account uuid;
SELECT platform.create_collection('crm', 'deals');
ALTER TABLE crm.deals ADD COLUMN name text NOT NULL;
ALTER TABLE crm.deals ADD COLUMN account uuid NOT NULL;
ALTER TABLE crm.deals ADD COLUMN stage text DEFAULT 'qualify' NOT NULL CHECK (stage IN ('qualify', 'propose', 'negotiate', 'won', 'lost'));
ALTER TABLE crm.deals ADD COLUMN amount numeric(12, 2) CHECK (amount >= 0);
ALTER TABLE crm.deals ADD COLUMN close_date date;
ALTER TABLE crm.deals ADD COLUMN details jsonb;
ALTER TABLE crm.contacts ADD CONSTRAINT contacts_account_fkey FOREIGN KEY (account) REFERENCES crm.accounts (id) ON DELETE SET NULL;
CREATE INDEX ON crm.contacts (account);
ALTER TABLE crm.deals ADD CONSTRAINT deals_account_fkey FOREIGN KEY (account) REFERENCES crm.accounts (id) ON DELETE CASCADE;
CREATE INDEX ON crm.deals (account);
GRANT USAGE ON SCHEMA crm TO newsroom_reader;
GRANT SELECT (id, name, type, industry, website) ON TABLE crm.accounts TO newsroom_reader;
CREATE POLICY everyone_reads ON crm.accounts FOR SELECT TO PUBLIC
  USING (true);
RESET ROLE;

-- What the items say of themselves is stamped with the installer's name. Each row is handed
-- to whoever owns its workspace, as if they had written it; the stamp is set aside meanwhile.
ALTER TABLE platform.item_metadata DISABLE TRIGGER USER;
UPDATE platform.item_metadata SET created_by = current_setting('deployment.admin'), updated_by = current_setting('deployment.admin')
 WHERE schema_name = 'newsroom';
UPDATE platform.item_metadata SET created_by = 'bob@example.com', updated_by = 'bob@example.com'
 WHERE schema_name = 'crm';
ALTER TABLE platform.item_metadata ENABLE TRIGGER USER;
