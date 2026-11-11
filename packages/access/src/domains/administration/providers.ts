/**
 * The providers of the administration (spec §10.16).
 *
 * A provider of a tenant is named by its slug, and the slug never
 * changes: a principal carries it (§6.2). The call is an upsert on the
 * pair `(tenant, slug)`.
 *
 * The **default** provider of a tenant is not administered here: its
 * registration is the registration of the tenant, and it is written with
 * it (§3.11). A call that names it is refused, and the tenant is changed
 * with the call that changes the tenant.
 */

import type { AdminScope } from './credentials'
import { AdministrationError } from './errors'
import type { AdministrationOptions } from './options'
import type {
  AuditContext,
  Provider,
  ProviderFilter,
  ProviderPage,
  ProviderRegistration,
} from './ports'
import { change, type AuditEntry } from './audit'
import { refuseOutsideScope, statementScope } from './scope'
import { DEFAULT_PAGE_SIZE, DEFAULT_PROVIDER_SLUG, MAX_PAGE_SIZE, wholeNumber } from './values'

/**
 * Creates a provider of a tenant, or changes the provider of that slug.
 *
 * The slug is the key of the row inside the tenant, and it never changes:
 * a call that names another slug creates another provider.
 *
 * A provider that is created carries a complete registration: the issuer,
 * the client, the secret and the callback are needed, and a registration
 * that names none of them is a registration that creates no provider.
 *
 * A change that names another provider and no secret of it is refused:
 * the secret of a provider belongs to its provider, and the login at the
 * new provider would be refused (§3.11).
 */
export async function upsertProvider(
  options: AdministrationOptions,
  scope: AdminScope,
  registration: ProviderRegistration,
  context: AuditContext
): Promise<{ provider: Provider; created: boolean; audit: AuditEntry }> {
  refuseOutsideScope(scope, registration.tenant)
  if (registration.slug === DEFAULT_PROVIDER_SLUG) {
    throw new AdministrationError(
      'invalid_request',
      'the default provider of a tenant is the registration of the tenant: it is changed with the tenant'
    )
  }

  const tenant = await options.tenants.findBySlug(registration.tenant)
  if (!tenant) {
    throw new AdministrationError('not_found', 'the tenant does not exist')
  }

  const existing = await options.providers.findBySlug(tenant.id, registration.slug)

  if (!existing) {
    // A provider that is created carries a complete registration: the
    // issuer, the client, the secret and the callback are needed, and a
    // registration that names none of them is a registration that creates
    // no provider.
    const missing = (
      [
        ['issuer', registration.issuer],
        ['the client id of Access at the provider', registration.idpClientId],
        ['the secret of Access at the provider', registration.idpClientSecret],
        ['the callback of Access at the provider', registration.idpRedirectUri],
      ] as const
    ).find(([, value]) => value === undefined || value === '')
    if (missing) {
      throw new AdministrationError(
        'invalid_request',
        `a provider is created with its registration: ${missing[0]} is needed`
      )
    }
    const provider = await options.providers.create(
      {
        tenantId: tenant.id,
        slug: registration.slug,
        displayName: registration.displayName ?? registration.slug,
        enabled: registration.enabled ?? true,
        issuer: registration.issuer ?? '',
        idpClientId: registration.idpClientId ?? '',
        idpClientSecret: registration.idpClientSecret ?? '',
        idpRedirectUri: registration.idpRedirectUri ?? '',
        idpScopes: registration.idpScopes ?? ['openid', 'email', 'profile'],
        idpAlgorithms: registration.idpAlgorithms ?? ['RS256'],
      },
      change('provider.created', tenant.slug, context)
    )
    return {
      provider,
      created: true,
      audit: { action: 'provider.created', id: provider.id, tenant: tenant.slug },
    }
  }

  // The secret of a provider belongs to its provider: a change that
  // names another provider and no secret of it is a change that leaves
  // the provider with the secret of the old one, and the login at the
  // new provider is refused.
  if (registration.idpClientSecret === undefined) {
    const otherIssuer = registration.issuer !== undefined && registration.issuer !== existing.issuer
    const otherClient =
      registration.idpClientId !== undefined &&
      registration.idpClientId !== '' &&
      registration.idpClientId !== existing.idpClientId
    if (otherIssuer || otherClient) {
      throw new AdministrationError(
        'invalid_request',
        'the provider changed, and the change names no secret of it: the secret of a provider belongs to its provider'
      )
    }
  }

  const provider = await options.providers.update(
    existing.id,
    {
      ...(registration.displayName !== undefined ? { displayName: registration.displayName } : {}),
      ...(registration.enabled !== undefined ? { enabled: registration.enabled } : {}),
      ...(registration.issuer !== undefined ? { issuer: registration.issuer } : {}),
      ...(registration.idpClientId !== undefined ? { idpClientId: registration.idpClientId } : {}),
      ...(registration.idpClientSecret !== undefined
        ? { idpClientSecret: registration.idpClientSecret }
        : {}),
      ...(registration.idpRedirectUri !== undefined
        ? { idpRedirectUri: registration.idpRedirectUri }
        : {}),
      ...(registration.idpScopes !== undefined ? { idpScopes: registration.idpScopes } : {}),
      ...(registration.idpAlgorithms !== undefined
        ? { idpAlgorithms: registration.idpAlgorithms }
        : {}),
    },
    await statementScope(options, scope),
    change('provider.updated', tenant.slug, context)
  )
  if (!provider) {
    throw new AdministrationError('not_found', 'the provider does not exist')
  }
  return {
    provider,
    created: false,
    audit: { action: 'provider.updated', id: provider.id, tenant: tenant.slug },
  }
}

/** The providers that match a filter, and their number. */
export async function listProviders(
  options: AdministrationOptions,
  scope: AdminScope,
  query: {
    tenant?: string | null
    slug?: string | null
    limit?: string | null
    offset?: string | null
  }
): Promise<ProviderPage> {
  const tenant = query.tenant ? await options.tenants.findBySlug(query.tenant) : null
  if (query.tenant && !tenant) {
    throw new AdministrationError('not_found', 'the tenant does not exist')
  }
  const limit = wholeNumber(query.limit ?? undefined, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE, 'limit')
  const offset = wholeNumber(query.offset ?? undefined, 0, 0, Number.MAX_SAFE_INTEGER, 'offset')
  const filter: ProviderFilter = {
    tenantId: tenant?.id ?? null,
    slug: query.slug?.trim() || null,
    limit,
    offset,
  }
  const page = await options.providers.list(filter)
  // A credential of a tenant sees its own tenant and nothing else.
  if (scope.tenant === null) return page
  return {
    providers: page.providers.filter((provider) => provider.tenant === scope.tenant),
    total: page.total,
    limit: page.limit,
    offset: page.offset,
  }
}

/**
 * Removes a provider of a tenant.
 *
 * The default provider of a tenant is not removed: its registration is
 * the registration of the tenant, and it is written with it.
 *
 * A provider that has principals is not removed either: the principals
 * carry its slug, and a principal that names a provider that does not
 * exist is a principal nobody can sign in with any more.
 */
export async function removeProvider(
  options: AdministrationOptions,
  scope: AdminScope,
  id: string,
  context: AuditContext
): Promise<AuditEntry> {
  const provider = await options.providers.findById(id, await statementScope(options, scope))
  if (!provider) {
    throw new AdministrationError('not_found', 'the provider does not exist')
  }
  // A credential of a tenant may only act for that tenant.
  refuseOutsideScope(scope, provider.tenant)
  if (provider.slug === DEFAULT_PROVIDER_SLUG) {
    throw new AdministrationError(
      'invalid_request',
      'the default provider of a tenant is the registration of the tenant: it is not removed here'
    )
  }
  const principals = await options.principals.countByProvider(provider.tenantId, provider.slug)
  if (principals > 0) {
    throw new AdministrationError(
      'conflict',
      'the provider has principals: they carry its slug, and a principal that names a provider that does not exist is a principal nobody can sign in with'
    )
  }
  const removed = await options.providers.remove(
    id,
    await statementScope(options, scope),
    change('provider.removed', provider.tenant, context)
  )
  if (!removed) {
    throw new AdministrationError('not_found', 'the provider does not exist')
  }
  return { action: 'provider.removed', id, tenant: provider.tenant }
}
