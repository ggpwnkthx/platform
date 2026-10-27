/**
 * The rows of the administration of the access service, as its contract
 * answers them (docs/access/api.md).
 */

/** A tenant of the platform. */
export interface Tenant {
  readonly id: string
  readonly slug: string
  readonly displayName: string
  readonly issuer: string
  readonly emailDomain: string | null
  readonly clientId: string
  readonly clientRedirectUris?: readonly string[]
  readonly autoProvision: boolean
  readonly sharedClient: boolean
  readonly default: boolean
  readonly enabled: boolean
  readonly userCount?: number
  readonly grantCount?: number
  readonly createdAt: string
}

/** The body of the upsert of a tenant. */
export interface TenantInput {
  readonly slug: string
  readonly displayName: string
  readonly issuer: string
  readonly idpClientId: string
  readonly idpClientSecret: string
  readonly idpRedirectUri?: string
  readonly idpScopes?: readonly string[]
  readonly emailDomain?: string
  readonly clientId: string
  readonly clientSecret: string
  readonly clientRedirectUris?: readonly string[]
  readonly autoProvision?: boolean
  readonly sharedClient?: boolean
  readonly default?: boolean
  readonly enabled?: boolean
}

/** A principal: a user of a tenant. */
export interface Principal {
  readonly id: string
  readonly tenant: string
  readonly externalSubject: string
  readonly email: string | null
  readonly displayName: string | null
  readonly status: 'active' | 'disabled'
  readonly lastLoginAt: string | null
  readonly createdAt: string
}

/** The body of the upsert of a principal. */
export interface PrincipalInput {
  readonly tenant: string
  readonly externalSubject: string
  readonly email?: string
  readonly displayName?: string
  readonly status?: 'active' | 'disabled'
}

/** A grant: a right of a principal or of a group. */
export interface Grant {
  readonly id: string
  readonly tenant: string
  readonly userId?: string | null
  readonly group?: string | null
  /** The permission of the grant, or null when the grant holds a role. */
  readonly permission: string | null
  /** The role of the grant, or null when the grant holds a permission. */
  readonly role?: string | null
  readonly workspaceId: string | null
  readonly routeId: string | null
  readonly expiresAt: string | null
  readonly revokedAt: string | null
  readonly grantedBy?: string | null
  readonly createdAt: string
}

/**
 * The body of the upsert of a grant.
 *
 * The grant names a permission or a role, and not both: the grant of a
 * role holds the permissions of the role.
 */
export interface GrantInput {
  readonly tenant: string
  readonly userId?: string
  readonly group?: string
  readonly permission?: string | null
  readonly role?: string | null
  readonly workspaceId?: string | null
  readonly routeId?: string | null
  readonly expiresAt?: string | null
  readonly grantedBy?: string
}

/** A group of principals. */
export interface Group {
  readonly id: string
  readonly tenant: string
  readonly key: string
  readonly displayName: string | null
  /** The external subjects of the members. */
  readonly members: readonly string[]
  readonly createdAt: string
}

/** The body of the upsert of a group: it replaces the membership. */
export interface GroupInput {
  readonly tenant: string
  readonly key: string
  readonly displayName?: string
  readonly members: readonly string[]
}

/**
 * A role of the policy.
 *
 * A role is a named set of permissions of a tenant. A role may name
 * another role: the permissions of the named role are the permissions of
 * the naming role.
 */
export interface Role {
  readonly id: string
  readonly tenant: string
  readonly key: string
  readonly displayName: string | null
  readonly description: string | null
  /** The keys of the permissions the role holds. */
  readonly permissions: readonly string[]
  /** The keys of the roles the role names. */
  readonly roles: readonly string[]
  readonly createdAt: string
}

/** The body of the upsert of a role: it replaces the memberships. */
export interface RoleInput {
  readonly tenant: string
  readonly key: string
  readonly displayName?: string | null
  readonly description?: string | null
  readonly permissions?: readonly string[]
  readonly roles?: readonly string[]
}

/** A row of the audit of the administration. */
export interface AuditRecord {
  readonly id: string
  readonly at: string
  readonly action: string
  readonly targetId: string
  readonly tenant: string | null
  readonly operator: string
  readonly address: string | null
  readonly requestId: string | null
}

/** A page of a list of the administration. */
export interface AdminPage<T> {
  readonly rows: readonly T[]
  readonly total: number
  readonly limit: number
  readonly offset: number
}

/** The answer of the contract of the access context. */
export interface AccessContext {
  readonly allow: boolean
  readonly permissionKeys: readonly string[]
  readonly validUntil: string | null
}
