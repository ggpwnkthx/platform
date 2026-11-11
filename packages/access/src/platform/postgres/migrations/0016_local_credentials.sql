-- The credentials of the local providers (spec §3.12).
--
-- A local provider holds its own identities: the caller signs in with an
-- e-mail and a password, and Access checks the password against the
-- verifier of the row. The verifier is the argon2id hash of the
-- password, and it is never returned in clear: the administration lists
-- the credentials, and it never answers a verifier.
--
-- The credential is the identity of the caller: the `sub` of a local
-- provider is the id of the row, and the mapping key of a principal is
-- the triple `(tenant, provider, subject)` (spec §6.2).
--
-- The row also holds the count of the failures and the moment the
-- credential is locked until: a password that is guessed is a password
-- that is tried again, and the lock is what stops the guessing.

create table local_credentials (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  -- The provider the credential belongs to: it is a local one, and it
  -- belongs to the tenant of the credential.
  provider_id uuid not null references tenant_providers (id) on delete cascade,
  -- The address the caller signs in with. It is the name of the account,
  -- not its key: the key of the mapping is the id of the row.
  email text not null,
  -- The argon2id hash of the password.
  password_hash text not null,
  -- A disabled credential signs nobody in.
  status text not null default 'active' check (status in ('active', 'disabled')),
  -- The number of the failed sign-ins since the last success.
  failed_attempts integer not null default 0,
  -- The moment the credential is locked until, when it is locked.
  locked_until timestamptz,
  -- The moment the password was written.
  password_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint local_credentials_tenant_email unique (tenant_id, email),
  -- The credential belongs to a provider of its own tenant.
  constraint local_credentials_tenant_provider unique (id, tenant_id, provider_id)
);

-- The isolation of the tenants, enforced by the database (spec §3.10).
alter table local_credentials enable row level security;
alter table local_credentials force row level security;

create policy local_credentials_tenant_scope on local_credentials
  using (
    current_setting('access.tenant_id', true) is null
    or tenant_id::text = current_setting('access.tenant_id', true)
  );

-- The credentials of a tenant are read with their provider: the
-- administration lists the credentials of a provider, and the login
-- reads the one of an address.
create index local_credentials_by_provider on local_credentials (tenant_id, provider_id);
