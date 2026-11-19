/** What PostgreSQL says about the database it holds: its schemas, tables, columns and the
 * relations between them. Every answer is one PostgreSQL gave this reader. */

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
