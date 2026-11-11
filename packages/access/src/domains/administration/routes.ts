/**
 * The routes of the logins (spec §10.18).
 *
 * A route names the tenant of a login and the provider the login signs
 * in at. A route is a hint that the platform proves before it routes
 * anything: a route that is not verified routes nothing, and the login
 * of an address that names no verified route goes on with the default
 * tenant of the platform (§5.2.2).
 *
 * The proof is one of two: the owner of the domain publishes a record
 * that carries the challenge of the route, or the operator of the
 * platform says so. A tenant proves its own domains and nobody else's,
 * and the operator of the platform may vouch for any of them.
 */

import type { AdminScope } from './credentials'
import { AdministrationError } from './errors'
import type { AdministrationOptions } from './options'
import type {
  AuditContext,
  Route,
  RouteFilter,
  RouteKind,
  RoutePage,
  RouteRegistration,
  RouteStatus,
  RouteVerification,
} from './ports'
import { change, type AuditEntry } from './audit'
import { refuseOutsideScope, statementScope } from './scope'
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, wholeNumber } from './values'

/**
 * The name of the record that proves a domain.
 *
 * The owner of the domain publishes it: a TXT record at `_access` of
 * the domain, carrying the challenge of the route.
 */
const PROOF_NAME = '_access'

/**
 * The key of a route, as the platform holds it.
 *
 * A domain is lowercased: a domain is a name and not a case, and the
 * domain of an address is lowercased too (§5.2.2). An address is
 * lowercased whole: the local part of an address is not a case in the
 * eyes of the platform, and the provider of the tenant decides what it
 * is.
 *
 * @param kind the kind of the key.
 * @param key the key the caller named.
 */
export function keyOf(kind: RouteKind, key: string): string {
  const value = key.trim().toLowerCase()
  if (value === '') {
    throw new AdministrationError('invalid_request', 'the key of the route is needed')
  }
  if (kind === 'domain') {
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(value)) {
      throw new AdministrationError(
        'invalid_request',
        'the domain of a route is a name: it carries letters, digits, dashes and dots'
      )
    }
    return value
  }
  const at = value.lastIndexOf('@')
  if (at <= 0 || at === value.length - 1) {
    throw new AdministrationError('invalid_request', 'the address of a route is an address')
  }
  return value
}

/**
 * Creates a route, or changes the route of that key.
 *
 * The call is an upsert keyed by the kind of the key and the key: a
 * route that names another tenant waits for its proof again, because the
 * proof is about the domain and the tenant is who owns it.
 */
export async function upsertRoute(
  options: AdministrationOptions,
  scope: AdminScope,
  registration: RouteRegistration,
  context: AuditContext
): Promise<{ route: Route; created: boolean; audit: AuditEntry }> {
  refuseOutsideScope(scope, registration.tenant)
  const tenant = await options.tenants.findBySlug(registration.tenant)
  if (!tenant) {
    throw new AdministrationError('not_found', 'the tenant does not exist')
  }
  const kind = registration.kind ?? 'domain'
  const key = keyOf(kind, registration.key)
  if (registration.provider !== undefined && registration.provider !== null) {
    const provider = await options.providers.findBySlug(tenant.id, registration.provider)
    if (!provider) {
      throw new AdministrationError('not_found', 'the provider of the route does not exist')
    }
  }
  const existing = await options.routes.findByKey(kind, key, await statementScope(options, scope))
  if (existing && existing.tenant !== tenant.slug && scope.tenant !== null) {
    // The key of a route is unique, and a tenant may not take the route
    // of another tenant: the operator of the platform moves it, and the
    // route waits for its proof again.
    throw new AdministrationError(
      'conflict',
      'the key of the route names the route of another tenant: the operator of the platform moves it'
    )
  }
  if (!existing) {
    const route = await options.routes.create(
      {
        kind,
        key,
        tenantId: tenant.id,
        providerSlug: registration.provider ?? null,
        challenge: aChallenge(),
      },
      change('route.created', tenant.slug, context)
    )
    return {
      route,
      created: true,
      audit: { action: 'route.created', id: route.id, tenant: tenant.slug },
    }
  }
  const route = await options.routes.update(
    existing.id,
    { tenantId: tenant.id, providerSlug: registration.provider ?? null },
    await statementScope(options, scope),
    change('route.updated', tenant.slug, context)
  )
  if (!route) {
    throw new AdministrationError('not_found', 'the route does not exist')
  }
  return {
    route,
    created: false,
    audit: { action: 'route.updated', id: route.id, tenant: tenant.slug },
  }
}

/** The routes that match a filter, and their number. */
export async function listRoutes(
  options: AdministrationOptions,
  scope: AdminScope,
  query: {
    tenant?: string | null
    kind?: string | null
    limit?: string | null
    offset?: string | null
  }
): Promise<RoutePage> {
  const tenant = query.tenant ? await options.tenants.findBySlug(query.tenant) : null
  if (query.tenant && !tenant) {
    throw new AdministrationError('not_found', 'the tenant does not exist')
  }
  const limit = wholeNumber(query.limit ?? undefined, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE, 'limit')
  const offset = wholeNumber(query.offset ?? undefined, 0, 0, Number.MAX_SAFE_INTEGER, 'offset')
  const kind = kindOf(query.kind)
  const filter: RouteFilter = {
    tenantId: tenant?.id ?? null,
    kind,
    limit,
    offset,
  }
  const page = await options.routes.list(filter)
  // A credential of a tenant sees its own tenant and nothing else.
  if (scope.tenant === null) return page
  return {
    routes: page.routes.filter((route) => route.tenant === scope.tenant),
    total: page.total,
    limit: page.limit,
    offset: page.offset,
  }
}

/**
 * Verifies a route, or refuses it.
 *
 * The proof of a domain is the record its owner publishes: the service
 * reads the record of `_access` of the domain and compares it with the
 * challenge of the route. The operator of the platform may vouch for a
 * domain instead, and only the operator of the platform may: a tenant
 * proves its own domains and nobody else's.
 */
export async function verifyRoute(
  options: AdministrationOptions,
  scope: AdminScope,
  id: string,
  body: { status: RouteStatus; verification: RouteVerification },
  context: AuditContext
): Promise<{ route: Route; audit: AuditEntry }> {
  const route = await options.routes.findById(id, await statementScope(options, scope))
  if (!route) {
    throw new AdministrationError('not_found', 'the route does not exist')
  }
  refuseOutsideScope(scope, route.tenant)
  if (body.status === 'rejected') {
    const rejected = await options.routes.verify(
      id,
      { status: 'rejected', verification: body.verification, verifiedBy: null },
      await statementScope(options, scope),
      change('route.rejected', route.tenant, context)
    )
    if (!rejected) {
      throw new AdministrationError('not_found', 'the route does not exist')
    }
    return {
      route: rejected,
      audit: { action: 'route.rejected', id, tenant: route.tenant },
    }
  }
  if (body.verification === 'operator' && scope.tenant !== null) {
    throw new AdministrationError(
      'forbidden',
      'the operator of the platform vouches for a domain: a tenant proves its own domains and nobody else'
    )
  }
  if (body.verification === 'dns') {
    if (route.kind !== 'domain') {
      throw new AdministrationError(
        'invalid_request',
        'the proof of an address is the operator of the platform: a domain is what publishes a record'
      )
    }
    const records = await options.proof.txtOf(`${PROOF_NAME}.${route.key}`)
    if (!records.includes(route.challenge)) {
      throw new AdministrationError(
        'conflict',
        `the record of ${PROOF_NAME}.${route.key} does not carry the challenge of the route: the owner of the domain has not published it yet`
      )
    }
  }
  const verified = await options.routes.verify(
    id,
    {
      status: 'verified',
      verification: body.verification,
      verifiedBy: body.verification === 'operator' ? (context.operator ?? null) : null,
    },
    await statementScope(options, scope),
    change('route.verified', route.tenant, context)
  )
  if (!verified) {
    throw new AdministrationError('not_found', 'the route does not exist')
  }
  return {
    route: verified,
    audit: { action: 'route.verified', id, tenant: route.tenant },
  }
}

/** The kind of the key of a route, when the query names one. */
function kindOf(named?: string | null): RouteKind | null {
  if (!named) return null
  if (named === 'domain' || named === 'address') return named
  throw new AdministrationError('invalid_request', 'the kind of a route is a domain or an address')
}

/** A fresh challenge of a route. */
function aChallenge(): string {
  return crypto.randomUUID().replace(/-/g, '')
}
