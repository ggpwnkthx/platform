/**
 * The shapes of the contracts of the platform, as the clients read them.
 *
 * The console and the CLI are clients of the gateway, of Access and of
 * Data, and they read the same contracts. The shapes are written here,
 * once: a shape that is written twice is a shape that drifts, and a
 * client that reads a shape the service does not answer is a client
 * that shows nothing.
 *
 * The shapes are those of the contracts (`docs/data/api.md` and
 * `docs/access/api.md`); they are not the shape of a page and not the
 * shape of an answer of the command line.
 */

/**
 * The identity of the caller in a workspace.
 */
export interface Me {
  readonly principalId: string
  readonly tenantId: string
  readonly workspaceId: string
  readonly workspace?: { id: string; slug: string | null; displayName: string | null }
  readonly routeId: string
  readonly apiVersion: string
}

/** The metadata of a field. */
export interface FieldMetadata {
  readonly name: string
  readonly type: string
  readonly required: boolean
  readonly nullable: boolean
  readonly maxLength?: number
  readonly minLength?: number
  readonly enum?: readonly string[]
  readonly minimum?: number
  readonly maximum?: number
  readonly label?: string
  readonly description?: string
}

/** The metadata of a relation. */
export interface RelationMetadata {
  readonly name: string
  readonly target: string
  readonly type: string
  readonly label?: string
  readonly description?: string
}

/** The metadata of a collection, for the caller. */
export interface CollectionMetadata {
  readonly key: string
  readonly label: string
  readonly description?: string
  readonly schemaVersion: string
  readonly actions: readonly string[]
  readonly readableFields: readonly string[]
  readonly writableFields: readonly string[]
  readonly filterableFields: readonly string[]
  readonly fields: readonly FieldMetadata[]
  readonly relations: readonly RelationMetadata[]
}

/** The metadata of the deployment, for the caller. */
export interface SchemaMetadata {
  readonly apiVersion: string
  readonly schemaVersion: string
  readonly policyBundleVersion: string
  readonly limits?: Readonly<Record<string, number>>
  readonly collections: readonly CollectionMetadata[]
}

/** A record of a collection. */
export type RecordValue = Readonly<Record<string, unknown>> & {
  readonly id: string
  readonly version: number
}

/** A page of a list. */
export interface Page {
  readonly data: readonly RecordValue[]
  readonly meta: {
    readonly limit: number
    readonly nextCursor: string | null
    readonly count?: number
  }
}

/** One group of an aggregate. */
export interface AggregateGroup {
  readonly group: Readonly<Record<string, unknown>>
  readonly count: number
  readonly sum?: Readonly<Record<string, string | null>>
  readonly avg?: Readonly<Record<string, string | null>>
  readonly min?: Readonly<Record<string, unknown>>
  readonly max?: Readonly<Record<string, unknown>>
}

/** The answer of an aggregate. */
export interface Aggregate {
  readonly data: readonly AggregateGroup[]
  readonly meta: { readonly limit: number; readonly groups: number; readonly truncated: boolean }
}

/** One version of the history of a record. */
export interface VersionEntry {
  readonly version: number
  readonly operation: 'update' | 'delete'
  readonly changedFields: readonly string[]
  readonly supersededAt: string
  readonly supersededBy: string
}

/** An entry of the audit of a workspace. */
export interface AuditEntry {
  readonly id: string
  readonly occurredAt: string
  readonly principalId: string
  readonly routeId?: string
  readonly requestId?: string
  readonly source?: string
  readonly action?: string
  readonly collection?: string
  readonly recordId?: string
  readonly resultVersion?: number
  readonly changedFields?: readonly string[]
  readonly policyId?: string
  readonly [key: string]: unknown
}

/** A field of the model of a workspace. */
export interface ModelField {
  readonly name: string
  readonly type: string
  readonly required: boolean
  readonly nullable: boolean
  readonly label?: string
  readonly description?: string
  readonly enum?: readonly string[]
  readonly default?: unknown
  readonly minimum?: number
  readonly maximum?: number
  readonly maxLength?: number
  readonly minLength?: number
  /** True when the field comes from the manifest of the deployment. */
  readonly deployment: boolean
  /** True when the model of the workspace holds the field. */
  readonly held: boolean
}

/** A relation of the model of a workspace. */
export interface ModelRelation {
  readonly name: string
  readonly target: string
  readonly type: string
  readonly field: string
  readonly label?: string
  readonly description?: string
  readonly deployment: boolean
}

/** A collection of the model of a workspace. */
export interface ModelCollection {
  readonly key: string
  readonly label: string
  readonly description?: string
  readonly table: string
  readonly fields: readonly ModelField[]
  readonly relations: readonly ModelRelation[]
  readonly schemaVersion: string
}

/** The model of a workspace. */
export interface Model {
  readonly version: number
  readonly modelVersion: string
  readonly schemaVersion: string
  readonly collections: readonly ModelCollection[]
  readonly available: readonly { key: string; label: string; table: string }[]
  readonly writable: boolean
}

/** The attributes of a field of the model that a change carries. */
export interface FieldAttributes {
  readonly type?: string
  readonly required?: boolean
  readonly nullable?: boolean
  readonly label?: string
  readonly description?: string
  readonly enum?: readonly string[]
  readonly minimum?: number
  readonly maximum?: number
  readonly maxLength?: number
  readonly minLength?: number
}

/** The attributes of a relation of the model. */
export interface RelationAttributes {
  readonly target: string
  readonly type: 'many-to-one' | 'one-to-many'
  readonly field: string
  readonly label?: string
  readonly description?: string
}

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

/** The outcome of one item of a batch of principals. */
export interface BatchOutcome {
  readonly externalSubject?: string
  readonly id: string | null
  readonly created: boolean
  readonly error?: string
  readonly message?: string
}

/** The answer of the contract of the access context. */
export interface AccessContext {
  readonly allow: boolean
  readonly permissionKeys: readonly string[]
  readonly validUntil: string | null
}
