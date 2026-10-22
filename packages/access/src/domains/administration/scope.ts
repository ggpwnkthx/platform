/**
 * The scope of a call of the administration.
 *
 * The scope is what the credential allows: the tenant it may act for and
 * the operator it is. A call that acts for another tenant is refused, and
 * the refusal names nothing that would tell the caller whether that
 * tenant exists.
 */

import type { AdminScope } from './credentials'
import { AdministrationError } from './errors'
import type { AdministrationOptions } from './options'
import type { Tenant } from './ports'

/**
 * Refuses a call that acts for a tenant the credential may not act for.
 *
 * A credential of a tenant may only act for that tenant: a call that
 * names another one is a `403 forbidden`, and it names nothing that
 * would tell the caller whether that tenant exists (spec §10.1).
 */
export function refuseOutsideScope(scope: AdminScope, tenant: string | null | undefined): void {
  if (scope.tenant === null) return
  if (tenant !== undefined && tenant !== null && tenant.trim() === scope.tenant) return
  throw new AdministrationError('forbidden', 'the credential may not act for this tenant')
}

/**
 * The tenant of a list, as the credential and the query name it.
 *
 * The filter of the tenant of a credential that is scoped to a tenant is
 * the tenant of the credential: the filter of the query cannot widen it.
 * A tenant that does not exist is a `404 not_found`.
 */
export async function tenantOf(
  options: AdministrationOptions,
  scope: AdminScope,
  requested: string | null | undefined
): Promise<Tenant | null> {
  const slug = scope.tenant ?? requested?.trim()
  if (!slug) return null
  const tenant = await options.tenants.findBySlug(slug)
  if (!tenant) {
    throw new AdministrationError('not_found', 'the tenant does not exist')
  }
  return tenant
}
