-- The scope of the tables that were created after the scope became
-- explicit (spec §3.10).
--
-- The scope of a statement is written in two settings: `access.scope`
-- names the kind of the scope and `access.tenant_id` names the tenant
-- of it. A statement in the scope of a **tenant** sees the rows of that
-- tenant and nothing else, and a statement in the scope of the
-- **platform** sees the whole platform. The scope of the platform is
-- asked for by name, and a statement that does not ask for it sees
-- nothing.
--
-- The tables of the providers and of the local credentials were created
-- with the policy of the tables that came before the scope became
-- explicit: they read `access.tenant_id` alone, and they treat the
-- absence of the setting as the scope of the platform. The setting is
-- never absent on the connection of a pool: PostgreSQL leaves the
-- **placeholder** of the setting on the session, and the placeholder is
-- empty. A policy that reads `current_setting(…) is null` therefore
-- treats every row of the platform as invisible on a connection that has
-- run a scoped statement, and the row of the provider is invisible to
-- the statement of the platform that reads its secret.
--
-- The secret of the provider of a tenant is read in the scope of the
-- platform, and the login of the tenant exchanges its code with the
-- secret it reads there. A secret that is not readable is an empty
-- secret, and the provider refuses the client: every login of the
-- tenant is refused at the exchange of the code, with a refusal that
-- names the client and not the secret.
--
-- The policies are the ones of the other tables of the model: the rows
-- of the platform are seen by the statement that asks for the scope of
-- the platform, and the rows of a tenant are hidden from every other
-- statement.

drop policy tenant_providers_tenant_scope on tenant_providers;
create policy tenant_providers_tenant_scope on tenant_providers
  using (
    current_setting('access.scope', true) = 'platform'
    or (
      current_setting('access.scope', true) = 'tenant'
      and tenant_id::text = nullif(current_setting('access.tenant_id', true), '')
    )
  );

drop policy local_credentials_tenant_scope on local_credentials;
create policy local_credentials_tenant_scope on local_credentials
  using (
    current_setting('access.scope', true) = 'platform'
    or (
      current_setting('access.scope', true) = 'tenant'
      and tenant_id::text = nullif(current_setting('access.tenant_id', true), '')
    )
  );
