-- The development database: what `bun run cli apply local examples/newsroom.json` and the CRM
-- model would leave behind, with rows in them. Run once, as the superuser of the in-page
-- PostgreSQL, after the migrations.

CREATE ROLE newsroom_reader NOLOGIN;
CREATE ROLE newsroom_writer NOLOGIN;
CREATE ROLE sales NOLOGIN;
CREATE ROLE "admin@example.com" LOGIN CREATEROLE;
CREATE ROLE "alice@example.com" LOGIN;
CREATE ROLE "bob@example.com" LOGIN;
GRANT platform_users TO "admin@example.com" WITH ADMIN OPTION;
GRANT platform_admins TO "admin@example.com" WITH ADMIN OPTION;
GRANT platform_users TO "alice@example.com", "bob@example.com";
GRANT newsroom_reader, newsroom_writer TO "alice@example.com", "bob@example.com";
GRANT sales TO "bob@example.com";
GRANT newsroom_reader, newsroom_writer, sales TO "admin@example.com" WITH ADMIN OPTION;
GRANT CREATE ON DATABASE postgres TO "admin@example.com";
GRANT CONNECT ON DATABASE postgres TO platform_users;

-- newsroom: the example manifest.
CREATE SCHEMA newsroom AUTHORIZATION "admin@example.com";
SET ROLE "admin@example.com";
SELECT platform.create_collection('newsroom', 'sections');
ALTER TABLE newsroom.sections ADD COLUMN name text NOT NULL UNIQUE CHECK (char_length(name) <= 60);
ALTER TABLE newsroom.sections ADD COLUMN desk_email text;
COMMENT ON TABLE newsroom.sections IS 'The desks an article is filed under.';
SELECT platform.create_collection('newsroom', 'articles');
ALTER TABLE newsroom.articles ADD COLUMN title text NOT NULL CHECK (char_length(title) <= 120);
ALTER TABLE newsroom.articles ADD COLUMN status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'review', 'published'));
ALTER TABLE newsroom.articles ADD COLUMN section uuid REFERENCES newsroom.sections (id) ON DELETE RESTRICT;
ALTER TABLE newsroom.articles ADD COLUMN word_count integer CHECK (word_count >= 0);
ALTER TABLE newsroom.articles ADD COLUMN published_at timestamptz;
ALTER TABLE newsroom.articles ADD COLUMN internal_notes text;
CREATE INDEX ON newsroom.articles (status);
COMMENT ON TABLE newsroom.articles IS 'Every story, from first draft to publication.';
COMMENT ON COLUMN newsroom.articles.internal_notes IS 'Editors only: legal flags, sources, embargoes.';
SELECT platform.create_collection('newsroom', 'corrections');
ALTER TABLE newsroom.corrections ADD COLUMN article uuid NOT NULL REFERENCES newsroom.articles (id) ON DELETE CASCADE;
ALTER TABLE newsroom.corrections ADD COLUMN wording text NOT NULL;
ALTER TABLE newsroom.corrections ADD COLUMN severity text NOT NULL DEFAULT 'minor' CHECK (severity IN ('minor', 'material', 'retraction'));

GRANT USAGE ON SCHEMA newsroom TO newsroom_reader, newsroom_writer;
GRANT SELECT ON newsroom.sections TO newsroom_reader;
GRANT SELECT (id, title, status, section, word_count, published_at, created_at, updated_at, created_by, updated_by, version)
  ON newsroom.articles TO newsroom_reader;
GRANT INSERT (title, status, section, word_count), UPDATE (title, status, section, word_count)
  ON newsroom.articles TO newsroom_writer;
GRANT DELETE ON newsroom.articles TO newsroom_writer;
GRANT SELECT ON newsroom.corrections TO newsroom_reader;
ALTER TABLE newsroom.sections DISABLE ROW LEVEL SECURITY;
CREATE POLICY own_articles ON newsroom.articles FOR ALL TO newsroom_writer
  USING (created_by = session_user) WITH CHECK (created_by = session_user);
CREATE POLICY published_articles ON newsroom.articles FOR SELECT TO newsroom_reader
  USING (status = 'published');
CREATE POLICY readable_corrections ON newsroom.corrections FOR SELECT TO newsroom_reader USING (true);

INSERT INTO newsroom.sections (name, desk_email) VALUES
  ('Politics', 'politics@example.com'), ('City', 'city@example.com'), ('Business', 'business@example.com'),
  ('Culture', 'culture@example.com'), ('Sport', 'sport@example.com'), ('Science', 'science@example.com'),
  ('Opinion', 'opinion@example.com'), ('Weather', NULL);
RESET ROLE;

-- Articles are written by the people who would write them, so the stamps say who.
CREATE TEMP TABLE headlines (n int, title text);
INSERT INTO headlines SELECT ordinality, t FROM unnest(ARRAY[
  'Council votes to extend the night bus pilot', 'What the budget means for school meals',
  'Ward boundaries: the new map, street by street', 'Mayor''s office answers on housing targets',
  'Polling stations to move for the by-election', 'Live: the planning committee, item by item',
  'Who funds the ring road study', 'Explainer: how a call-in works',
  'Ten years of the riverside regeneration', 'Library opening hours cut in four branches',
  'Tram depot plan returns with a smaller footprint', 'Rents rise fastest in the eastern wards',
  'The bakery that outlasted three landlords', 'Harbour dredging delayed by a second survey',
  'Flood barrier test closes the embankment overnight', 'Inside the new emergency department',
  'Quarterly results: the port operator beats forecasts', 'Small firms wait longer for council invoices',
  'Startup grant scheme reopens with a lower ceiling', 'Retail footfall returns to the old high street',
  'Orchestra announces a season of new commissions', 'The gallery that lends its paintings to schools',
  'Review: a quiet, exacting staging of the old play', 'Festival lineup leans on local acts',
  'Late goal keeps the club out of the relegation places', 'Marathon route changes around the bridge works',
  'Youth league fixtures moved after pitch inspection', 'Rowing club wins the regional eights',
  'Bird survey counts the first returning swifts', 'River temperature logged at a record in October',
  'University lab maps the city''s heat islands', 'What the air-quality sensors found on school runs',
  'Opinion: the bus lane is working, keep it', 'Opinion: a better way to count rough sleepers',
  'Letters: on the cost of the new footbridge', 'Weekend forecast: dry, cold, a hard frost on Sunday',
  'Storm warning issued for the coast road', 'Snow plan published for the hill estates',
  'Bridge closure: the diversions, day by day', 'School places: where the new admissions rules bite',
  'The allotment waiting list, explained', 'Night markets return to the canal basin',
  'Water bills to rise by the most in a decade', 'A year inside the city''s busiest food bank',
  'How the parking zones are being redrawn', 'The cyclists counting every pothole on their route',
  'Hospital car park fees to be scrapped for night staff', 'Profile: the oldest working ferryman on the estuary',
  'Shipyard apprentices finish their first hull', 'Planning inspector backs the riverside towers',
  'Council tax: what each band will pay next year', 'The choir that sings in the old pumping station',
  'Lottery grant restores the lido''s diving board', 'Opinion: the market hall deserves better',
  'Recycling collections move to a fortnightly round', 'Cup draw sends the club to the coast',
  'Archive photographs show the docks a century ago', 'What the census says about the city''s age',
  'Street lights to dim after midnight on side roads', 'Police to trial a new non-emergency number'
]) WITH ORDINALITY AS t;

-- The in-page PostgreSQL cannot hand a session back once it has become someone else, so the rows
-- are written with the triggers off and the stamps set to who would have written them; their
-- revisions are recorded afterwards, as the triggers would have recorded them.
ALTER TABLE newsroom.articles DISABLE TRIGGER USER;
ALTER TABLE newsroom.corrections DISABLE TRIGGER USER;
ALTER TABLE newsroom.sections DISABLE TRIGGER USER;
UPDATE newsroom.sections SET created_by = 'admin@example.com', updated_by = 'admin@example.com';
INSERT INTO newsroom.articles (title, status, section, word_count, created_by, updated_by, created_at, updated_at)
SELECT h.title,
       (ARRAY['draft','review','published','published','published'])[1 + h.n % 5],
       (SELECT id FROM newsroom.sections ORDER BY name OFFSET (h.n % 8) LIMIT 1),
       300 + ((h.n * 137) % 1900),
       (ARRAY['alice@example.com','bob@example.com'])[1 + h.n % 2],
       (ARRAY['alice@example.com','bob@example.com'])[1 + h.n % 2],
       now() - ((h.n * 11 + 30) || ' hours')::interval - ((h.n * 17) % 60 || ' minutes')::interval,
       now() - ((h.n * 5 + 2) || ' hours')::interval - ((h.n * 23) % 60 || ' minutes')::interval
  FROM headlines h;
UPDATE newsroom.articles SET published_at = created_at - ((word_count % 72) || ' hours')::interval,
       internal_notes = CASE WHEN word_count % 5 = 0 THEN 'Legal read before publication.' END
 WHERE status = 'published';
INSERT INTO newsroom.corrections (article, wording, severity)
SELECT id, 'An earlier version of this article gave the wrong date for the meeting.', 'minor'
  FROM newsroom.articles WHERE status = 'published' ORDER BY title LIMIT 6;
INSERT INTO newsroom.corrections (article, wording, severity)
SELECT id, 'This article misattributed a quote to the council leader; it was said by her deputy.', 'material'
  FROM newsroom.articles WHERE status = 'published' ORDER BY title DESC LIMIT 2;
UPDATE newsroom.corrections c SET created_by = 'admin@example.com', updated_by = 'admin@example.com',
       created_at = a.updated_at + interval '40 minutes', updated_at = a.updated_at + interval '40 minutes'
  FROM newsroom.articles a WHERE a.id = c.article;
UPDATE newsroom.sections SET created_at = now() - interval '40 days', updated_at = now() - interval '40 days';

-- crm: a second workspace, owned by a group, with relations between its collections.
CREATE SCHEMA crm AUTHORIZATION sales;
SELECT platform.create_collection('crm', 'accounts');
ALTER TABLE crm.accounts ADD COLUMN name text NOT NULL;
ALTER TABLE crm.accounts ADD COLUMN type text NOT NULL DEFAULT 'prospect' CHECK (type IN ('prospect','customer','partner','vendor','former_customer'));
ALTER TABLE crm.accounts ADD COLUMN industry text;
ALTER TABLE crm.accounts ADD COLUMN employees integer CHECK (employees >= 0);
ALTER TABLE crm.accounts ADD COLUMN annual_revenue numeric(14,2);
ALTER TABLE crm.accounts ADD COLUMN website text;
CREATE INDEX ON crm.accounts (name);
COMMENT ON TABLE crm.accounts IS 'Companies and organisations: prospects, customers, partners and vendors.';
SELECT platform.create_collection('crm', 'contacts');
ALTER TABLE crm.contacts ADD COLUMN full_name text NOT NULL;
ALTER TABLE crm.contacts ADD COLUMN email text UNIQUE;
ALTER TABLE crm.contacts ADD COLUMN title text;
ALTER TABLE crm.contacts ADD COLUMN account uuid REFERENCES crm.accounts (id) ON DELETE SET NULL;
SELECT platform.create_collection('crm', 'deals');
ALTER TABLE crm.deals ADD COLUMN name text NOT NULL;
ALTER TABLE crm.deals ADD COLUMN account uuid NOT NULL REFERENCES crm.accounts (id) ON DELETE CASCADE;
ALTER TABLE crm.deals ADD COLUMN stage text NOT NULL DEFAULT 'qualify' CHECK (stage IN ('qualify','propose','negotiate','won','lost'));
ALTER TABLE crm.deals ADD COLUMN amount numeric(12,2) CHECK (amount >= 0);
ALTER TABLE crm.deals ADD COLUMN close_date date;
ALTER TABLE crm.deals ADD COLUMN details jsonb;
GRANT USAGE ON SCHEMA crm TO newsroom_reader;
GRANT SELECT (id, name, type, industry, website) ON crm.accounts TO newsroom_reader;
CREATE POLICY everyone_reads ON crm.accounts FOR SELECT TO PUBLIC USING (true);
-- A group owns the workspace and its collections: every member administers them.
ALTER TABLE crm.accounts OWNER TO sales;
ALTER TABLE crm.contacts OWNER TO sales;
ALTER TABLE crm.deals OWNER TO sales;

ALTER TABLE crm.accounts DISABLE TRIGGER USER;
ALTER TABLE crm.contacts DISABLE TRIGGER USER;
ALTER TABLE crm.deals DISABLE TRIGGER USER;
INSERT INTO crm.accounts (name, type, industry, employees, annual_revenue, website)
SELECT n, (ARRAY['prospect','customer','partner','vendor','customer','former_customer'])[1 + i % 6],
       (ARRAY['Logistics','Healthcare','Retail','Energy','Software','Construction','Media'])[1 + i % 7],
       20 + (i * 397) % 4800, round(((i * 7919) % 900000 + 50000)::numeric * 10, 2), 'https://' || lower(replace(n, ' ', '')) || '.example'
  FROM unnest(ARRAY['Harbour Freight Lines','Northgate Clinics','Linden & Rowe','Westmarch Energy','Copperleaf Software',
    'Ashby Building Group','Riverside Media','Kestrel Analytics','Old Mill Bakeries','Fenwick Medical Supplies',
    'Brightwater Utilities','Tallis Print Works','Granary Square Retail','Halcyon Labs','Moorfield Haulage',
    'Saltmarsh Foods','Pennant Insurance','Larkspur Studios','Cobalt Rail Services','Thornbury Estates']) WITH ORDINALITY AS t(n, i);
INSERT INTO crm.contacts (full_name, email, title, account)
SELECT f || ' ' || l, lower(f) || '.' || lower(l) || '@' || lower(replace(a.name, ' ', '')) || '.example',
       (ARRAY['Head of Operations','Finance Director','Procurement Lead','CTO','Office Manager'])[1 + (length(f) + length(l)) % 5], a.id
  FROM crm.accounts a,
       LATERAL (SELECT (ARRAY['Priya','Tomasz','Grace','Kwame','Ines','Daniel','Mei','Oskar'])[1 + (length(a.name) + k) % 8] AS f,
                       (ARRAY['Okafor','Lindqvist','Moreau','Haddad','Patel','Novak','Byrne','Silva'])[1 + (length(a.name) * k) % 8] AS l
                  FROM generate_series(1, 3) k) people;
INSERT INTO crm.deals (name, account, stage, amount, close_date, details)
SELECT a.name || ' — ' || (ARRAY['annual renewal','expansion','pilot','support plan'])[k], a.id,
       (ARRAY['qualify','propose','negotiate','won','lost'])[1 + (length(a.name) + k) % 5],
       round(((length(a.name) * 1931 * k) % 240000 + 4000)::numeric, 2),
       date '2026-12-01' + ((length(a.name) * k * 7) % 120),
       jsonb_build_object('source', (ARRAY['referral','inbound','event'])[1 + k % 3], 'seats', 5 * k)
  FROM crm.accounts a, generate_series(1, 2 + length(a.name) % 3) k;
UPDATE crm.accounts SET created_by = 'bob@example.com', updated_by = 'bob@example.com';
UPDATE crm.contacts SET created_by = 'bob@example.com', updated_by = 'bob@example.com';
UPDATE crm.deals SET created_by = 'bob@example.com', updated_by = 'bob@example.com';

-- The revisions the triggers would have written, in the order the rows were made.
DELETE FROM platform.activity;
CREATE TEMP TABLE seed_activity (LIKE platform.activity INCLUDING DEFAULTS);
ALTER TABLE seed_activity ALTER COLUMN id DROP NOT NULL;
INSERT INTO seed_activity (at, actor, actor_oid, workspace_owner, schema_name, table_name, operation, after_row)
SELECT r.created_at, r.created_by, (SELECT oid FROM pg_roles WHERE rolname = r.created_by),
       (SELECT nspowner FROM pg_namespace WHERE nspname = r.s), r.s, r.t, 'INSERT', r.doc
  FROM (SELECT 'newsroom' s, 'sections' t, created_at, created_by, to_jsonb(x) doc FROM newsroom.sections x
        UNION ALL SELECT 'newsroom', 'articles', created_at, created_by, to_jsonb(x) FROM newsroom.articles x
        UNION ALL SELECT 'newsroom', 'corrections', created_at, created_by, to_jsonb(x) FROM newsroom.corrections x
        UNION ALL SELECT 'crm', 'accounts', created_at, created_by, to_jsonb(x) FROM crm.accounts x
        UNION ALL SELECT 'crm', 'contacts', created_at, created_by, to_jsonb(x) FROM crm.contacts x
        UNION ALL SELECT 'crm', 'deals', created_at, created_by, to_jsonb(x) FROM crm.deals x) r
 ORDER BY r.created_at;
-- Articles move through review to publication: the author sends it, an editor publishes it.
INSERT INTO seed_activity (at, actor, actor_oid, workspace_owner, schema_name, table_name, operation, before_row, after_row)
SELECT a.updated_at - interval '3 hours', a.created_by, (SELECT oid FROM pg_roles WHERE rolname = a.created_by),
       (SELECT nspowner FROM pg_namespace WHERE nspname = 'newsroom'), 'newsroom', 'articles', 'UPDATE',
       to_jsonb(a) || jsonb_build_object('status', 'draft', 'version', 1),
       to_jsonb(a) || jsonb_build_object('status', 'review', 'version', 2)
  FROM newsroom.articles a WHERE a.status IN ('review', 'published');
INSERT INTO seed_activity (at, actor, actor_oid, workspace_owner, schema_name, table_name, operation, before_row, after_row)
SELECT a.updated_at, 'admin@example.com', (SELECT oid FROM pg_roles WHERE rolname = 'admin@example.com'),
       (SELECT nspowner FROM pg_namespace WHERE nspname = 'newsroom'), 'newsroom', 'articles', 'UPDATE',
       to_jsonb(a) || jsonb_build_object('status', 'review', 'version', 2, 'published_at', null),
       to_jsonb(a) || jsonb_build_object('version', 3)
  FROM newsroom.articles a WHERE a.status = 'published';
UPDATE newsroom.articles SET version = CASE status WHEN 'published' THEN 3 WHEN 'review' THEN 2 ELSE 1 END;
-- Two drafts their authors withdrew.
INSERT INTO seed_activity (at, actor, actor_oid, workspace_owner, schema_name, table_name, operation, before_row)
SELECT now() - (n || ' hours')::interval, who, (SELECT oid FROM pg_roles WHERE rolname = who),
       (SELECT nspowner FROM pg_namespace WHERE nspname = 'newsroom'), 'newsroom', 'articles', 'DELETE',
       jsonb_build_object('id', gen_random_uuid(), 'title', title, 'status', 'draft', 'created_by', who, 'version', 1)
  FROM (VALUES (5, 'alice@example.com', 'Draft: river crossing timeline'),
               (29, 'bob@example.com', 'Notes for the hustings live blog')) AS w(n, who, title);
-- In the order they happened, so the newest revision has the highest id, as a trigger would leave it.
INSERT INTO platform.activity (at, actor, actor_oid, workspace_owner, schema_name, table_name, operation, before_row, after_row)
SELECT at, actor, actor_oid, workspace_owner, schema_name, table_name, operation, before_row, after_row
  FROM seed_activity ORDER BY at;
ALTER TABLE newsroom.articles ENABLE TRIGGER USER;
ALTER TABLE newsroom.corrections ENABLE TRIGGER USER;
ALTER TABLE newsroom.sections ENABLE TRIGGER USER;
ALTER TABLE crm.accounts ENABLE TRIGGER USER;
ALTER TABLE crm.contacts ENABLE TRIGGER USER;
ALTER TABLE crm.deals ENABLE TRIGGER USER;

INSERT INTO platform.item_metadata (scope, schema_name, table_name, key, value, created_by, updated_by) VALUES
  ('workspace', 'newsroom', NULL, 'purpose', '"The newsroom''s stories, desks and corrections."', 'admin@example.com', 'admin@example.com'),
  ('workspace', 'newsroom', NULL, 'contact', '"desk@example.com"', 'admin@example.com', 'admin@example.com'),
  ('workspace', 'newsroom', NULL, 'display_name', '"Newsroom"', 'admin@example.com', 'admin@example.com'),
  ('workspace', 'newsroom', NULL, 'icon', '"newspaper"', 'admin@example.com', 'admin@example.com'),
  ('workspace', 'newsroom', NULL, 'color', '"steel"', 'admin@example.com', 'admin@example.com'),
  ('collection', 'newsroom', 'articles', 'display_field', '"title"', 'admin@example.com', 'admin@example.com'),
  ('collection', 'newsroom', 'articles', 'retention', '{"drafts_days": 90, "published": "forever"}', 'admin@example.com', 'admin@example.com'),
  ('collection', 'newsroom', 'articles', 'display_name', '"Articles"', 'admin@example.com', 'admin@example.com'),
  ('collection', 'newsroom', 'articles', 'icon', '"file-text"', 'admin@example.com', 'admin@example.com'),
  ('collection', 'newsroom', 'articles', 'color', '"indigo"', 'admin@example.com', 'admin@example.com'),
  ('collection', 'newsroom', 'sections', 'display_name', '"Sections"', 'admin@example.com', 'admin@example.com'),
  ('collection', 'newsroom', 'sections', 'icon', '"list-todo"', 'admin@example.com', 'admin@example.com'),
  ('collection', 'newsroom', 'sections', 'color', '"cyan"', 'admin@example.com', 'admin@example.com'),
  ('collection', 'newsroom', 'corrections', 'display_name', '"Corrections"', 'admin@example.com', 'admin@example.com'),
  ('collection', 'newsroom', 'corrections', 'icon', '"pencil-ruler"', 'admin@example.com', 'admin@example.com'),
  ('collection', 'newsroom', 'corrections', 'color', '"bronze"', 'admin@example.com', 'admin@example.com'),
  ('workspace', 'crm', NULL, 'purpose', '"Accounts, the people at them and the deals in flight."', 'bob@example.com', 'bob@example.com'),
  ('workspace', 'crm', NULL, 'display_name', '"CRM"', 'bob@example.com', 'bob@example.com'),
  ('workspace', 'crm', NULL, 'icon', '"briefcase"', 'bob@example.com', 'bob@example.com'),
  ('workspace', 'crm', NULL, 'color', '"purple"', 'bob@example.com', 'bob@example.com'),
  ('collection', 'crm', 'accounts', 'display_name', '"Accounts"', 'bob@example.com', 'bob@example.com'),
  ('collection', 'crm', 'accounts', 'icon', '"building-2"', 'bob@example.com', 'bob@example.com'),
  ('collection', 'crm', 'accounts', 'color', '"mint"', 'bob@example.com', 'bob@example.com');
