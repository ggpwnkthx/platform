/**
 * The scope of an operator.
 *
 * The console reads the keys Access holds for the caller on
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
 * audit of Access names the operator of a tenant credential,
 * and a change of a tenant is better signed by its own operator.
 */

/** The keys of the route of the console. */
export const CONSOLE_KEYS = {
  status: 'console.status',
  admin: 'console.admin',
  platform: 'console.platform',
} as const

/**
 * The keys of the capabilities of Data that the console reads.
 *
 * The creation of a workspace is a capability of Data: Access says who
 * holds it, and the console only shows the page to a caller that holds
 * it.
 *
 * The model and the audit of a workspace are capabilities of Data too,
 * and their keys are fixed in its code. The console reads them in the
 * access context of the caller on a workspace, to draw what Data would
 * answer before the caller asks for it.
 */
export const DATA_KEYS = {
  workspaceCreate: 'data.workspace.create',
  /** Reads the model of a workspace. */
  modelRead: 'data.model.read',
  /** Reads and changes the model of a workspace. */
  modelWrite: 'data.model.write',
  /** Reads the audit of a workspace. */
  auditRead: 'data.audit.read',
} as const

/**
 * The key of the role that administers a tenant.
 *
 * Access creates the role with every tenant, and it holds the
 * permissions an administration needs (Access spec §6.4).
 */
export const TENANT_ADMIN_ROLE = 'admin'

/**
 * The keys of the capabilities that are not relative to a tenant.
 *
 * The console holds one: `console.platform` opens the administration of
 * every tenant, and it is the platform's. Only an operator that holds
 * it may give it to somebody, and Access refuses the write of a
 * credential of a tenant.
 */
export const PLATFORM_KEYS: readonly string[] = [CONSOLE_KEYS.platform]

/**
 * Reports whether a key names a capability that is not relative to a
 * tenant.
 *
 * @param key the key of the permission.
 */
export function isPlatformKey(key: string | null | undefined): boolean {
  return key !== null && key !== undefined && PLATFORM_KEYS.includes(key)
}

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
 * Reports whether the caller may create a workspace of its tenant.
 *
 * The right is a capability of Data, and it is held by a grant of the
 * tenant: the console shows the page to a caller that holds it, and
 * Data refuses the creation of a caller that holds none.
 */
export function mayCreateWorkspaces(scope: OperatorScope): boolean {
  return scope.keys.includes(DATA_KEYS.workspaceCreate)
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

/**
 * Who signs a write that adds a member to a group, when the console
 * could not read what the group gives.
 *
 * A group may give a capability of the platform, and only the platform
 * adds a member to one that does (Access spec §3.3.1). An operator of
 * the platform signs with the credential of the platform, which may
 * always write. An operator of a tenant signs with the credential of
 * its tenant, and Access answers; when the console holds none, it would
 * sign with the credential of the platform, which Access never refuses:
 * nobody signs, and the console refuses the write itself.
 *
 * @param scope the scope of the operator.
 * @param credentials the credentials the console holds.
 * @param tenant the slug of the tenant of the group.
 */
export function signerOfUnreadJoin(
  scope: OperatorScope,
  credentials: AdminCredentials,
  tenant: string
): 'platform' | 'tenant' | null {
  if (scope.administers === 'platform') return 'platform'
  return credentials.tenants[tenant] !== undefined ? 'tenant' : null
}

/** The credential that reads the list of the tenants. */
export function listingCredential(
  scope: OperatorScope,
  credentials: AdminCredentials
): string | null {
  if (scope.administers === 'platform') return credentials.platform
  return credentialFor(scope, credentials, scope.tenant)
}
