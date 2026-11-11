/**
 * The credentials of the administration (spec §10.17).
 *
 * A credential is the account of a caller at a **local** provider: the
 * address it signs in with, and the password it proves. The operator
 * writes the password: a local provider holds its own identities, and
 * the platform is the one that gives them their first password.
 *
 * The call is an upsert on the pair `(tenant, provider, email)`: the
 * address is the name of the account, and the operator changes the
 * password of an account by calling it again.
 *
 * The answer never carries the verifier of the password, and the
 * password is never answered either.
 */

import type { AdminScope } from './credentials'
import { AdministrationError } from './errors'
import type { AdministrationOptions } from './options'
import type {
  AuditContext,
  Credential,
  CredentialFilter,
  CredentialPage,
  CredentialRegistration,
} from './ports'
import { change, type AuditEntry } from './audit'
import { refuseOutsideScope } from './scope'
import { scopeOf } from './ports'
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, wholeNumber } from './values'

/**
 * The shortest password a credential may carry.
 *
 * A password of a local provider is the only thing between a caller and
 * the tenant, and the tenant is the one that pays for a stolen one.
 */
const MIN_PASSWORD_LENGTH = 12

/** The longest password a credential may carry. */
const MAX_PASSWORD_LENGTH = 128

/**
 * Creates a credential of a local provider, or changes it.
 *
 * The password is written by the operator: it is hashed before it is
 * stored, and it is never answered.
 */
export async function upsertCredential(
  options: AdministrationOptions,
  scope: AdminScope,
  registration: CredentialRegistration,
  context: AuditContext
): Promise<{ credential: Credential; created: boolean; audit: AuditEntry }> {
  refuseOutsideScope(scope, registration.tenant)
  const tenant = await options.tenants.findBySlug(registration.tenant)
  if (!tenant) {
    throw new AdministrationError('not_found', 'the tenant does not exist')
  }

  // The credentials belong to a local provider: a provider that signs
  // its callers in somewhere else has no credential to write.
  const provider = await options.providers.findBySlug(tenant.id, registration.provider)
  if (!provider) {
    throw new AdministrationError('not_found', 'the provider does not exist')
  }
  if (provider.kind !== 'local') {
    throw new AdministrationError(
      'invalid_request',
      'the credentials belong to a local provider: the callers of another provider sign in there'
    )
  }

  const email = registration.email.trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new AdministrationError(
      'invalid_request',
      'the e-mail of the credential is not an address'
    )
  }

  const password = registration.password
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new AdministrationError(
      'invalid_request',
      `the password of a credential is at least ${MIN_PASSWORD_LENGTH} characters long`
    )
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new AdministrationError(
      'invalid_request',
      `the password of a credential is at most ${MAX_PASSWORD_LENGTH} characters long`
    )
  }

  const existing = await options.localCredentials.findByEmail(
    tenant.slug,
    registration.provider,
    email
  )
  if (!existing) {
    const credential = await options.localCredentials.create(
      {
        tenantId: tenant.id,
        providerId: provider.id,
        email,
        password,
        status: registration.status ?? 'active',
      },
      change('credential.created', tenant.slug, context)
    )
    return {
      credential,
      created: true,
      audit: { action: 'credential.created', id: credential.id, tenant: tenant.slug },
    }
  }

  const credential = await options.localCredentials.update(
    existing.id,
    {
      email,
      password,
      ...(registration.status !== undefined ? { status: registration.status } : {}),
    },
    { tenant: tenant.id },
    change('credential.updated', tenant.slug, context)
  )
  if (!credential) {
    throw new AdministrationError('not_found', 'the credential does not exist')
  }
  return {
    credential,
    created: false,
    audit: { action: 'credential.updated', id: credential.id, tenant: tenant.slug },
  }
}

/** The credentials that match a filter, and their number. */
export async function listCredentials(
  options: AdministrationOptions,
  scope: AdminScope,
  query: {
    tenant?: string | null
    provider?: string | null
    email?: string | null
    limit?: string | null
    offset?: string | null
  }
): Promise<CredentialPage> {
  const tenant = query.tenant ? await options.tenants.findBySlug(query.tenant) : null
  if (query.tenant && !tenant) {
    throw new AdministrationError('not_found', 'the tenant does not exist')
  }
  const limit = wholeNumber(query.limit ?? undefined, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE, 'limit')
  const offset = wholeNumber(query.offset ?? undefined, 0, 0, Number.MAX_SAFE_INTEGER, 'offset')
  const filter: CredentialFilter = {
    tenantId: tenant?.id ?? null,
    providerSlug: query.provider?.trim() || null,
    email: query.email?.trim().toLowerCase() || null,
    limit,
    offset,
  }
  const page = await options.localCredentials.list(filter)
  // A credential of a tenant sees its own tenant and nothing else.
  if (scope.tenant === null) return page
  return {
    credentials: page.credentials.filter((credential) => credential.tenant === scope.tenant),
    total: page.total,
    limit: page.limit,
    offset: page.offset,
  }
}

/**
 * Removes a credential of a local provider.
 *
 * The principal the credential created stays: it cannot be signed in
 * with any more, and the operator revokes its rights.
 */
export async function removeCredential(
  options: AdministrationOptions,
  scope: AdminScope,
  id: string,
  context: AuditContext
): Promise<AuditEntry> {
  const credential = await options.localCredentials.findById(id, scopeOf(scope.tenant))
  if (!credential) {
    throw new AdministrationError('not_found', 'the credential does not exist')
  }
  refuseOutsideScope(scope, credential.tenant)
  const removed = await options.localCredentials.remove(
    id,
    scopeOf(scope.tenant),
    change('credential.removed', credential.tenant, context)
  )
  if (!removed) {
    throw new AdministrationError('not_found', 'the credential does not exist')
  }
  return { action: 'credential.removed', id, tenant: credential.tenant }
}
