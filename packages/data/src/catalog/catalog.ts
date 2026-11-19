import type { Catalog, ColumnInfo, RelationInfo, SchemaInfo, TableInfo } from './types.ts'

/** Questions about the catalog. Every answer is one PostgreSQL gave this reader. */

export const systemColumns = [
  'id',
  'created_at',
  'updated_at',
  'created_by',
  'updated_by',
  'version',
]

/** The schema that is the platform's own: the one system workspace. */
export const systemSchema = 'platform'

/** The name people read for the system workspace. */
export const systemWorkspaceName = 'Platform'

/** The workspaces of the installation: every schema the reader may use but the platform's own. */
export const userSchemas = (catalog: Catalog): SchemaInfo[] =>
  catalog.schemas.filter((s) => s.kind !== 'system')

/** The system workspace, when the reader may use it. */
export const systemWorkspace = (catalog: Catalog): SchemaInfo | undefined =>
  catalog.schemas.find((s) => s.kind === 'system')

/** Is this workspace the platform's own? */
export const isSystemWorkspace = (catalog: Catalog, schema: string): boolean =>
  catalog.schemas.some((s) => s.name === schema && s.kind === 'system')

/**
 * The column that names a row of a system collection. A collection of the installation's
 * says it in its own metadata; the platform's own say it here, because what names a row of
 * theirs is not the first text they hold — a piece of metadata is named by its key, not by
 * the scope it is said of.
 */
const systemLabels: Record<string, string> = {
  [`${systemSchema}.item_metadata`]: 'key',
  [`${systemSchema}.activity`]: 'operation',
  [`${systemSchema}.installation`]: 'version',
}

export const tablesIn = (catalog: Catalog, schema: string): TableInfo[] =>
  catalog.tables.filter((t) => t.schema === schema)

export const tableOf = (catalog: Catalog, schema: string, table: string): TableInfo | undefined =>
  catalog.tables.find((t) => t.schema === schema && t.name === table)

export const columnsOf = (catalog: Catalog, schema: string, table: string): ColumnInfo[] =>
  catalog.columns.filter((c) => c.schema === schema && c.table === table)

/** One column of a collection, as the catalog holds it. */
export const columnOf = (
  catalog: Catalog,
  schema: string,
  table: string,
  column: string
): ColumnInfo | undefined =>
  catalog.columns.find((c) => c.schema === schema && c.table === table && c.name === column)

export const relationOf = (
  catalog: Catalog,
  schema: string,
  table: string,
  column: string
): RelationInfo | undefined =>
  catalog.relations.find((r) => r.schema === schema && r.table === table && r.column === column)

/** The values a CHECK (column IN (...)) allows, so the column is chosen from a list. */
export function choicesOf(
  catalog: Catalog,
  schema: string,
  table: string,
  column: string
): string[] | null {
  for (const constraint of catalog.constraints) {
    if (constraint.schema !== schema || constraint.table !== table || constraint.type !== 'c')
      continue
    const quoted = column.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = constraint.definition.match(
      new RegExp(`^CHECK \\(+"?${quoted}"?\\)?(?:::text)? = ANY \\(+ARRAY\\[(.*)\\][^\\]]*$`)
    )
    if (!match?.[1]) continue
    const values = [...match[1].matchAll(/'((?:[^']|'')*)'(?:::[a-z ]+)?/g)].map((m) =>
      m[1]!.replaceAll("''", "'")
    )
    if (values.length) return values
  }
  return null
}

/**
 * The column that names a row: the metadata's display_field, else the one a system
 * collection is named by, else the first readable text column.
 */
export function labelColumn(
  catalog: Catalog,
  schema: string,
  table: string,
  display?: string | null
): string | null {
  const columns = columnsOf(catalog, schema, table).filter((c) => c.can_select)
  if (display && columns.some((c) => c.name === display)) return display
  const own = systemLabels[`${schema}.${table}`]
  if (own && columns.some((c) => c.name === own)) return own
  const preferred = columns.find((c) => ['name', 'title', 'full_name', 'label'].includes(c.name))
  if (preferred) return preferred.name
  const text = columns.find(
    (c) => !systemColumns.includes(c.name) && /^(text|character varying)/.test(c.type)
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
