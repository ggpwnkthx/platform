export interface SchemaInfo {
  name: string
  owner: string
  kind: 'user' | 'system'
  can_create: boolean
  can_alter: boolean
}
export interface TableInfo {
  schema: string
  name: string
  kind: string
  rls: boolean
  force_rls: boolean
  owner: string
  comment: string | null
  system: boolean
  can_select: boolean
  can_insert: boolean
  can_update: boolean
  can_delete: boolean
  can_truncate: boolean
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
  generated: string | null
  identity: string | null
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
  /**
   * The column of the target the key points at. Usually `id`, but a key made by hand may
   * point at any other column — a natural key, say — and the platform reads the key as it
   * is written rather than assuming the target's `id`.
   */
  target_column: string
  on_delete: string
}
/** An index PostgreSQL holds: the columns it covers, and whether it refuses duplicates. */
export interface IndexInfo {
  schema: string
  table: string
  name: string
  columns: string[]
  unique: boolean
  /** The key of the table itself: the index every row is found by. */
  primary: boolean
}
/**
 * A table that joins two others: two foreign keys, one to each, and a unique index over
 * both. The pair is what a link is, and the index is what makes it a link and not a copy.
 */
export interface JoinInfo {
  schema: string
  table: string
  left: { column: string; target_schema: string; target_table: string; target_column: string }
  right: { column: string; target_schema: string; target_table: string; target_column: string }
  /** A unique index covers both columns: the pair may be written with ON CONFLICT. */
  uniquePair: boolean
  /**
   * The columns the link carries beside its two keys: what the link is worth, or when it
   * began. They are written by the database, not by the link, so each is nullable or has
   * a default of its own.
   */
  payload: string[]
}
export interface ConstraintInfo {
  schema: string
  table: string
  name: string
  type: string
  definition: string
  columns: string[]
  /** For a foreign key: the collection it points at. A key over several columns points
   * at one collection too, and is read as a constraint rather than as a relation. */
  target_schema?: string | null
  target_table?: string | null
  /** For a foreign key: the letter PostgreSQL keeps the delete rule by. */
  on_delete?: string | null
}
export interface TypeInfo {
  name: string
  schema: string
  bare: string
  label: string
  kind: string
}
export interface Catalog {
  schemas: SchemaInfo[]
  tables: TableInfo[]
  columns: ColumnInfo[]
  relations: RelationInfo[]
  constraints: ConstraintInfo[]
  types: TypeInfo[]
  indexes: IndexInfo[]
  joins: JoinInfo[]
}
export interface Identity {
  username: string
  effective_role: string
  database: string
  platform_version: string | null
  server_version: string
  can_create_workspace: boolean
  is_operator: boolean
}
export const emptyCatalog: Catalog = {
  schemas: [],
  tables: [],
  columns: [],
  relations: [],
  constraints: [],
  types: [],
  indexes: [],
  joins: [],
}
export const systemSchema = 'platform'
