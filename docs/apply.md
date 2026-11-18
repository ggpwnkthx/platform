# Applying changes to a deployment

`bun run cli apply <deployment> FILE... [--dry-run]` brings a deployment's database to what one
or more JSON manifests describe: users, groups, workspaces, collections, grants and row policies.
Everything is native PostgreSQL, done with the operator's own rights, in one transaction. Either
every file is applied or nothing is.

```bash
bun run cli apply local examples/newsroom.json --dry-run   # what would change
bun run cli apply local examples/newsroom.json
bun run cli apply local examples/newsroom.json deploy/models/crm.json
```

Each change is printed, then a count of what changed and what was already in place. Applying
the same manifest again changes nothing. `--dry-run` runs every statement and rolls back, so
its report is PostgreSQL's answer, including any permission it would refuse.

## Deployments

| Deployment | Database                                                                | Operator                                                                                         |
| ---------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `local`    | The Compose stack: 127.0.0.1, POSTGRES_PORT (5432), database `platform` | `postgres` with the administrator password saved in .env, unless PGTOKEN[_FILE] or PGUSER is set |
| `k8s`      | DATABASE_HOST/PORT/NAME/SSL, as for `migrate`                           | PGTOKEN[_FILE], or PGUSER and PGPASSWORD[_FILE]                                                  |

To act as yourself rather than the cluster administrator, sign in and pass the token:
`PGTOKEN=$(bun run --silent cli token) bun run cli apply local team.json`. PostgreSQL then
decides what you may change: you manage the roles you created and the workspaces you own.

## Manifest

```json
{
  "format": 1,
  "groups": [{ "name": "newsroom_writer" }],
  "users": [
    { "name": "admin@example.com", "admin": true },
    { "name": "alice@example.com", "groups": ["newsroom_writer"] }
  ],
  "workspaces": [
    {
      "slug": "newsroom",
      "owner": "admin@example.com",
      "collections": [{ "name": "articles", "fields": [{ "name": "title", "type": "string" }] }],
      "grants": [
        { "to": "newsroom_writer", "privileges": ["usage"] },
        {
          "to": "newsroom_writer",
          "collection": "articles",
          "privileges": ["select", "insert", "delete"],
          "columns": ["id", "title"]
        }
      ],
      "policies": [
        {
          "collection": "articles",
          "name": "own_articles",
          "to": ["newsroom_writer"],
          "using": "created_by=session_user",
          "check": "created_by=session_user"
        }
      ]
    }
  ]
}
```

| Entry                      | Meaning                                                                                                                                                                                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `groups[]`                 | A NOLOGIN role: `name`.                                                                                                                                                                                                                                   |
| `users[]`                  | A LOGIN role: `name` (the email the person signs in with), `groups`, `login` (false disables it) and `admin`. Every user joins `platform_users`, which is what lets it connect.                                                                           |
| `users[].admin`            | true gives the bootstrap administrator's rights (CREATEROLE, CREATE on the database, admission to `platform_users`); false withdraws them; omitted leaves them alone.                                                                                     |
| `workspaces[]`             | A schema: `slug`, optional `owner`, and its `collections`, `relations`, `grants` and `policies`. With an owner, everything inside is created as that role, so it owns it.                                                                                 |
| `collections`, `relations` | The model format of `deploy/models/crm.json`. Additive: missing collections, fields and foreign keys are created; existing columns are never retyped.                                                                                                     |
| `grants[]`                 | `to` (a role, a list, or `public`), `privileges`, and optionally `collection` and `columns`. Without a collection the grant is on the workspace (`usage`, `create`). Columns limit select, insert, update and references; delete always covers the table. |
| `policies[]`               | `collection`, `name`, `for` (all, select, insert, update, delete), `to`, `using`, `check`, `restrictive`. An existing policy of that name is replaced.                                                                                                    |

A model file such as deploy/models/crm.json is a manifest of one workspace, with `workspace`
and its contents at the top level. Unknown keys outside collections are rejected, so a typo
does not silently do nothing.

## Sign-in

A manifest declares roles, not credentials. A user's `name` is the email address Dex reports
for the person, and that person can log in as soon as the role exists: PostgreSQL matches the
token's email claim against the role name. Who may sign in as that address, and how, is the
business of Dex and the providers behind it. A manifest that tries to set a password
(`password_env`, `password_file`) is rejected.

## Removing

Apply adds and adjusts. It removes only what is marked `"state": "absent"`: a grant (revoked),
a policy (dropped), a user or a group (dropped, after the manifest's own revocations).
PostgreSQL refuses to drop a role that still owns objects or holds privileges. Leaving an entry
out of a manifest removes nothing, group memberships are only ever added, and workspaces,
collections and fields are never dropped: use SQL for those.
