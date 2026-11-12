-- The creation of a workspace by a tenant (spec §6.1 and §9.11).
--
-- The registry of the workspaces is written by the owner of the schema:
-- the operator command that creates a workspace is not a request of a
-- tenant. The creation of a workspace is a request of a tenant now: a
-- caller that holds the permission `data.workspace.create` asks for a
-- workspace of its tenant, and the role of the api writes the row.
--
-- The write is the one statement of the role of the api on the registry,
-- and the isolation of the registry holds it: the row carries the tenant
-- of the caller, the scope of the transaction carries the same tenant,
-- and the policy of the registry refuses a row that names another one.
--
-- The role of the api reads nothing of the registry: it writes the
-- columns of a row, and it knows the values it wrote. The narrow reader
-- keeps its columns, and the row that was created is read with it.

grant insert (id, tenant_id, slug, display_name, status) on platform.workspaces to data_runtime;
