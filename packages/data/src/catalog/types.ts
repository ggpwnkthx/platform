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
  /** 's' when PostgreSQL computes the column itself: a generated column. */
  generated: string | null
  /** 'a' or 'd' when PostgreSQL numbers the column itself: an identity column. */
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
  /** The types the database holds, outside PostgreSQL's own: an extension's, or the installation's. */
  types: TypeInfo[]
}

/**
 * A type the database holds. The platform knows a dozen of its own — text, a number, a
 * moment — and the rest are the installation's: `geometry` and `geography` where PostGIS is
 * installed, an enum or a domain of its own. A field may have any of them.
 */
export interface TypeInfo {
  /** The type's name, qualified with the schema it lives in: `public.geometry`. */
  name: string
  /** The schema the type lives in. */
  schema: string
  /** The type's own name, without the schema: `geometry`. */
  bare: string
  /** The type as PostgreSQL writes it. */
  label: string
  /** b base, d domain, e enum, c composite, r range, m multirange. */
  kind: string
}
