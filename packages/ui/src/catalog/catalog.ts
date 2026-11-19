import type { Catalog, ColumnInfo, RelationInfo, TableInfo } from './types.ts'

/** Questions about the catalog. Every answer is one PostgreSQL gave this reader. */

export const systemColumns = [
  'id',
  'created_at',
  'updated_at',
  'created_by',
  'updated_by',
  'version',
]

export const tablesIn = (catalog: Catalog, schema: string): TableInfo[] =>
  catalog.tables.filter((t) => t.schema === schema)

export const tableOf = (catalog: Catalog, schema: string, table: string): TableInfo | undefined =>
  catalog.tables.find((t) => t.schema === schema && t.name === table)

export const columnsOf = (catalog: Catalog, schema: string, table: string): ColumnInfo[] =>
  catalog.columns.filter((c) => c.schema === schema && c.table === table)

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

/** The column that names a row: the metadata's display_field, else the first readable text column. */
export function labelColumn(
  catalog: Catalog,
  schema: string,
  table: string,
  display?: string | null
): string | null {
  const columns = columnsOf(catalog, schema, table).filter((c) => c.can_select)
  if (display && columns.some((c) => c.name === display)) return display
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
