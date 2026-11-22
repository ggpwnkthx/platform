import type { Db } from './db.ts'
import { systemFields } from './sql.ts'

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

export async function identity(db: Db): Promise<Identity> {
  const result = await db.query<Identity>(`
    SELECT session_user::text AS username, current_user::text AS effective_role,
           current_database()::text AS database,
           (SELECT version FROM platform.installation) AS platform_version,
           current_setting('server_version') AS server_version,
           has_database_privilege(current_database(), 'CREATE') AS can_create_workspace,
           platform.is_operator() AS is_operator`)
  return result.rows[0]!
}

const held = `n.nspname NOT LIKE 'pg\\_%' ESCAPE '\\' AND n.nspname NOT IN ('information_schema','public')`
const system = `n.nspname = '${systemSchema}'`
const usable = `${held} AND has_schema_privilege(n.oid, 'USAGE')`

/**
 * The catalog as the caller may see it, from PostgreSQL's own privilege functions. The
 * platform's schema is in it as a workspace of another kind, whose model nobody may change.
 */
export async function catalog(db: Db): Promise<Catalog> {
  const rows = async <T>(text: string) => (await db.query<T>(text)).rows
  const schemas = await rows<SchemaInfo>(`
    SELECT n.nspname::text AS name, pg_get_userbyid(n.nspowner)::text AS owner,
           CASE WHEN ${system} THEN 'system' ELSE 'user' END AS kind,
           has_schema_privilege(n.oid, 'CREATE') AND NOT ${system} AS can_create,
           pg_has_role(current_user, n.nspowner, 'USAGE') AND NOT ${system} AS can_alter
      FROM pg_namespace n WHERE ${usable} ORDER BY ${system}, 1`)
  const tables = await rows<TableInfo>(`
    SELECT n.nspname::text AS schema, c.relname::text AS name, c.relkind::text AS kind,
           c.relrowsecurity AS rls, c.relforcerowsecurity AS force_rls,
           pg_get_userbyid(c.relowner)::text AS owner, obj_description(c.oid, 'pg_class') AS comment,
           ${system} AS system,
           has_table_privilege(c.oid, 'SELECT') AS can_select,
           has_table_privilege(c.oid, 'INSERT') AS can_insert,
           has_table_privilege(c.oid, 'UPDATE') AS can_update,
           has_table_privilege(c.oid, 'DELETE') AS can_delete,
           has_table_privilege(c.oid, 'TRUNCATE') AND NOT ${system} AS can_truncate,
           pg_has_role(current_user, c.relowner, 'USAGE') AND NOT ${system} AS can_alter
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r','p','v') AND ${usable}
       AND (has_any_column_privilege(c.oid, 'SELECT,INSERT,UPDATE')
            OR has_table_privilege(c.oid, 'DELETE,TRUNCATE')
            OR pg_has_role(current_user, c.relowner, 'USAGE'))
     ORDER BY 1, 2`)
  const columns = await rows<ColumnInfo>(`
    SELECT n.nspname::text AS schema, c.relname::text AS table, a.attname::text AS name,
           a.attnum::int AS position, format_type(a.atttypid, a.atttypmod) AS type,
           a.attnotnull AS required, pg_get_expr(d.adbin, d.adrelid) AS "default",
           col_description(c.oid, a.attnum) AS comment,
           a.attgenerated::text AS generated, a.attidentity::text AS identity,
           has_column_privilege(c.oid, a.attnum, 'SELECT') AS can_select,
           has_column_privilege(c.oid, a.attnum, 'INSERT') AS can_insert,
           has_column_privilege(c.oid, a.attnum, 'UPDATE') AS can_update
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
     WHERE a.attnum > 0 AND NOT a.attisdropped AND c.relkind IN ('r','p','v') AND ${usable}
     ORDER BY 1, 2, a.attnum`)
  const relations = await rows<RelationInfo>(`
    SELECT n.nspname::text AS schema, c.relname::text AS table, a.attname::text AS column,
           rn.nspname::text AS target_schema, rc.relname::text AS target_table,
           con.confdeltype::text AS on_delete
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_class rc ON rc.oid = con.confrelid JOIN pg_namespace rn ON rn.oid = rc.relnamespace
      JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
     WHERE con.contype = 'f' AND ${usable} ORDER BY 1, 2, 3`)
  const constraints = await rows<ConstraintInfo>(`
    SELECT n.nspname::text AS schema, c.relname::text AS table, con.conname::text AS name,
           con.contype::text AS type, pg_get_constraintdef(con.oid) AS definition,
           ARRAY(SELECT a.attname::text FROM pg_attribute a
                  WHERE a.attrelid = con.conrelid AND a.attnum = ANY(con.conkey)) AS columns
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE ${usable} AND con.contype IN ('c','u','p','f','x') ORDER BY 1, 2, 3`)
  const types = await rows<TypeInfo>(`
    SELECT n.nspname::text AS schema, t.typname::text AS bare,
           n.nspname || '.' || t.typname AS name, t.typtype::text AS kind,
           format_type(t.oid, NULL) AS label
      FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE t.typtype IN ('b','c','d','e','r','m') AND t.typrelid = 0
       AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
       AND has_schema_privilege(n.oid, 'USAGE')
       AND NOT EXISTS (SELECT 1 FROM pg_type e WHERE e.oid = t.typelem AND e.typarray = t.oid)
     ORDER BY 1, 2`)
  const visible = new Set(tables.map((t) => `${t.schema}.${t.name}`))
  const inView = <T extends { schema: string; table: string }>(all: T[]) =>
    all.filter((row) => visible.has(`${row.schema}.${row.table}`))
  return {
    schemas,
    tables,
    columns: inView(columns),
    relations: inView(relations),
    constraints: inView(constraints),
    types,
  }
}

export const tablesIn = (catalog: Catalog, schema: string) =>
  catalog.tables.filter((t) => t.schema === schema)
export const tableOf = (catalog: Catalog, schema: string, table: string) =>
  catalog.tables.find((t) => t.schema === schema && t.name === table)
export const columnsOf = (catalog: Catalog, schema: string, table: string) =>
  catalog.columns.filter((c) => c.schema === schema && c.table === table)
export const relationOf = (catalog: Catalog, schema: string, table: string, column: string) =>
  catalog.relations.find((r) => r.schema === schema && r.table === table && r.column === column)

/** The values a CHECK holds a column to, read back from the constraint PostgreSQL keeps. */
export function choicesOf(catalog: Catalog, schema: string, table: string, column: string) {
  const quoted = column.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const shape = new RegExp(
    `^CHECK \\(+"?${quoted}"?\\)?(?:::text)? = ANY \\(+ARRAY\\[(.*)\\][^\\]]*$`
  )
  for (const constraint of catalog.constraints) {
    if (constraint.schema !== schema || constraint.table !== table || constraint.type !== 'c')
      continue
    const match = constraint.definition.match(shape)
    if (!match?.[1]) continue
    const values = [...match[1].matchAll(/'((?:[^']|'')*)'(?:::[a-z ]+)?/g)].map((m) =>
      m[1]!.replaceAll("''", "'")
    )
    if (values.length) return values
  }
  return null
}

const systemLabels: Record<string, string> = {
  item_metadata: 'key',
  activity: 'operation',
  revisions: 'operation',
  installation: 'version',
}
/** The column a row is known by: the one its owner named, or the likeliest text. */
export function labelColumn(
  catalog: Catalog,
  schema: string,
  table: string,
  display?: string | null
): string | null {
  const columns = columnsOf(catalog, schema, table).filter((c) => c.can_select)
  const has = (name?: string | null) => !!name && columns.some((c) => c.name === name)
  if (has(display)) return display!
  if (schema === systemSchema && has(systemLabels[table])) return systemLabels[table]!
  const preferred = columns.find((c) => ['name', 'title', 'full_name', 'label'].includes(c.name))
  if (preferred) return preferred.name
  const text = columns.find(
    (c) => !systemFields.includes(c.name) && /^(text|character varying)/.test(c.type)
  )
  return text?.name ?? null
}

export type Kind =
  | 'text'
  | 'integer'
  | 'number'
  | 'boolean'
  | 'date'
  | 'time'
  | 'moment'
  | 'uuid'
  | 'json'
  | 'other'
export function kindOf(type: string): Kind {
  if (/^(text|character varying|character|varchar|citext|name)/.test(type)) return 'text'
  if (/^(integer|bigint|smallint)$/.test(type)) return 'integer'
  if (/^(numeric|double precision|real)/.test(type)) return 'number'
  if (type === 'boolean') return 'boolean'
  if (type === 'date') return 'date'
  if (/^time( without| with|$|\()/.test(type)) return 'time'
  if (/^timestamp/.test(type)) return 'moment'
  if (type === 'uuid') return 'uuid'
  if (/^jsonb?$/.test(type)) return 'json'
  return 'other'
}
