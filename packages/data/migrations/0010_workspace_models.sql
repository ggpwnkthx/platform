-- The model of the workspaces (spec §7.7).
--
-- The deployment holds the physical model: the tables of its migrations
-- and the manifest that names them. A workspace holds its own logical
-- model: the overlay that says how the collections of the deployment
-- look for that workspace — the labels, the constraints, the relations
-- and the fields that the model does not hold.
--
-- The model is applied to the manifest of the deployment when the
-- catalog of a workspace is resolved, and it is applied in realtime: a
-- change of the model is the change of the model of the workspace for
-- every request that follows it.
--
-- The overlay never creates a table and never alters one: the tables of
-- the deployment are the tables of the deployment, and a field that the
-- overlay adds is a field that the deployment already holds.

create table if not exists platform.workspace_models (
  workspace_id uuid not null,
  tenant_id uuid not null,
  version integer not null default 1 check (version > 0),
  model jsonb not null default '{"version":1,"collections":{}}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text not null default '',
  primary key (workspace_id),
  constraint workspace_models_scope_fk
    foreign key (workspace_id, tenant_id)
    references platform.workspaces (id, tenant_id) on delete cascade
);

-- The isolation of the table of the models: the model of a workspace is
-- the model of that workspace and of no other one.
alter table platform.workspace_models enable row level security;
alter table platform.workspace_models force row level security;

create policy workspace_models_scope on platform.workspace_models
  using (
    tenant_id = nullif(current_setting('data.tenant_id', true), '')::uuid
    and workspace_id = nullif(current_setting('data.workspace_id', true), '')::uuid
  )
  with check (
    tenant_id = nullif(current_setting('data.tenant_id', true), '')::uuid
    and workspace_id = nullif(current_setting('data.workspace_id', true), '')::uuid
  );

-- The registry of the workspaces reads the model of a workspace with
-- the workspace itself: the model is the configuration of a workspace
-- and not business data.
create policy workspace_models_registry_read on platform.workspace_models
  for all
  to data_registry
  using (true)
  with check (false);

-- The role of the api reads the model of the workspace of the scope of
-- its transaction, and it writes it: the administrator of a workspace
-- writes the model of that workspace.
grant select on platform.workspace_models to data_runtime;
grant insert, update on platform.workspace_models to data_runtime;
grant select on platform.workspace_models to data_registry;

-- The administrator of a workspace registers the collections of the
-- deployment that it serves: the registry of the catalog is the
-- configuration of the workspace, and the administrator of the
-- workspace writes it. The isolation of the table is the policy of the
-- scope, which the role of the api already holds.
grant insert, update, delete on platform.collection_registry to data_runtime;
