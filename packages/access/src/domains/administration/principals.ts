/**
 * The principals of the administration (spec §10.3).
 *
 * The principal is the mapping of an external identity of a tenant onto
 * a principal of the platform. The pair `(tenant, externalSubject)` is
 * its key, and the call is an upsert.
 */

import type { AdminScope } from './credentials'
import { AdministrationError } from './errors'
import type { AdministrationOptions } from './options'
import type {
  AuditContext,
  Principal,
  PrincipalFilter,
  PrincipalPage,
  PrincipalRegistration,
} from './ports'
import { change, type AuditEntry } from './audit'
import { refuseOutsideScope, tenantOf } from './scope'
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, statusOf, wholeNumber } from './values'

/**
 * The outcome of one principal of a batch.
 *
 * The answer of a batch names every item: the one that was written and
 * the one that was refused, with the code of the refusal.
 */
export interface PrincipalOutcome {
  /** The tenant of the principal. */
  tenant: string
  /** The external identity of the principal. */
  externalSubject: string
  /** The id of the principal, or null when the item failed. */
  id: string | null
  /** True when the principal was created, false when it was updated. */
  created: boolean
  /** The code of the refusal, when the item failed. */
  error?: string
  /** The message of the refusal, when the item failed. */
  message?: string
}

/**
 * The query of the list of the principals.
 *
 * The values are the ones of the query of the call: they are read, and
 * a value that is not understood is a refusal.
 */
export interface PrincipalQuery {
  /** The tenant of the list, or null for every tenant. */
  tenant?: string | null
  /** The status of the principals, or null for every status. */
  status?: string | null
  /** The e-mail of the principals, or null for every one. */
  email?: string | null
  /** The size of the page, as the query names it. */
  limit?: string | null
  /** The number of rows that are skipped, as the query names it. */
  offset?: string | null
}

/**
 * The principals that match a filter, and their number.
 *
 * The page is read from the table of the principals: the filter of the
 * tenant is optional, and a tenant that does not exist is a
 * `404 not_found`.
 */
export async function listPrincipals(
  options: AdministrationOptions,
  scope: AdminScope,
  query: PrincipalQuery
): Promise<PrincipalPage> {
  const limit = wholeNumber(query.limit ?? undefined, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE, 'limit')
  const offset = wholeNumber(query.offset ?? undefined, 0, 0, Number.MAX_SAFE_INTEGER, 'offset')
  const status = statusOf(query.status ?? undefined)

  // The filter of the tenant of a credential that is scoped to a
  // tenant is the tenant of the credential: the filter of the query
  // cannot widen it.
  const tenant = await tenantOf(options, scope, query.tenant)

  const filter: PrincipalFilter = {
    tenantId: tenant ? tenant.id : null,
    status,
    email: query.email?.trim() || null,
    limit,
    offset,
  }
  const page = await options.principals.list(filter)
  return { principals: page.principals, total: page.total, limit, offset }
}

/**
 * Creates a principal, or updates the principal of that
 * `(tenant, externalSubject)` pair.
 *
 * The row of the audit is written by the statement that writes the
 * principal (spec §10.1).
 */
export async function upsertPrincipal(
  options: AdministrationOptions,
  scope: AdminScope,
  registration: PrincipalRegistration,
  context: AuditContext
): Promise<{ principal: Principal; created: boolean; audit: AuditEntry }> {
  refuseOutsideScope(scope, registration.tenant)
  const tenant = await options.tenants.findBySlug(registration.tenant)
  if (!tenant) {
    throw new AdministrationError('not_found', 'the tenant does not exist')
  }

  const existing = await options.principals.findByExternalSubject(
    tenant.id,
    registration.externalSubject
  )
  if (!existing) {
    const principal = await options.principals.create(
      {
        tenantId: tenant.id,
        externalSubject: registration.externalSubject,
        email: registration.email ?? null,
        displayName: registration.displayName ?? null,
        status: registration.status ?? 'active',
      },
      change('principal.created', tenant.slug, context)
    )
    return {
      principal,
      created: true,
      audit: { action: 'principal.created', id: principal.id, tenant: tenant.slug },
    }
  }

  const principal = await options.principals.update(
    existing.id,
    {
      email: registration.email,
      displayName: registration.displayName,
      status: registration.status,
    },
    change('principal.updated', tenant.slug, context)
  )
  if (!principal) {
    throw new AdministrationError('not_found', 'the principal does not exist')
  }
  return {
    principal,
    created: false,
    audit: { action: 'principal.updated', id: principal.id, tenant: tenant.slug },
  }
}

/**
 * Writes a batch of principals.
 *
 * A batch is the call that onboards a tenant: one call writes a
 * hundred principals instead of a hundred calls.
 *
 * **Every item is written on its own.** The change of an item and the
 * row of its audit are one statement, so an item that is written is
 * audited, and an item that fails leaves nothing behind. The answer
 * names the outcome of every item: an item that failed does not stop
 * the others, because an operator that onboards a tenant wants to know
 * *which* identities were refused.
 *
 * The call is **idempotent**: the same batch again writes the same
 * principals, and the ones that exist are updated instead of created.
 */
export async function upsertPrincipals(
  options: AdministrationOptions,
  scope: AdminScope,
  registrations: PrincipalRegistration[],
  context: AuditContext
): Promise<PrincipalOutcome[]> {
  const outcomes: PrincipalOutcome[] = []
  for (const registration of registrations) {
    try {
      const result = await upsertPrincipal(options, scope, registration, context)
      outcomes.push({
        tenant: result.principal.tenant,
        externalSubject: result.principal.externalSubject,
        id: result.principal.id,
        created: result.created,
      })
    } catch (error) {
      if (error instanceof AdministrationError) {
        outcomes.push({
          tenant: registration.tenant,
          externalSubject: registration.externalSubject,
          id: null,
          created: false,
          error: error.code,
          message: error.message,
        })
        continue
      }
      throw error
    }
  }
  return outcomes
}
