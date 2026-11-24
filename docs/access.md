# Native access control

Access is PostgreSQL's own. The interface reads it where it belongs — on a role, a workspace,
a collection, a field — and writes it as GRANT, REVOKE, CREATE POLICY and role statements that
the caller runs themself. It holds no rule of its own.

## Three independent checks

A reader reaches a row of a collection when all three allow it:

1. **The workspace.** `USAGE` on the schema. Without it nothing inside is reached.
2. **The collection and its fields.** Table privileges, or column privileges where a
   privilege is limited to named fields. A column the reader may not SELECT is refused by
   PostgreSQL in a projection, a predicate and a sort alike.
3. **The rows.** Row security. A new collection has it on with no policies, so grants alone
   never make rows visible: only its owner reads it until a policy says otherwise.

## Where it is read and changed

- **A workspace's page** lists who holds USAGE and CREATE on it, and every policy in it.
- **A collection's page** lists, for each role, what it holds — PostgreSQL's own answer from
  `platform.reach`, so a right held through a group or as PUBLIC counts — drawn as privilege
  marks: full for the whole collection, half for some fields, empty for none.
- **The grant editor** takes each privilege as not held, the whole collection, or chosen
  fields, and writes the difference between what the ACL records and what is asked. Narrowing
  from the collection to fields revokes on the collection and grants the fields by name;
  widening gives the field grants up.
- **Row security** is turned on and off, and policies are written, on the collection. A
  policy's expression is checked by PostgreSQL alone.
- **A role's page** lists its memberships and what it holds in the workspace in view.

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
"must be owner" is `pg_has_role(current_user, owner, 'USAGE')`. A workspace owned by a NOLOGIN
group is administered by the group's members. Ordinary users should never own a table: an
owner is not held to its row security unless it is forced, and may alter its policies. The
guard (`deploy/sql/guard.sql`) refuses an ordinary owner whatever takes a collection out of
row security or lets writes pass by its history ([security](security.md)).

## Roles

A user is a LOGIN role named after a person's email; a group is a NOLOGIN role. A caller sees
the roles they may use and their own memberships; an operator sees them all. Creating a role
needs CREATEROLE; admitting a member needs ADMIN OPTION on the group. A new user is added to
`platform_users`, which lets them connect and nothing more.

## Revocation

REVOKE and NOLOGIN take effect on the next statement and the next login. There is no
application token cache. A token already issued works until it expires; `ALTER ROLE … NOLOGIN`
locks its holder out at once.

## Metadata

What an item says of itself is read by whoever may reach the item and changed by its owner
alone, by row security on `platform.item_metadata` that asks PostgreSQL's privilege
functions. A row names its item by name: a renamed item leaves its metadata behind.
