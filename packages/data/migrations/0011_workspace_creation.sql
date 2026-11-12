-- The creation of a workspace by a tenant (spec §6.1 and §9.10).
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

grant insert on platform.workspaces to data_runtime;

-- The row that is created is read back: the answer of the service names
-- the workspace it created. The read is bounded by the policy of the
-- registry, which holds the rows of the tenant of the scope.
grant select (id, tenant_id, status, slug, display_name) on platform.workspaces to data_runtime;
