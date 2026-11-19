/** What PostgreSQL says about the signed-in reader. */
export interface Identity {
  username: string
  effective_role: string
  database: string
  platform_version: string | null
  server_version: string
  /** CREATE on the database: what a new workspace needs. */
  can_create_workspace: boolean
  /** The platform's own answer about roles: an operator may administer any of them. */
  is_operator: boolean
}

export interface SchemaInfo {
  name: string
  owner: string
  /** CREATE on the schema: what a new collection needs. */
  can_create: boolean
  /** The reader is, or is a member of, the owner. */
  can_alter: boolean
}

export interface TableInfo {
  schema: string
  name: string
  /** r table, p partitioned table, v view. */
  kind: string
  rls: boolean
  force_rls: boolean
  owner: string
  comment: string | null
  can_select: boolean
  can_insert: boolean
  can_update: boolean
  can_delete: boolean
  can_truncate: boolean
  /** Owner or member of the owner: ALTER, GRANT and CREATE POLICY are theirs. */
  can_alter: boolean
}

export interface ColumnInfo {
  schema: string
  table: string
  name: string
  position: number
  type: string
  required: boolean
  default: string | null
  comment: string | null
  can_select: boolean
  can_insert: boolean
  can_update: boolean
}

export interface RelationInfo {
  schema: string
  table: string
  column: string
  target_schema: string
  target_table: string
  /** What PostgreSQL does when the row it points at goes: a, r, c, n or d. */
  on_delete: string
}

export interface ConstraintInfo {
  schema: string
  table: string
  name: string
  /** c check, u unique, p primary key, f foreign key, x exclusion. */
  type: string
  definition: string
  /** The columns it constrains. */
  columns: string[]
}

export interface Catalog {
  schemas: SchemaInfo[]
  tables: TableInfo[]
  columns: ColumnInfo[]
  relations: RelationInfo[]
  constraints: ConstraintInfo[]
}

export interface RoleInfo {
  name: string
  login: boolean
  inherit: boolean
  create_role: boolean
  bypass_rls: boolean
  superuser: boolean
  /** The reader may admit others to this role: ADMIN OPTION on it, or CREATEROLE. */
  admits: boolean
}

export interface MembershipInfo {
  role: string
  member: string
  admin_option: boolean
  inherit_option: boolean
  set_option: boolean
}

export interface PolicyInfo {
  schema: string
  table: string
  name: string
  permissive: string
  roles: string[]
  command: string
  using: string | null
  check: string | null
}

/** One grant on a table or a column, as the ACL records it. */
export interface GrantInfo {
  schema: string
  table: string
  /** Null for a grant on the whole table. */
  column: string | null
  grantee: string
  privilege: string
  grantor: string
  grantable: boolean
}

export interface SchemaGrantInfo {
  schema: string
  grantee: string
  privilege: string
  grantable: boolean
}

export interface ActivityInfo {
  id: number
  at: string
  transaction_id: number
  actor: string
  schema_name: string
  table_name: string
  operation: string
  before_row: Record<string, unknown> | null
  after_row: Record<string, unknown> | null
}

export interface MetadataEntry {
  key: string
  value: unknown
  version: number
  updated_at: string
  updated_by: string
}

/** One row of the item's metadata: what it says about the item it names. */
export interface MetadataRow {
  scope: 'workspace' | 'collection' | 'field'
  schema_name: string
  table_name: string | null
  /** The column, when the row names a field. */
  column_name: string | null
  key: string
  value: unknown
}

/**
 * The reserved metadata keys that make an item present itself: the name people read, the icon
 * they recognise and the colour that marks it. They are ordinary metadata rows, written and
 * read under the same rights as every other key.
 */
export const presentationKeys = ['display_name', 'icon', 'color'] as const
export type PresentationKey = (typeof presentationKeys)[number]
