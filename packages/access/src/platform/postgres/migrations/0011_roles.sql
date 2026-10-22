-- The roles of the tenants (spec §3.6).
--
-- A role is a named set of permissions of a tenant. A grant may name a
-- role instead of a permission: the grant then holds for every
-- principal that holds the role, and the permissions it gives are the
-- ones the role holds.
--
-- A role may name another role: the permissions of the named role are
-- the permissions of the naming role, and the naming is transitive. A
-- cycle is refused by the schema: a role that names itself, directly or
-- through other roles, would expand forever, and the decision of a
-- principal would never answer.
--
-- The role belongs to a tenant, and the permissions it names are the
-- ones of the catalogue of the platform and the ones of the tenant.

create table roles (
  id uuid primary key default gen_random_uuid(),
  -- The tenant of the role.
  tenant_id uuid not null references tenants (id) on delete cascade,
  -- The name of the role, the name the operator uses.
  key text not null check (key ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  -- The name shown to a human.
  display_name text,
  -- What the role is for.
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roles_tenant_key unique (tenant_id, key),
  -- The pair is unique so a grant can carry the tenant of its role in a
  -- foreign key.
  constraint roles_id_tenant unique (id, tenant_id)
);

-- The permissions a role names.
create table role_permissions (
  tenant_id uuid not null references tenants (id) on delete cascade,
  role_id uuid not null,
  permission_id uuid not null references permissions (id) on delete cascade,
  primary key (role_id, permission_id),
  constraint role_permissions_role foreign key (role_id, tenant_id)
    references roles (id, tenant_id) on delete cascade
);

-- The roles a role names: the nesting of the roles.
create table role_roles (
  tenant_id uuid not null references tenants (id) on delete cascade,
  -- The role that names.
  role_id uuid not null,
  -- The role that is named: its permissions are the ones of the role
  -- that names it.
  child_role_id uuid not null,
  primary key (role_id, child_role_id),
  -- A role does not name itself: the constraint is the first half of
  -- the refusal of a cycle, and the trigger is the second.
  constraint role_roles_no_self check (role_id <> child_role_id),
  constraint role_roles_parent foreign key (role_id, tenant_id)
    references roles (id, tenant_id) on delete cascade,
  constraint role_roles_child foreign key (child_role_id, tenant_id)
    references roles (id, tenant_id) on delete cascade
);

-- The code of the failure of the nesting of the roles.
--
-- It is the code of the check of a constraint of PostgreSQL, with the
-- name of the constraint of the access service: the application turns it
-- into the `409` of a role that names itself (spec §10.9).
create or replace function access_check_role_cycles() returns trigger
language plpgsql as $$
begin
  if exists (
    with recursive reachable(role_id) as (
      select new.child_role_id
      union
      select rr.child_role_id
        from role_roles rr
        join reachable r on rr.role_id = r.role_id
    )
    select 1 from reachable where role_id = new.role_id
  ) then
    raise exception 'the role % names a role that names it back', new.role_id
      using errcode = '23514', constraint = 'role_roles_no_cycle';
  end if;
  return null;
end;
$$;

-- The check is deferred to the end of the transaction: a role that names
-- another role and is named by it in the same transaction is seen whole.
create constraint trigger role_roles_no_cycle
  after insert or update on role_roles
  deferrable initially deferred
  for each row execute function access_check_role_cycles();

-- A grant names a permission or a role, and not both.
--
-- The permission of a grant of a role is the set the role holds: the
-- grant says that the subject holds the role on the scope, and the
-- decision expands the role.
alter table grants alter column permission_id drop not null;
alter table grants add column role_id uuid;
alter table grants add constraint grants_one_kind
  check ((permission_id is not null)::int + (role_id is not null)::int = 1);
alter table grants add constraint grants_role_tenant
  foreign key (role_id, tenant_id) references roles (id, tenant_id) on delete cascade;

-- The unique index uses a coalesce for the same reason as the one of
-- the permissions: a grant of "every workspace" and a grant of "the
-- workspace ''" have to be two different rows, and a grant of a
-- permission and a grant of a role have to be two different rows too.
drop index grants_live_scope;
create unique index grants_live_scope
  on grants (tenant_id, user_id,
    coalesce(permission_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(role_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(workspace_id, ''), coalesce(route_id, ''))
  where revoked_at is null;

drop index grants_live_group_scope;
create unique index grants_live_group_scope
  on grants (tenant_id, group_id,
    coalesce(permission_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(role_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(workspace_id, ''), coalesce(route_id, ''))
  where revoked_at is null and group_id is not null;

-- The live grants of a role: the decision reads them with the role, and
-- the index is the one of the role.
create index grants_role_live on grants (role_id)
  where revoked_at is null and role_id is not null;

-- The permissions of a role, and the roles a role names.
create index role_permissions_permission on role_permissions (permission_id);
create index role_roles_child on role_roles (child_role_id);

-- The isolation of the tenants reaches the new tables as well (spec §3.10).
--
-- The **empty** scope is the scope of the platform: a policy that reads
-- `current_setting(…) is null` treats every row as invisible on a
-- connection that has run a scoped statement, and the write of a role
-- is refused by the policy of the table (spec §3.10).
alter table roles enable row level security;
alter table roles force row level security;
create policy roles_tenant_scope on roles
  using (
    nullif(current_setting('access.tenant_id', true), '') is null
    or tenant_id::text = current_setting('access.tenant_id', true)
  );

alter table role_permissions enable row level security;
alter table role_permissions force row level security;
create policy role_permissions_tenant_scope on role_permissions
  using (
    nullif(current_setting('access.tenant_id', true), '') is null
    or tenant_id::text = current_setting('access.tenant_id', true)
  );

alter table role_roles enable row level security;
alter table role_roles force row level security;
create policy role_roles_tenant_scope on role_roles
  using (
    nullif(current_setting('access.tenant_id', true), '') is null
    or tenant_id::text = current_setting('access.tenant_id', true)
  );
