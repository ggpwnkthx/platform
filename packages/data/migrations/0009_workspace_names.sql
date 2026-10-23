-- The names of the workspaces (spec §6.1).
--
-- The registry of the workspaces holds the name of every workspace: the
-- slug it is called by and the name it is shown under. The narrow
-- bootstrap reader reads them with the identity of the workspace: the
-- console shows the name of the workspaces of the caller, and it reads
-- it from the service that owns the registry, like every other caller.
--
-- The reader stays a narrow reader: it may select five columns of one
-- table, and it may only look a workspace up by its exact identifier.
-- The names of a workspace are not a secret of the deployment: they
-- are labels of a resource the reader already reaches.

grant select (id, tenant_id, status, slug, display_name) on platform.workspaces to data_registry;
