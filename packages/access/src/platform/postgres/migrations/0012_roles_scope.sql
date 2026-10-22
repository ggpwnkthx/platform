-- The empty scope is the scope of the platform, in the tables of the
-- roles too (spec §3.10).
--
-- The policies of the roles were written with the form the tables had
-- before the migration that made the empty scope the scope of the
-- platform: a policy that reads `current_setting(…) is null` treats
-- every row of the platform as invisible on a connection that has run a
-- scoped statement — the setting leaves its **placeholder** on the
-- session — and the write of a role is refused by the policy of the
-- table. The policies are rewritten with the form of the other tables
-- of the domain.
--
-- The migration of the roles carries the same form, so a machine that
-- installs the schema from the beginning does not need this one. The
-- machines that already applied it need it: a migration is applied
-- once, and the policy it wrote is the one the tables carry.

drop policy roles_tenant_scope on roles;
create policy roles_tenant_scope on roles
  using (
    nullif(current_setting('access.tenant_id', true), '') is null
    or tenant_id::text = current_setting('access.tenant_id', true)
  );

drop policy role_permissions_tenant_scope on role_permissions;
create policy role_permissions_tenant_scope on role_permissions
  using (
    nullif(current_setting('access.tenant_id', true), '') is null
    or tenant_id::text = current_setting('access.tenant_id', true)
  );

drop policy role_roles_tenant_scope on role_roles;
create policy role_roles_tenant_scope on role_roles
  using (
    nullif(current_setting('access.tenant_id', true), '') is null
    or tenant_id::text = current_setting('access.tenant_id', true)
  );
