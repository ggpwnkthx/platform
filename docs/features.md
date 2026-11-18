# Platform 2.1.0 capabilities

| Area                              | Behavior                                                                                                             |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Authentication                    | Sign-in through Dex and any providers behind it; PostgreSQL 18 verifies every login's token and logs in a LOGIN role |
| Users and groups                  | Native PostgreSQL roles and memberships                                                                              |
| Role catalog                      | The interface shows the caller's own roles; `cli harden` hides the raw catalogs from psql                            |
| Permission management             | SQL GRANT/REVOKE, CREATE/ALTER POLICY, native ownership; the interface shows each statement before it runs           |
| Model                             | PostgreSQL catalog; invoker DDL helpers and native ALTER TABLE                                                       |
| Metadata                          | What a workspace or a collection is, in `platform.item_metadata`, read and written under PostgreSQL's own rights     |
| Records                           | Parameterized SQL on the reader's own login; database ACLs and RLS are authoritative                                 |
| Complex queries and relationships | Native SQL, foreign keys, joins and views                                                                            |
| Audit                             | Trigger-generated transactional revisions, including direct SQL writes                                               |
| Interface                         | Content, data model, access, activity and SQL, read one workspace at a time; the page speaks PostgreSQL's protocol   |
| Deployment                        | CLI for Docker/Podman Compose (PostgreSQL 18, Dex, relay, interface) and Kubernetes                                  |

The interface reads one workspace at a time, and inside it one collection at a time: the
navigation pane lists the collections of the workspace in view, Content holds a collection's
records, Data model holds its fields, its description, its row security switch and its
metadata, and Access holds the roles, the rights each holds in the workspace and the row
policies. Each is editable only where PostgreSQL says so, and every change to the model or to
access is shown as SQL before it runs as the reader. The settings of a workspace hold its
metadata and the access on the schema. See [interface](interface.md).

Metadata is the description of an item rather than a row of it: a workspace may say what it
is for, a collection may say how it should be read. It is stored in the platform schema and
gated by row security that asks PostgreSQL's own privilege functions: a reader reaches the
metadata of the items they may reach, and only the owner of an item may change it. A grant, a
revoke or a membership change takes effect on the next statement, as everywhere else.

Data modeling is available at runtime. Constraints, indexes, relations, renames and drops use
native SQL when not covered by typed collection/field builders. Descriptive text is stored
as native COMMENTs where the builders support it. Use views for reusable projections.

The additive CRM model installs real foreign keys and uses PostgreSQL role names in owner
fields. Native roles own identity; domain profile tables can store display names or other
application-specific user details without becoming an authorization system.

Database row triggers record INSERT/UPDATE/DELETE and TRUNCATE events, not authentication,
SELECT or all DDL/DCL. Configure native statement auditing for those additional events.
