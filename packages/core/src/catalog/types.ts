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
  on_delete: string
}
export interface ConstraintInfo {
  schema: string
  table: string
  name: string
  type: string
  definition: string
  columns: string[]
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
}
export const systemSchema = 'platform'
