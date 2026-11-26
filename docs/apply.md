# Applying SQL to a deployment

Everything applied to a database is a SQL file, run by psql. There is no manifest format and
no command of the platform's own between the file and PostgreSQL: what the file says is what
runs, as the person who runs it, and PostgreSQL refuses what they may not do.

## The files

| File                                                | What it is                                                           | Who runs it                                           |
| --------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------- |
| `migrations/0001_platform.sql`                      | The platform itself: its roles, its schema, its views of the catalog | The database's administrator, once, in a new database |
| `<site>/apply/*.sql`                                | A site's own schema and rows, listed in its `platform.json`          | The server's superuser, once                          |
| `deploy/models/crm.sql`                             | A CRM model with real foreign keys, as an example of a larger schema | Whoever is to own the schema                          |
| `deploy/sql/administrator.sql`                      | The administrator of a deployment that applies no site               | The server's superuser                                |
| `deploy/sql/harden.sql`, `guard.sql`, `restore.sql` | Hide the role catalogs; guard row security; put the default back     | The cluster superuser                                 |
| `deploy/sql/doctor.sql`                             | What a deployment has left open. Changes nothing                     | Anyone; a superuser is told everything                |

```bash
psql -1 -v ON_ERROR_STOP=1 -f migrations/0001_platform.sql
PGOPTIONS='-c deployment.admin=admin@example.com' \
  psql -1 -v ON_ERROR_STOP=1 -f examples/newsroom/apply/schema.sql -f examples/newsroom/apply/demo.sql
```

`-1` runs the files in one transaction: a refusal leaves the database as it was. To try a
file and change nothing, run it inside a transaction that is rolled back:

```bash
(echo 'BEGIN;'; cat examples/newsroom/apply/schema.sql; echo 'ROLLBACK;') | psql -v ON_ERROR_STOP=1
```

The files are written to run once. They do not converge a database that already holds part
of what they say; write the difference as SQL of your own.

## A site folder

A site is a folder with a `platform.json`:

```json
{
  "apply": ["apply/schema.sql", "apply/demo.sql"],
  "extensions": "extensions.tsx"
}
```

`apply` lists the SQL files the folder applies, in order. The same files are run by the local
stack as it installs itself, installed in the page by the dev mode, and asked questions of by
the tests. `extensions` names the module that registers the site's own column types and
renderers ([columns](columns.md)). A `vite.config.ts` of two lines builds the site
([interface](interface.md)).

A site's files name the deployment's administrator as `current_setting('deployment.admin')`,
which `PGOPTIONS='-c deployment.admin=…'` sets and the local stack sets from PLATFORM_ADMIN.

## Writing a schema as SQL

A table is made by the platform's function, so that it carries its identity, its stamps,
its triggers and its row security; everything else is PostgreSQL's own DDL:

```sql
CREATE SCHEMA newsroom;                                        -- a schema
SELECT platform.create_table('newsroom', 'articles');     -- a table
ALTER TABLE newsroom.articles ADD COLUMN title text NOT NULL;  -- a column
GRANT USAGE ON SCHEMA newsroom TO newsroom_reader;
GRANT SELECT (id, title) ON TABLE newsroom.articles TO newsroom_reader;
CREATE POLICY published ON newsroom.articles FOR SELECT TO newsroom_reader USING (status = 'published');
INSERT INTO platform.item_metadata (scope, schema_name, table_name, column_name, key, value)
VALUES ('table', 'newsroom', 'articles', NULL, 'display_name', '"Articles"');
```

The interface writes the same statements, and shows them before it runs them: a change made
there can be copied into a file.

## Importing existing rows

Create the schemas and tables as their intended owner, then load rows with
PostgreSQL's `COPY`. Decide which `LOGIN` roles correspond to any external identities before
copying `created_by` and `updated_by`. To keep historical stamps, a table owner may disable
the `platform_stamp` and `platform_audit` triggers for the load, inside one transaction, and
enable both before it commits; do not present imported history as newly authenticated
events. New tables have row security on and no policies: define memberships, grants and
policies before admitting ordinary users.
