# Privileges

Access is PostgreSQL's own. The interface reads it where it belongs — on a role, a schema,
a table, a column — and writes it as GRANT, REVOKE, CREATE POLICY and role statements that
the caller runs themself. It holds no rule of its own.

## Three independent checks

A reader reaches a row of a table when all three allow it:

1. **The schema.** `USAGE` on the schema. Without it nothing inside is reached.
2. **The table and its columns.** Table privileges, or column privileges where a
   privilege is limited to named columns. A column the reader may not SELECT is refused by
   PostgreSQL in a projection, a predicate and a sort alike.
3. **The rows.** Row security. A new table has it on with no policies, so grants alone
   never make rows visible: only its owner reads it until a policy says otherwise.

## Where it is read and changed

- **A schema's page** lists who holds USAGE and CREATE on it, and every policy in it.
- **A table's page** lists, for each role, what it holds — PostgreSQL's own answer from
  `platform.reach`, so a right held through a group or as PUBLIC counts — drawn as privilege
  marks: full for the whole table, half for some columns, empty for none.
- **The grant editor** takes each privilege as not held, the whole table, or chosen
  columns, and writes the difference between what the ACL rows and what is asked. Narrowing
  from the table to columns revokes on the table and grants the columns by name;
  widening gives the column grants up.
- **Row security** is turned on and off, and policies are written, on the table. A
  policy's expression is checked by PostgreSQL alone.
- **A role's page** lists its memberships and what it holds in the schema in view.
- **Default privileges** are on a schema's page: what each new table, sequence,
  function or type made there by a role starts with (`ALTER DEFAULT PRIVILEGES FOR ROLE … IN
  SCHEMA …`), so it need not be granted one by one. The owner of the schema is the role
  offered first.
- **Grants on sequences, functions and types** are on a schema's page too: USAGE on a
  sequence or a type, EXECUTE on a function or a procedure.
- **Grants on the database** — CONNECT, CREATE, TEMPORARY — are on Roles, for an
  operator.

Every one of these is a change shown as SQL first, run as the caller in one transaction. A
change is offered where PostgreSQL says the caller may make it: the model where they own the
thing, a grant where they own it or hold a right on it WITH GRANT OPTION
(`has_table_privilege(… WITH GRANT OPTION)`), a membership where they hold the group WITH
ADMIN OPTION (`pg_has_role(…, 'MEMBER WITH ADMIN OPTION')`). PostgreSQL still refuses what
they may not do, and the refusal is shown with its SQLSTATE.

A GRANT or REVOKE that changes nothing is a refusal too. PostgreSQL only warns of it (01007,
01006), so a change whose statement drew that warning is rolled back whole and the warning is
shown as the refusal it is.

## Ownership and delegation

ALTER, GRANT and CREATE POLICY belong to the owner of a table, and PostgreSQL's test for
"must be owner" is `pg_has_role(current_user, owner, 'USAGE')`. A schema owned by a NOLOGIN
group is administered by the group's members. Ordinary users should never own a table: an
owner is not held to its row security unless it is forced, and may alter its policies. The
guard (`deploy/sql/guard.sql`) refuses an ordinary owner whatever takes a table out of
row security or lets writes pass by its history ([security](security.md)).

## Roles

A user is a LOGIN role named after a person's email; a group is a NOLOGIN role. A caller sees
the roles they may use and their own memberships; an operator sees them all. Creating a role
needs CREATEROLE; admitting a member needs ADMIN OPTION on the group. A new user is added to
`platform_users`, which lets them connect and nothing more.

An operator who holds ADMIN OPTION on a role renames it and changes what it may do: sign in
(LOGIN), make roles (CREATEROLE), use its groups' rights without SET ROLE (INHERIT), and hold so
many sessions at once (CONNECTION LIMIT). A role that is given LOGIN is added to
`platform_users`. VALID UNTIL is not offered: it ends a password, and no role here has one.

## Revocation

REVOKE and NOLOGIN take effect on the next statement and the next login. There is no
application token cache. A token already issued works until it expires; `ALTER ROLE … NOLOGIN`
locks its holder out at once.

## Metadata

What an item says of itself is read by whoever may reach the item and changed by its owner
alone, by row security on `platform.item_metadata` that asks PostgreSQL's privilege
functions. A row names its item by name, and an item that is gone or not made yet is owned by
nobody: so a rename made in the interface takes the rows away under the old name before it
and writes them again under the new one after it, in the same transaction, as statements the
reader sees. A schema's rename carries the rows of the tables its renamer owns, and
leaves the rest where it was. A rename made by hand leaves the metadata behind.
