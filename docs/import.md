# Importing existing data

Install Platform into a dedicated database. Its installation marker identifies version
2.1.0. The installer is idempotent for that version and refuses an existing reserved `sys`
schema or an unsupported installation version rather than modifying unrelated structures.

Back up your source database before importing. Create the target workspace schemas and
collections as the intended owner. The additive JSON importer creates missing objects and
native foreign keys; it does not silently retype existing columns or reconcile schema drift.

Import ordinary records with PostgreSQL COPY or a reviewed staging/load process. Decide
which PostgreSQL LOGIN roles correspond to any external application identities before copying
created_by, updated_by or domain owner fields. Domain relationships that use UUIDs may refer
to business records rather than user identities and should retain the appropriate types.
Passwords from external application hash tables are not carried over: roles here have none.
Provision native roles named after each person's email, and let them sign in through Dex.

The platform_stamp trigger normally stamps creation/update metadata with the actual login.
To preserve historical metadata, a trusted table owner can temporarily disable only the
platform_stamp and platform_audit row triggers in a controlled load transaction, copy the
reviewed source IDs/timestamps/versions and transformed role names, then re-enable both before
commit. Do not claim imported historical activity as newly authenticated per-user events.
Preserve source audit history separately when required. Other constraints/triggers should
remain active; plan loading order around native foreign keys.

New helper-created collections have RLS enabled and zero policies. Define native memberships,
column/table grants and row policies before admitting ordinary users. Do not blindly copy
unreviewed privileges or grant data users ownership, BYPASSRLS, superuser rights or membership
in platform_core. Tables created through manual DDL need their platform triggers installed by
an owner if stamping/revisions are required.

Compare counts, IDs, foreign keys, versions and representative values. Verify allowed and
denied actions as each low-privilege role through both direct PostgreSQL and the interface before
opening the target to writers. Profiles and other application metadata can be ordinary domain
tables; PostgreSQL remains the authority for authentication and permissions.
