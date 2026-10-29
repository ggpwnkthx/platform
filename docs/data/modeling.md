# Modeling

How to add and shape the data a deployment serves: declare a collection in a migration and the manifest, write its policies, choose which workspaces serve it, publish a workspace's own policy bundle, and adjust a workspace's model through the API. It is for developers and operators who own a deployment's schema.

## Three layers

| Layer | What it holds | Who changes it | How it takes effect |
| --- | --- | --- | --- |
| Physical model | Tables from reviewed migrations, and the manifest that names them ([spec §7.1](spec.md#71-managed-schema)) | The deployment, in a release | New processes; readiness refuses drift ([spec §7.4](spec.md#74-schema-lifecycle)) |
| Workspace catalog | The collections a workspace serves and the policy bundle that applies to it ([spec §7.5](spec.md#75-workspace-catalog)) | An operator, with the `collection` and `policy` commands | The next request |
| Workspace model | Labels, constraints, relations and served fields of the workspace's collections ([spec §7.6](spec.md#76-workspace-model)) | A holder of `data.model.write`, through the API | The next request |

Nothing in the catalog or the model creates or alters a table. A new column or table always starts with a migration.

## Add a collection

1. Write a migration that creates the table with its columns, the scope columns `tenant_id` and `workspace_id`, the server-maintained fields, composite tenant and workspace foreign keys for its relations, and forced row-level security ([spec §6.4](spec.md#64-postgresql-isolation)). The collections of this repository are in `migrations/0003_collections.sql`. A table that no migration describes is not part of the deployment.
2. Add the indexes the collection's filters and sorts need, in the same migration. A descending sort needs an index declared `desc nulls last` ([decision 3](decisions.md#3-page-order-is-the-databases-order)).
3. Apply it as the schema owner: `DATA_OWNER_DATABASE_URL=... bun run migrate`.
4. Declare the collection in `manifests/schema.json` ([Collection manifest](configuration.md#collection-manifest)).
5. Write its policies in `manifests/policies.json` ([Write policies](#write-policies)).
6. Regenerate the client types with `bun run scripts/dev/generate-client.ts`; `--check` fails on a stale file ([Client](client.md#collection-types)).
7. Release the new manifest and bundle. Both are fixed for the life of a process, so the change reaches a replica only when it restarts. Drain old replicas first when the change is not backward compatible.
8. If a workspace has registered collections, register the new one for it ([Choose the collections a workspace serves](#choose-the-collections-a-workspace-serves)). A workspace that registered nothing serves it automatically.

## Keep a version history

1. Add `"versions": { "table": "<schema>.<table>" }` to the collection in the manifest.
2. Create that table in a migration. It mirrors the collection table (same column names and types) and adds `operation`, `changed_fields`, `restored_from`, `superseded_at` and `superseded_by` ([spec §11.6](spec.md#116-record-version-history)). `migrations/0008_record_versions.sql` is the example for `articles`, with an index per record and one for retention.
3. Set the retention period with `DATA_VERSIONS_RETENTION_DAYS` ([Operations](operations.md#retention)).

## Make a collection searchable

1. List the searchable fields and the text-search configuration under `search` in the manifest.
2. Create the search index in a migration; `migrations/0007_search.sql` is the example. An integration test fails when the search plan does not use the index ([decision 23](decisions.md#23-search-is-a-query-parameter-not-a-filter-operator)).
3. Make every searchable field one the caller may filter and sort by, or search answers `403 FORBIDDEN` ([spec §9.9](spec.md#99-aggregates-and-search)).

## Write policies

A policy grants one permission key one action on one collection, for the rows its `where` matches and the fields it lists. The format is in [Policy bundle](configuration.md#policy-bundle); the composition rules are in [spec §8](spec.md#8-data-authorization). `manifests/policies.json` holds this repository's bundle, for example:

```json
{
  "id": "read-articles-own",
  "permission": "content.author",
  "collection": "articles",
  "action": "read",
  "where": { "created_by": { "_eq": "$principalId" } },
  "fields": ["title", "body", "status", "created_at", "updated_at"]
}
```

When you write a bundle:

1. Give every role that edits records a read policy too. An update or delete needs one, and an update policy never grants read.
2. Put every field a write may touch, its `where` and its `check` in one policy. Data never combines two policies into one write.
3. Use the same `where` and `check` for an update that must keep a row inside the caller's reach, so a caller cannot move a record out of it.
4. Keep the fields that clients filter and sort by in every read policy of the collection. Only that intersection is usable in a filter or sort.
5. List relations (such as `category`) in a read policy's fields to let callers expand them.
6. Grant `data.audit.read`, `data.model.read` and `data.model.write` in Access, separately from record permissions.

## Choose the collections a workspace serves

A workspace that registered no collection serves every collection of the manifest. Once it registers one, it serves exactly its registered, enabled collections. As the schema owner:

```bash
export DATA_OWNER_DATABASE_URL=...
WS=22222222-2222-4222-8222-222222222222
bun run collection -- register --workspace $WS --collection articles
bun run collection -- enable --workspace $WS --collection articles
bun run collection -- disable --workspace $WS --collection articles
bun run collection -- list --workspace $WS
```

A holder of `data.model.write` can also register a collection through the API with `POST /ws/{workspaceId}/v1/model/collections` ([API](api.md#register-a-collection)).

## Publish a workspace bundle

A workspace uses the last bundle published for it, or the deployment bundle when none was published.

```bash
bun run policy -- publish --workspace $WS --file policies.json
bun run policy -- list --workspace $WS
bun run policy -- show --workspace $WS --version 1
```

Publication validates the bundle against the deployment manifest and writes nothing when it names an unknown collection or field. Published versions are immutable, and an unusable bundle fails closed ([spec §8.6](spec.md#86-workspace-bundle)). A bundle says what a permission grants; Access says who holds the permission.

## Change a workspace model

The model endpoints let a workspace administrator relabel collections, change field constraints, hide fields and add relations without a release. They are listed in [API: Model](api.md#model).

1. Read the model with `GET /ws/{workspaceId}/v1/model`; it also lists the deployment collections the workspace does not serve yet.
2. Send the change. A field must name a column of the collection's table, and a field's type always follows its column.
3. On `409 CONFLICT`, read the model again and reapply the change: someone changed it in between.

A model change never touches the audit and never grants a capability.
