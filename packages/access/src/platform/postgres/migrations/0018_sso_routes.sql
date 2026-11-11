-- The routes of the logins (spec §3.13).
--
-- A domain of addresses, and an address of its own, name the tenant of
-- a login and the provider the login signs in at. A route is a hint that
-- the platform proves before it routes anything: a route that is not
-- verified routes nothing, and the login of an address that names no
-- route goes on with the default tenant of the platform (§5.2.2).
--
-- The key of a route is its kind and its key: a domain is `[a-z0-9.-]`
-- and an address is an address, and the two never collide.

create table sso_routes (
  id uuid primary key default gen_random_uuid(),
  -- The kind of the key of the route: a domain of addresses, or one
  -- address of its own.
  kind text not null default 'domain' check (kind in ('domain', 'address')),
  -- The key of the route: the domain, or the address.
  key text not null,
  -- The tenant the route names.
  tenant_id uuid not null references tenants (id) on delete cascade,
  -- The provider of the tenant the login signs in at. `null` is the
  -- default provider of the tenant.
  provider_slug text,
  -- The state of the route: `pending` until it is proven, `verified`
  -- when it is, and `rejected` when it is refused.
  status text not null default 'pending'
    check (status in ('pending', 'verified', 'rejected')),
  -- The method of the verification: the DNS record of the owner of the
  -- domain, or the operator of the platform.
  verification text check (verification is null or verification in ('dns', 'operator')),
  -- The token the owner of the domain publishes to prove that it owns
  -- it.
  challenge text,
  -- The moment the route was verified, and the operator that verified it.
  verified_at timestamptz,
  verified_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sso_routes_key unique (kind, key)
);

-- The routes are scoped like the other tables of the model: a statement
-- in the scope of a tenant sees the routes of that tenant and nothing
-- else (spec §3.10).
alter table sso_routes enable row level security;
alter table sso_routes force row level security;

create policy sso_routes_tenant_scope on sso_routes
  using (
    current_setting('access.scope', true) = 'platform'
    or (
      current_setting('access.scope', true) = 'tenant'
      and tenant_id::text = nullif(current_setting('access.tenant_id', true), '')
    )
  );

-- The tenants that are already there carry the domain of their addresses:
-- the operator of the platform wrote it, and the operator of the platform
-- is the verification of a domain. The routes of the domains that are
-- there are verified, and the logins that named them go on as they did.
insert into sso_routes (kind, key, tenant_id, status, verification, verified_at)
select 'domain', email_domain, id, 'verified', 'operator', now()
from tenants
where email_domain is not null;
