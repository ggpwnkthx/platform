# Native access control

Run the examples in README first. `admin@example.com` owns the newsroom schema and article table.
`alice@example.com` and `bob@example.com` are real LOGIN roles, named after the email their
sign-in reports. `newsroom_reader` and `newsroom_writer` are native groups. Roles have no
passwords: a person logs in with a token from Dex, and no application password table exists.

## Three independent checks

A user needs database CONNECT and schema USAGE, the relevant table/column privilege, and an
applicable row policy on an RLS-enabled table. None substitutes for another.

```sql
GRANT USAGE ON SCHEMA newsroom TO newsroom_reader;
GRANT SELECT(id,title,status,created_by,version) ON newsroom.articles TO newsroom_reader;
GRANT INSERT(title,status), UPDATE(title,status), DELETE
  ON newsroom.articles TO newsroom_writer;
CREATE POLICY own_articles ON newsroom.articles FOR ALL TO newsroom_writer
  USING(created_by=session_user) WITH CHECK(created_by=session_user);
```

`USING` limits existing rows reached by SELECT/UPDATE/DELETE. `WITH CHECK` limits new row values
for INSERT/UPDATE. The trigger sets created_by before policy checks, using the real login.
Using `session_user` avoids relying on a client-writable `app.user_id` setting.

New helper-created collections have RLS enabled and zero policies. Non-owners see no rows
until policies exist. Owners normally bypass RLS; schema/table ownership is an administrative
capability and must not be given to normal data users. Superusers and BYPASSRLS roles are also
outside the row-security boundary. FORCE ROW LEVEL SECURITY subjects owners to policies in
normal queries, but an owner can still alter or disable those policies.

Multiple permissive policies combine with OR. Restrictive policies combine with AND. Native
role inheritance, SET option and ADMIN OPTION govern which group rights apply and who can
delegate them. The project does not redefine these rules. Catalog role and policy names have
PostgreSQL's normal metadata visibility; they are not confidential application directories.

For published rows readable by all readers:

```sql
CREATE POLICY published_articles ON newsroom.articles FOR SELECT TO newsroom_reader
  USING(status='published');
```

That adds published rows to what a reader can see. It does not change write policies. Use
separate native policies when read and write scopes differ. Custom validation belongs in
WITH CHECK or CHECK constraints; presets belong in database defaults/triggers.

Column grants apply to references in WHERE, ORDER BY and RETURNING as well as projections.
If a table-level SELECT grant exists, revoking a column grant will not hide that column:
remove the table-level grant and grant only the intended columns. The interface writes records
without RETURNING and reads only an affected-row count; write-only roles do not need SELECT on
hidden fields.

## Ownership and delegation

For a shared model-owner group, an administrator may create a NOLOGIN role, grant it
platform_users membership and schema ownership, then grant it only to trusted model operators.
Create objects under SET ROLE to that owner group in a direct SQL transaction so future grants
and ownership remain consistent. The interface opens one connection per action, so it does not
retain SET ROLE.

Use native `WITH GRANT OPTION` to delegate object privileges and `WITH ADMIN OPTION` to
delegate role membership. Creating logins requires native CREATEROLE and PostgreSQL's role
administration rules; owning a workspace alone does not confer cluster role administration.
Do not grant platform_core to workspace administrators.

## Revocation

```sql
REVOKE newsroom_reader FROM "alice@example.com";
ALTER ROLE "alice@example.com" NOLOGIN;
```

Removing someone from an upstream sign-in system stops new tokens; a token already issued works
until it expires (an hour, as shipped). NOLOGIN is what locks a person out at once.

Committed grants, revokes and policy changes affect subsequent PostgreSQL statements under
PostgreSQL's transaction/locking semantics. There is no application access-version cache to
refresh. Every action in the interface opens a new login, so NOLOGIN and the token's expiry
are checked again. Neither terminates already-open direct database sessions. An
operator requiring immediate disconnection should terminate those sessions too:

```sql
SELECT pg_terminate_backend(pid) FROM pg_stat_activity
 WHERE usename='alice@example.com' AND pid<>pg_backend_pid();
```

Direct clients may retain session state and can hold long transactions. Configure PostgreSQL
role limits, timeouts, pg_hba.conf and network exposure for your deployment. IP restrictions
belong at the PostgreSQL/network boundary. Seen from PostgreSQL, every interface session comes
from the relay's address, not the reader's, so an IP rule can tell the interface from a direct
client but not one reader from another.

## Metadata

Metadata describes an item instead of holding its records: what a workspace is for, how a
collection should be read, who answers for it, what a field holds. It lives in
`platform.item_metadata`, one row per key per item, and it is reached under the same two rules
as the items themselves:

- a reader sees the metadata of the items they may reach — USAGE on the schema for a
  workspace, any right on the table for a collection, whether the right is on the table or on
  one of its columns, and any right on the column for a field;
- only the owner of an item may change its metadata — the schema owner for a workspace, the
  table owner for a collection and for every field in it.

Both rules are row security policies that call PostgreSQL's own privilege functions
(`has_schema_privilege`, `has_table_privilege`, `has_any_column_privilege`,
`pg_has_role`). Nothing in the application decides them, so the same answer is given in the
interface and in psql, and a grant, a revoke or a membership change takes effect on
the next statement. A row the caller may not reach is not returned at all: an empty list is
the answer for an item they cannot see.

A workspace's metadata is a description of the workspace, so it may be read by anyone who may
use the workspace. A collection's metadata describes that collection, so it is read by those
who hold a right on it and not by those who merely share the workspace. A field's metadata
describes that field, so it is read by those who hold a right on the column and by nobody
else: the metadata of a field is as private as the field it describes, and a reader who may
not read a column never learns what it is called. Delegating a model without giving away the
database is native: a NOLOGIN role that owns the workspace owns its metadata for its members.

Three keys are reserved for how an item presents itself — `display_name`, `icon` and `color`
(see [interface](interface.md#presentation)). They are metadata like any other, so the same two
rules hold for them: a reader sees the presentation of the items they may reach, and only the
owner of an item may change it. The presentation is data, not a privilege: an owner cannot
present an item they do not own, and a reader cannot change one they may merely read. A field
is presented by its name alone — a column is a label, not a mark — and its name reaches only
the readers who may read the column.

A COMMENT is not metadata. PostgreSQL's comments are catalog text that every connected user
reads, and only an owner may change them; they suit a label, not anything that should follow
the item's rights.

As with the audit table, the owner of the platform schema bypasses these policies:
`platform_core` members and superusers read every row. That is an administrative capability,
and it is why ordinary data users must never own the tables they work with.

Metadata is not audited in `platform.activity`: the rows carry their own `created_by`,
`updated_by` and `version`. A collection that is dropped leaves its metadata behind, unread,
because the collection it named is gone.
