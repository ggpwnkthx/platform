/**
 * The scope of an operator.
 *
 * The console reads the keys the access service holds for the caller on
 * the route of the console, for the workspace that is the tenant of the
 * caller. Three keys mean something to the console:
 *
 * | Key | What it opens |
 * | --- | --- |
 * | `console.status` | The detail of the status of the services: their versions, their readiness, their latencies. |
 * | `console.admin` | The administration of the tenant of the caller. |
 * | `console.platform` | The administration of every tenant of the platform. |
 *
 * The console acts with the credential of the tenant of the operator when
 * it holds one, and with the credential of the platform otherwise: the
 * audit of the access service names the operator of a tenant credential,
 * and a change of a tenant is better signed by its own operator.
 */

/** The keys of the route of the console. */
export const CONSOLE_KEYS = {
  status: 'console.status',
  admin: 'console.admin',
  platform: 'console.platform',
} as const

/** What the caller may do in the console. */
export interface OperatorScope {
  /** The slug of the tenant of the caller. */
  readonly tenant: string
  /** The keys of the route of the console. */
  readonly keys: readonly string[]
  /** Whether the caller reads the detail of the status. */
  readonly status: boolean
  /** Whether the caller administers the platform, its tenant, or nothing. */
  readonly administers: 'platform' | 'tenant' | null
}

/** The credentials of the administration that the console holds. */
export interface AdminCredentials {
  /** The credential of the platform. */
  readonly platform: string | null
  /** The credentials of the tenants, by slug. */
  readonly tenants: Readonly<Record<string, string>>
}

/** The scope of a caller, from the keys of its context. */
export function scopeOf(
  tenant: string,
  keys: readonly string[],
  credentials: AdminCredentials
): OperatorScope {
  const platform = keys.includes(CONSOLE_KEYS.platform) && credentials.platform !== null
  const own =
    (keys.includes(CONSOLE_KEYS.admin) || keys.includes(CONSOLE_KEYS.platform)) &&
    (credentials.tenants[tenant] !== undefined || credentials.platform !== null)
  return {
    tenant,
    keys,
    status: keys.includes(CONSOLE_KEYS.status) || platform,
    administers: platform ? 'platform' : own ? 'tenant' : null,
  }
}

/** A scope that opens nothing: the scope of a caller whose context could not be read. */
export function emptyScope(tenant: string): OperatorScope {
  return { tenant, keys: [], status: false, administers: null }
}

/**
 * The credential the console acts with for a tenant, or null when the
 * scope of the operator does not reach the tenant.
 */
export function credentialFor(
  scope: OperatorScope,
  credentials: AdminCredentials,
  tenant: string
): string | null {
  if (scope.administers === 'platform') {
    return credentials.tenants[tenant] ?? credentials.platform
  }
  if (scope.administers === 'tenant' && tenant === scope.tenant) {
    return credentials.tenants[tenant] ?? credentials.platform
  }
  return null
}

/** The credential that reads the list of the tenants. */
export function listingCredential(
  scope: OperatorScope,
  credentials: AdminCredentials
): string | null {
  if (scope.administers === 'platform') return credentials.platform
  return credentialFor(scope, credentials, scope.tenant)
}
