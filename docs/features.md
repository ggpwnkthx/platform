# Platform 2.3.0 capabilities

| Area                              | Behavior                                                                                                             |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Authentication                    | Sign-in through Dex and any providers behind it; PostgreSQL 18 verifies every login's token and logs in a LOGIN role |
| Users and groups                  | Native PostgreSQL roles and memberships                                                                              |
| Role catalog                      | The interface shows the caller's own roles; `cli harden` hides the raw catalogs from psql                            |
| Permission management             | SQL GRANT/REVOKE, CREATE/ALTER POLICY, native ownership; the interface shows each statement before it runs           |
| Model                             | PostgreSQL catalog; invoker DDL helpers and native ALTER TABLE                                                       |
| Metadata                          | What a workspace, a collection or a field is, in `platform.item_metadata`, under PostgreSQL's own rights             |
| Records                           | Parameterized SQL on the reader's own login; database ACLs and RLS are authoritative                                 |
| Complex queries and relationships | Native SQL, foreign keys, joins and views                                                                            |
| Audit                             | Trigger-generated transactional revisions, including direct SQL writes                                               |
| Interface                         | Data, access, activity and SQL, read one workspace at a time; the page speaks PostgreSQL's protocol                  |
| Deployment                        | CLI for Docker/Podman Compose (PostgreSQL 18, Dex, relay) and Kubernetes; the interface is static files for a CDN    |

The interface reads one workspace at a time, and inside it one collection at a time: the
navigation pane lists the collections of the workspace in view, the data module holds a collection's
records and, behind the gear beside the create button, its fields, its description, its row security switch and its
metadata, and Access holds the roles, the rights each holds in the workspace and the row
policies. Each is editable only where PostgreSQL says so, and every change to the model or to
access is shown as SQL before it runs as the reader. The settings of a workspace hold its
metadata and the access on the schema. See [interface](interface.md).

Metadata is the description of an item rather than a row of it: a workspace may say what it
is for, a collection may say how it should be read, a field may say what it holds. It is
stored in the platform schema and gated by row security that asks PostgreSQL's own privilege
functions: a reader reaches the metadata of the items they may reach, and only the owner of an
item may change it. A grant, a revoke or a membership change takes effect on the next
statement, as everywhere else.

Three keys of that metadata are reserved for presentation: `display_name`, `icon` and
`color`. A workspace or a collection may carry a name people read, a mark of the platform's own
icons and a colour from the pinned palette, and the interface draws them wherever the item
appears — the workspace switcher, the collection tiles, the header of the item's own page.
They are metadata like any other: the same rights, the same refusals.

A field may carry metadata too, and it is secured by the field's own rights: whoever holds a
right on the column reaches its metadata, and nobody else does. A field's `display_name` is
the label the interface shows for it — in the records table and in the record form — and a
reader who may not read the column never learns it.

A field may also say where it appears, in the reserved key `views` of that same metadata: the
records grid, the record form, the filter builder. A field may be kept out of the grid, locked
in the form or kept out of the filters, and only the owner of the collection may say so. The
saying narrows the interface and grants nothing: PostgreSQL still decides who may read the
field and who may write it. A column the database computes itself — a generated column, an
identity column — is shown and never offered as an input.

Every field carries its own saying: the platform writes one when it makes a field, so where
a field appears is said of the field itself. The owner of a collection may also name views of
their own beside the three the interface draws — an export, a print sheet — and say whether
the field appears in them. The platform keeps what it is told and hands it back; the drawing
of a custom view is the deployment's business.

A field may also say how its values are drawn, in the reserved key `renderers` of that same
metadata: a value in the records grid and a value in the record form may be drawn differently,
by the kind of value they are. The owner chooses the renderer for each place, from the ones
the platform holds and the ones the installation added; the saying narrows nothing and grants
nothing, and a renderer the platform does not hold draws nothing at all. See
[renderers](renderers.md).

What a field is in the interface — its cell, its value, its input and its filter — is its
field type's to say, and the type follows from what PostgreSQL says of the column. An
installation may add types of its own. See [fields](fields.md).

Data modeling is available at runtime. Constraints, indexes, relations, renames and drops use
native SQL when not covered by typed collection/field builders. Descriptive text is stored
as native COMMENTs where the builders support it. Use views for reusable projections.

A field may have any type the database holds, not only the platform's own dozen: `geometry`
and `geography` where PostGIS is installed, an enum or a domain of the installation's own.
Such a type is named with the schema it lives in and may carry the modifiers it takes, and
PostgreSQL holds the column to it as it holds any other.

The additive CRM model installs real foreign keys and uses PostgreSQL role names in owner
fields. Native roles own identity; domain profile tables can store display names or other
application-specific user details without becoming an authorization system.

Database row triggers record INSERT/UPDATE/DELETE and TRUNCATE events, not authentication,
SELECT or all DDL/DCL. Configure native statement auditing for those additional events.
