# Applying changes to a deployment

`bun run cli apply <deployment> FILE... [--dry-run]` brings a deployment's database to what one
or more JSON manifests describe: users, groups, workspaces, collections, grants and row policies.
Everything is native PostgreSQL, done with the operator's own rights, in one transaction. Either
every file is applied or nothing is.

```bash
bun run cli apply local --dir=examples/newsroom --dry-run   # what would change
bun run cli apply local --dir=examples/newsroom
bun run cli apply local team.json
```

Each change is printed, then a count of what changed and what was already in place. Applying
the same manifest again changes nothing. `--dry-run` runs every statement and rolls back, so
its report is PostgreSQL's answer, including any permission it would refuse.

`--example=NAME` applies an example of the checkout, the folder `examples/NAME`. The folder's
`platform.json` names what it applies, each file relative to the folder:

```json
{
  "apply": {
    "models": "apply/models.ts",
    "migration": "apply/migration.sql",
    "demo": "apply/demo.sql"
  }
}
```

`models` is required and the two SQL files are the folder's to leave out. Any folder whose
`platform.json` has `apply` is applied this way, with `--dir`: the site of a deployment as
much as an example of the checkout. The newsroom example keeps its three in
`examples/newsroom/apply/`, and they are applied in this order:

| File            | What it holds                                                                                                                    | When it runs                                          |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `models.ts`     | The schema, as a manifest: groups, people, workspaces, grants, row policies, and what each item says of itself                   | Every time, with the operator's own rights            |
| `migration.sql` | What a manifest cannot say: the edge cases, written to be run again. The newsroom's hands its metadata to the workspaces' owners | Every time, beside the server                         |
| `demo.sql`      | Records, and the history they would have                                                                                         | Once, beside the server: when the workspaces are made |

The two SQL files are the server's own superuser's: they hand rows to the people who would
have written them and write the revisions a trigger would have. `deploy local up` runs them
beside the server; an operator who applies a folder with a token applies `models.ts` and is
told the other two were not run. `demo.sql` is never run into workspaces that were already
there.

No file names an administrator of its own. What a deployment says of itself is passed to all
three as variables, and each is named where it is used:

| Variable | What it is                                                                                                         | In `models.ts` | In the SQL files                      |
| -------- | ------------------------------------------------------------------------------------------------------------------ | -------------- | ------------------------------------- |
| `admin`  | The deployment's administrator: PLATFORM_ADMIN, or `admin` on PLATFORM_DOMAIN. Without either, `admin@example.com` | `admin`        | `current_setting('deployment.admin')` |

`models.ts` exports the manifest as a function of them, `export default ({ admin }) => ({ format: 1, … })`,
and the SQL files read each as a setting of the transaction they run in. A models file that
uses none may be JSON: the manifest itself. A new variable is added in one place,
`DeploymentVariables` in `packages/core/src/manifest.ts`, and is then there in all three files. The
folder is applied before the files named beside it, so a manifest may name the folder's
administrator as the owner of a workspace.

`--administrator` makes the deployment's administrator and nothing else: what a deployment
with no site, or whose site applies nothing, is given, so that there is somebody to sign in as.

## Deployments

| Deployment | Database                                                                | Operator       |
| ---------- | ----------------------------------------------------------------------- | -------------- |
| `local`    | The Compose stack: 127.0.0.1, POSTGRES_PORT (5432), database `platform` | PGTOKEN[_FILE] |
| `k8s`      | DATABASE_HOST/PORT/NAME/SSL, as for `migrate`                           | PGTOKEN[_FILE] |

The operator is a person: sign in and pass the token,
`PGTOKEN=$(bun run --silent cli token) bun run cli apply local team.json`. No login has a
password, so there is no other way to say who you are. PostgreSQL then decides what you may
change: you manage the roles you created and the workspaces you own. On the local stack,
`deploy local up` has already applied what the deployment's site applies beside the server
(or `--administrator`, when it applies nothing), so the deployment's
administrator (PLATFORM_ADMIN: admin@localhost unless another is named) is there to sign in as.

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

| Entry                                                                  | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `groups[]`                                                             | A NOLOGIN role: `name`.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `users[]`                                                              | A LOGIN role: `name` (the email the person signs in with), `groups`, `login` (false disables it) and `admin`. Every user joins `platform_users`, which is what lets it connect.                                                                                                                                                                                                                                                                                |
| `users[].admin`                                                        | true gives the bootstrap administrator's rights (CREATEROLE, CREATE on the database, admission to `platform_users`); false withdraws them; omitted leaves them alone.                                                                                                                                                                                                                                                                                          |
| `users[].connections`                                                  | The most sessions the role may hold at once on the whole server (CONNECTION LIMIT): PostgreSQL counts them itself, across every relay. -1 is no limit; omitted leaves it alone.                                                                                                                                                                                                                                                                                |
| `users[].admits`                                                       | The groups the user may admit others to and take them out of: PostgreSQL's ADMIN OPTION. The user becomes a member of each. It is given and never withdrawn here.                                                                                                                                                                                                                                                                                              |
| `workspaces[]`                                                         | A schema: `slug`, optional `owner`, and its `collections`, `relations`, `grants` and `policies`. With an owner, everything inside is created as that role, so it owns it.                                                                                                                                                                                                                                                                                      |
| `workspaces[].metadata`, `collections[].metadata`, `fields[].metadata` | What the item says of itself, as rows of `platform.item_metadata`: a key and any JSON value. `display_name`, `icon` and `color` are the ones the interface reads; any other key is kept. Written as the workspace's owner. A key that is already there is left alone, whatever the manifest says: its owner may have changed it since. A field's `views` and `renderers` are said in their own entries.                                                        |
| `collections`, `relations`                                             | The model format of `deploy/models/crm.json`. Additive: missing collections, fields and foreign keys are created; existing columns are never retyped. A foreign key is indexed when it is made, because PostgreSQL makes no index for the key it does not make.                                                                                                                                                                                                |
| `relations[]`                                                          | A foreign key between two collections of the workspace: `collection`, `field`, `related`, and `on_delete` (`restrict`, `cascade` or `set_null`). `state: 'absent'` drops the key instead of making it; the column and the values in it stay. A relation named here is said once here, and wins over the same field's own `relation`. A key that points elsewhere, or that goes another way, is brought to what is said, and the change is named in the report. |
| `collections[].note`                                                   | What the collection is for: the comment on the table. Set to what the manifest says on every apply.                                                                                                                                                                                                                                                                                                                                                            |
| `collections[].row_security`                                           | false is a collection that asks for no row policy, read whole by everybody who may read it; true asks for them again. Omitted leaves it alone: a new collection asks for them.                                                                                                                                                                                                                                                                                 |
| `collections[].unique`                                                 | Columns that are unique together: a list of lists, each of two columns or more. A join table is made of two keys and one such group — the pair that is one link. A link may carry columns of its own beside the two keys: what it is worth, or when it began. The keys are written by the interface and the payload by the database, so a payload column must be nullable or hold a default of its own.                                                        |
| `fields[].type`                                                        | The type of the column: one of the platform's own (`text`, `integer`, `bigint`, `decimal`, `float`, `boolean`, `uuid`, `date`, `time`, `timestamp`, `json`), `string` for a text, `m2o` for a relation, or any type the database holds — named with its schema, as `public.geometry`.                                                                                                                                                                          |
| `fields[].modifiers`                                                   | The modifiers the type takes: `["Point", "4326"]` for a geometry.                                                                                                                                                                                                                                                                                                                                                                                              |
| `fields[].views`                                                       | Where the field appears: `list`, `record` and `filter`, and any view of your own. A field that says nothing is given the platform's default views. See [views](views.md).                                                                                                                                                                                                                                                                                      |
| `fields[].renderers`                                                   | How the field's values are drawn, in each of those situations: the name of a renderer, or the name of one and the options it takes. A field that says nothing is drawn as the platform draws it. See [renderers](renderers.md).                                                                                                                                                                                                                                |
| `grants[]`                                                             | `to` (a role, a list, or `public`), `privileges`, and optionally `collection` and `columns`. Without a collection the grant is on the workspace (`usage`, `create`). Columns limit select, insert, update and references; delete always covers the table. `all` is every privilege at once, and cannot be limited to columns.                                                                                                                                  |
| `policies[]`                                                           | `collection`, `name`, `for` (all, select, insert, update, delete), `to`, `using`, `check`, `restrictive`. An existing policy of that name is replaced. A policy for `insert` takes no `using`, and one for `select` or `delete` takes no `check`. An expression is written into the statement as it is, so it must be one expression: a semicolon, a comment, or a parenthesis or quotation left unbalanced is refused.                                        |

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
