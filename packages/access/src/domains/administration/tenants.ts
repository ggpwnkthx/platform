/**
 * The tenants of the administration (spec §10.1).
 *
 * The slug is the key of the row: the call is an upsert. A client id
 * belongs to one tenant and a default belongs to one tenant: both are a
 * conflict.
 */

import type { AdminScope } from './credentials'
import { AdministrationError } from './errors'
import type { AdministrationOptions } from './options'
import type { AuditContext, Tenant, TenantRegistration, TenantSummary } from './ports'
import { change, type AuditEntry } from './audit'
import { refuseOutsideScope } from './scope'

/**
 * Creates a tenant, or updates the tenant of that slug.
 *
 * The slug is the key of the row: the call is an upsert. A client id
 * belongs to one tenant and a default belongs to one tenant: both are
 * a conflict.
 *
 * The context carries the facts of the call that the domain cannot
 * know: the operator, the address and the request. The row of the audit
 * is written by the statement that writes the tenant (spec §10.1).
 */
export async function upsertTenant(
  options: AdministrationOptions,
  scope: AdminScope,
  registration: TenantRegistration,
  context: AuditContext
): Promise<{ tenant: Tenant; created: boolean; audit: AuditEntry }> {
  refuseOutsideScope(scope, registration.slug)
  const existing = await options.tenants.findBySlug(registration.slug)
  // A credential of a tenant changes that tenant: it does not create
  // it. The creation of a tenant is the work of the operator of the
  // platform.
  if (scope.tenant !== null && !existing) {
    throw new AdministrationError('not_found', 'the tenant does not exist')
  }

  // The flags that change the scope of the platform belong to the
  // operator of the platform: the shared client of a tenant moves the
  // logins of the platform and lifts the scope of the decisions of its
  // gateway, and the default tenant of the platform routes the logins
  // of the shared clients. A credential of a tenant may not change
  // them.
  if (scope.tenant !== null && existing) {
    if (registration.sharedClient !== existing.sharedClient) {
      throw new AdministrationError(
        'forbidden',
        'the credential may not change the shared client of the tenant'
      )
    }
    if (registration.isDefault !== existing.isDefault) {
      throw new AdministrationError(
        'forbidden',
        'the credential may not change the default tenant of the platform'
      )
    }
  }

  // A client id belongs to one tenant.
  const owner = await options.tenants.findByClientId(registration.clientId)
  if (owner && owner.id !== existing?.id) {
    throw new AdministrationError(
      'conflict',
      'the client id of the gateway belongs to another tenant'
    )
  }

  // At most one tenant is the default.
  if (registration.isDefault) {
    const current = (await options.tenants.list()).find((tenant) => tenant.isDefault)
    if (current && current.id !== existing?.id) {
      throw new AdministrationError('conflict', 'another tenant is already the default')
    }
  }

  if (!existing) {
    const tenant = await options.tenants.create(
      registration,
      change('tenant.created', registration.slug, context)
    )
    return {
      tenant,
      created: true,
      audit: { action: 'tenant.created', id: tenant.id, tenant: tenant.slug },
    }
  }

  const tenant = await options.tenants.update(
    existing.id,
    registration,
    change('tenant.updated', existing.slug, context)
  )
  if (!tenant) {
    throw new AdministrationError('not_found', 'the tenant does not exist')
  }
  return {
    tenant,
    created: false,
    audit: { action: 'tenant.updated', id: tenant.id, tenant: tenant.slug },
  }
}

/** The tenants of the platform, with their numbers. */
export async function listTenants(
  options: AdministrationOptions,
  scope: AdminScope
): Promise<TenantSummary[]> {
  const tenants = await options.tenants.list()
  // A credential of a tenant sees its own tenant and nothing else.
  if (scope.tenant === null) return tenants
  return tenants.filter((tenant) => tenant.slug === scope.tenant)
}
