/**
 * The shapes of the contract of `v1` of Data, as the console
 * reads them (docs/data/api.md).
 */

/** The identity of the caller in a workspace. */
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
