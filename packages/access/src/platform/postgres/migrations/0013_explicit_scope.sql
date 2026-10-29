-- The scope of a statement is explicit (spec §3.10).
--
-- The policies of the tables of the domain used to treat the **absence**
-- of the scope as the scope of the platform: a policy that read
-- `current_setting('access.tenant_id', true) is null` let every row of
-- the platform through. A statement that forgot its scope therefore read
-- every tenant, and the backstop of the isolation was a promise that
-- only the application kept.
--
-- The scope is now written in two settings: `access.scope` names the
-- kind of the scope and `access.tenant_id` names the tenant of it.
--
--   - `access.scope = 'tenant'` and `access.tenant_id = <uuid>`: the
--     statement sees the rows of that tenant and nothing else.
--   - `access.scope = 'platform'`: the statement sees every row of the
--     platform. It is the scope of the registry of the tenants and of the
--     operations of the operator of the platform, and it is asked for by
--     name.
--   - no scope: the statement sees **nothing**. A statement that was not
--     given a scope is not a statement that sees everything: it is a
--     statement that sees nothing, and the database refuses to let it
--     read or write a row of a tenant.
--
-- The isolation of the tenants is still enforced by the application (the
-- keys of the tables carry the tenant and every statement that reads a
-- tenant reads it by its id); the change makes the database agree with
-- the application instead of contradicting it when a statement forgets
-- its scope.

drop policy tenants_tenant_scope on tenants;
create policy tenants_tenant_scope on tenants
  using (
    current_setting('access.scope', true) = 'platform'
    or (
      current_setting('access.scope', true) = 'tenant'
      and id::text = nullif(current_setting('access.tenant_id', true), '')
    )
  );

drop policy users_tenant_scope on users;
create policy users_tenant_scope on users
  using (
    current_setting('access.scope', true) = 'platform'
    or (
      current_setting('access.scope', true) = 'tenant'
      and tenant_id::text = nullif(current_setting('access.tenant_id', true), '')
    )
  );

drop policy permissions_tenant_scope on permissions;
create policy permissions_tenant_scope on permissions
  using (
    current_setting('access.scope', true) = 'platform'
    or (
      current_setting('access.scope', true) = 'tenant'
      and (
        tenant_id is null
        or tenant_id::text = nullif(current_setting('access.tenant_id', true), '')
      )
    )
  );

drop policy grants_tenant_scope on grants;
create policy grants_tenant_scope on grants
  using (
    current_setting('access.scope', true) = 'platform'
    or (
      current_setting('access.scope', true) = 'tenant'
      and tenant_id::text = nullif(current_setting('access.tenant_id', true), '')
    )
  );

drop policy groups_tenant_scope on groups;
create policy groups_tenant_scope on groups
  using (
    current_setting('access.scope', true) = 'platform'
    or (
      current_setting('access.scope', true) = 'tenant'
      and tenant_id::text = nullif(current_setting('access.tenant_id', true), '')
    )
  );

drop policy roles_tenant_scope on roles;
create policy roles_tenant_scope on roles
  using (
    current_setting('access.scope', true) = 'platform'
    or (
      current_setting('access.scope', true) = 'tenant'
      and tenant_id::text = nullif(current_setting('access.tenant_id', true), '')
    )
  );

drop policy role_permissions_tenant_scope on role_permissions;
create policy role_permissions_tenant_scope on role_permissions
  using (
    current_setting('access.scope', true) = 'platform'
    or (
      current_setting('access.scope', true) = 'tenant'
      and tenant_id::text = nullif(current_setting('access.tenant_id', true), '')
    )
  );

drop policy role_roles_tenant_scope on role_roles;
create policy role_roles_tenant_scope on role_roles
  using (
    current_setting('access.scope', true) = 'platform'
    or (
      current_setting('access.scope', true) = 'tenant'
      and tenant_id::text = nullif(current_setting('access.tenant_id', true), '')
    )
  );
