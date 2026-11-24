import { systemFields } from '../sql/columns.ts'
import { type Catalog, systemSchema } from './types.ts'

export const tablesIn = (catalog: Catalog, schema: string) =>
  catalog.tables.filter((t) => t.schema === schema)
export const tableOf = (catalog: Catalog, schema: string, table: string) =>
  catalog.tables.find((t) => t.schema === schema && t.name === table)
export const columnsOf = (catalog: Catalog, schema: string, table: string) =>
  catalog.columns.filter((c) => c.schema === schema && c.table === table)
export const relationOf = (catalog: Catalog, schema: string, table: string, column: string) =>
  catalog.relations.find((r) => r.schema === schema && r.table === table && r.column === column)
/** The constraints a collection holds: the rules PostgreSQL keeps about its rows. */
export const constraintsOf = (catalog: Catalog, schema: string, table: string) =>
  catalog.constraints.filter((c) => c.schema === schema && c.table === table)
/** The indexes a collection holds: the ways its rows are found without a scan. */
export const indexesOf = (catalog: Catalog, schema: string, table: string) =>
  catalog.indexes.filter((i) => i.schema === schema && i.table === table)

/**
 * The rule that decides what happens to a row that points at a row that goes, as
 * PostgreSQL keeps it: the letter of the catalog, said the way a reader says it.
 */
export const deleteRule = (code: string) =>
  ({
    a: 'no action',
    r: 'restrict',
    c: 'cascade',
    n: 'set null',
    d: 'set default',
  })[code] ?? code

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
