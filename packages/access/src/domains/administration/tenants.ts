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
import type {
  AuditContext,
  Tenant,
  TenantCreation,
  TenantRegistration,
  TenantSummary,
} from './ports'
import { change, type AuditEntry } from './audit'
import { refuseOutsideScope, statementScope } from './scope'

/**
 * The registration of a tenant that is created.
 *
 * A tenant is created with the provider of its identity: the issuer,
 * the client and the secret of the provider are needed, and a
 * registration that names none of them is a registration that creates
 * no tenant. The callback of the provider and the scopes it is asked
 * for have their defaults.
 *
 * @param options what the administration is built with.
 * @param registration the registration of the call.
 */
function creationOf(
  options: AdministrationOptions,
  registration: TenantRegistration
): TenantCreation {
  if (registration.issuer === undefined || registration.issuer === '') {
    throw new AdministrationError(
      'invalid_request',
      'a tenant is created with the provider of its identity: the issuer of the provider is needed'
    )
  }
  if (registration.idpClientId === undefined || registration.idpClientId === '') {
    throw new AdministrationError(
      'invalid_request',
      'a tenant is created with the provider of its identity: the client of Access at the provider is needed'
    )
  }
  if (registration.idpClientSecret === undefined || registration.idpClientSecret === '') {
    throw new AdministrationError(
      'invalid_request',
      'a tenant is created with the provider of its identity: the secret of Access at the provider is needed'
    )
  }
  return {
    ...registration,
    issuer: registration.issuer,
    idpClientId: registration.idpClientId,
    idpClientSecret: registration.idpClientSecret,
    idpRedirectUri: registration.idpRedirectUri ?? `${options.publicUrl}/oauth/tenant/callback`,
    idpScopes: registration.idpScopes ?? ['openid', 'email', 'profile'],
    idpAlgorithms: registration.idpAlgorithms ?? ['RS256'],
  }
}

/**
 * Creates a tenant, or updates the tenant of that slug.
 *
 * The slug is the key of the row: the call is an upsert. A client id
 * belongs to one tenant and a default belongs to one tenant: both are
 * a conflict.
 *
 * The provider of the identity of the tenant is the provider the
 * registration names, and it is the provider the tenant has when the
 * registration names none: a call that changes the name of a tenant
 * does not change the provider its people sign in at.
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

  // The provider of a tenant is the tenant's own, and the secret of a
  // provider belongs to that provider: a change that names another
  // provider and no secret of it is a change that leaves the tenant
  // with the secret of the old one, and the login at the new provider
  // is refused. A change that names the same provider keeps the secret
  // the tenant has.
  if (existing && registration.idpClientSecret === undefined) {
    const otherIssuer = registration.issuer !== undefined && registration.issuer !== existing.issuer
    const otherClient =
      registration.idpClientId !== undefined &&
      registration.idpClientId !== '' &&
      registration.idpClientId !== existing.idpClientId
    if (otherIssuer || otherClient) {
      throw new AdministrationError(
        'invalid_request',
        'the provider of the tenant changed, and the change names no secret of it: the secret of a provider belongs to its provider'
      )
    }
  }

  if (!existing) {
    const tenant = await options.tenants.create(
      creationOf(options, registration),
      change('tenant.created', registration.slug, context)
    )
    await routeOfDomain(options, scope, tenant, registration, context)
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
  await routeOfDomain(options, scope, tenant, registration, context)
  return {
    tenant,
    created: false,
    audit: { action: 'tenant.updated', id: tenant.id, tenant: tenant.slug },
  }
}

/**
 * The route of the domain of a tenant.
 *
 * The domain of the tenant is a route of the logins (§3.13): the
 * address of a caller names the tenant of the login. The route of a
 * domain that is already there is the one the platform routes, and it is
 * not changed here: the operator changes it with the routes of the
 * administration (§10.18).
 *
 * The operator of the platform vouches for the domain of a tenant: the
 * route it writes is verified. A credential of a tenant proves its own
 * domain, and the route it writes waits for the proof.
 */
async function routeOfDomain(
  options: AdministrationOptions,
  scope: AdminScope,
  tenant: Tenant,
  registration: TenantRegistration,
  context: AuditContext
): Promise<void> {
  const domain = registration.emailDomain?.trim().toLowerCase()
  if (!domain) return
  const found = await options.routes.findByKey(
    'domain',
    domain,
    await statementScope(options, scope)
  )
  if (found) return
  await options.routes.create(
    {
      kind: 'domain',
      key: domain,
      tenantId: tenant.id,
      providerSlug: null,
      challenge: aChallenge(),
      // The operator of the platform vouches for the domain; a tenant
      // proves its own.
      status: scope.tenant === null ? 'verified' : 'pending',
    },
    change('route.created', tenant.slug, context)
  )
}

/** A fresh challenge of a route. */
function aChallenge(): string {
  return crypto.randomUUID().replace(/-/g, '')
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
