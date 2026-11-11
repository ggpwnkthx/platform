-- The providers of a tenant (spec §3.11).
--
-- A tenant signs its people in at one or more providers. The row of the
-- tenant carries the registration of its **default** provider — the one the
-- administration writes — and every provider of the tenant has a row here:
-- the login names the provider it signs in at, and the principal it creates
-- belongs to that provider.
--
-- The row of the default provider is written by the same statements that
-- write the tenant: the default provider of a tenant and the tenant itself
-- are one change, and a tenant whose provider row is missing is a tenant
-- whose logins are refused.
--
-- The slug of a provider is the handle a login names, and it never changes:
-- a principal carries the slug of the provider it was created at.

create table tenant_providers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  -- The kind of the provider: an OpenID Connect provider, or the local
  -- provider of the platform (spec §5.4).
  kind text not null default 'oidc' check (kind in ('oidc', 'local')),
  -- The name of the provider inside its tenant.
  slug text not null check (slug ~ '^[a-z0-9-]{2,63}$'),
  -- The name shown to a human.
  display_name text not null,
  -- A disabled provider is never asked to sign anybody in.
  enabled boolean not null default true,
  -- The registration of an OpenID Connect provider.
  issuer text,
  idp_client_id text,
  -- The client secret of Access at the provider, encrypted at rest (spec §4.3).
  idp_client_secret bytea,
  idp_redirect_uri text,
  idp_scopes text[] not null default array['openid', 'email', 'profile'],
  idp_algorithms text[] not null default array['RS256'],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_providers_tenant_slug unique (tenant_id, slug),
  -- The registration of an OpenID Connect provider is complete: a
  -- provider that is named but not registered signs nobody in.
  constraint tenant_providers_oidc_registration check (
    kind = 'local'
    or (issuer is not null and idp_client_id is not null and idp_client_secret is not null
        and idp_redirect_uri is not null)
  )
);

-- The isolation of the tenants, enforced by the database (spec §3.10): a
-- statement that is scoped to a tenant sees the providers of that tenant
-- and nothing else.
alter table tenant_providers enable row level security;
alter table tenant_providers force row level security;

create policy tenant_providers_tenant_scope on tenant_providers
  using (
    current_setting('access.tenant_id', true) is null
    or tenant_id::text = current_setting('access.tenant_id', true)
  );

-- Every tenant gets the provider its row already describes: the
-- registration of the tenant is the registration of its default provider,
-- and the default provider is the one the logins of the tenant use.
insert into tenant_providers (tenant_id, kind, slug, display_name, enabled, issuer,
  idp_client_id, idp_client_secret, idp_redirect_uri, idp_scopes, idp_algorithms)
select id, 'oidc', 'default', display_name, enabled, idp_issuer, idp_client_id,
  idp_client_secret, idp_redirect_uri, idp_scopes, idp_algorithms
from tenants;

-- The mapping key of a principal is the triple `(tenant, provider, subject)`
-- (spec §6.2): two providers of a tenant hand out the same `sub`, and the
-- subject alone does not name a principal any more.
--
-- The slug of the provider is the one of the default provider of the tenant:
-- every principal that exists was created at it.
alter table users add column provider_slug text not null default 'default';

alter table users drop constraint users_tenant_subject;

alter table users add constraint users_tenant_provider_subject
  unique (tenant_id, provider_slug, external_subject);
