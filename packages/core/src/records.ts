import { type Compilable, type Expression, type ExpressionBuilder, sql, type SqlBool } from 'kysely'
import { type Catalog, labelColumn, relationOf, tableOf } from './catalog.ts'
import type { Db } from './db.ts'
import { k } from './sql.ts'

export const operators = [
  'eq',
  'neq',
  'contains',
  'starts_with',
  'ends_with',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'not_in',
  'is_null',
  'not_null',
] as const
export type Operator = (typeof operators)[number]
export const valueless: readonly Operator[] = ['is_null', 'not_null']
export interface Condition {
  op: Operator
  value: unknown
}
export type Filter = Record<string, Condition>

/** Runs what Kysely wrote on the caller's own connection. */
export const run = <Row = Record<string, unknown>>(db: Db, query: Compilable) => {
  const compiled = query.compile()
  return db.query<Row>(compiled.sql, [...compiled.parameters])
}

// biome-ignore lint/suspicious/noExplicitAny: the columns are the installation's
type Eb = ExpressionBuilder<any, any>
const asText = (column: string) => sql<string>`cast(${sql.ref(column)} as text)`
/** `%` and `_` are what the reader typed, not wildcards. */
const escaped = (value: unknown) => String(value ?? '').replace(/([\\%_])/g, '\\$1')
const comparisons = { gt: '>', gte: '>=', lt: '<', lte: '<=' } as const

function condition(eb: Eb, column: string, { op, value }: Condition): Expression<SqlBool> {
  switch (op) {
    case 'eq':
      return eb(column, 'is not distinct from', value)
    case 'neq':
      return eb(column, 'is distinct from', value)
    case 'contains':
      return eb(asText(column), 'ilike', `%${escaped(value)}%`)
    case 'starts_with':
      return eb(asText(column), 'ilike', `${escaped(value)}%`)
    case 'ends_with':
      return eb(asText(column), 'ilike', `%${escaped(value)}`)
    case 'in':
    case 'not_in': {
      const values = [value].flat()
      return values.length ? eb(column, op === 'in' ? 'in' : 'not in', values) : eb.lit(true)
    }
    case 'is_null':
      return eb(column, 'is', null)
    case 'not_null':
      return eb(column, 'is not', null)
    default:
      if (!(op in comparisons)) throw new Error(`Unknown filter operator: ${String(op)}`)
      return eb(column, comparisons[op], value)
  }
}
/** The filters, and a search of every readable column as text. */
const predicate = (filter: Filter, search: string, searchable: readonly string[]) => (eb: Eb) =>
  eb.and([
    ...Object.entries(filter).map(([column, one]) => condition(eb, column, one)),
    ...(search.trim() && searchable.length
      ? [eb.or(searchable.map((c) => eb(asText(c), 'ilike', `%${escaped(search.trim())}%`)))]
      : []),
  ])

export interface RecordQuery {
  schema: string
  table: string
  columns: string[]
  searchable?: string[]
  filter?: Filter
  search?: string
  /** Column names; a leading `-` sorts descending. */
  sort?: string[]
  limit: number
  offset?: number
}
/** A page of records and the count of rows the same predicate allows under row security. */
export async function records(db: Db, q: RecordQuery) {
  const where = predicate(q.filter ?? {}, q.search ?? '', q.searchable ?? [])
  let page = k.withSchema(q.schema).selectFrom(q.table).select(q.columns).where(where)
  for (const name of q.sort ?? [])
    page = page.orderBy(name.replace(/^-/, ''), (o) =>
      (name.startsWith('-') ? o.desc() : o.asc()).nullsLast()
    )
  const rows = await run(db, page.limit(q.limit).offset(q.offset ?? 0))
  const counted = await run<{ total: number }>(
    db,
    k
      .withSchema(q.schema)
      .selectFrom(q.table)
      .select(sql<number>`count(*)::int`.as('total'))
      .where(where)
  )
  return { rows: rows.rows, total: counted.rows[0]?.total ?? 0 }
}

export async function record(db: Db, schema: string, table: string, columns: string[], id: string) {
  const found = await run(
    db,
    k.withSchema(schema).selectFrom(table).select(columns).where('id', '=', id)
  )
  return found.rows[0] ?? null
}

// Writes carry no RETURNING: the right to write a column is not a right to read it back.
export async function insertRecord(db: Db, schema: string, table: string, values: object) {
  const into = k.withSchema(schema).insertInto(table)
  const query = Object.keys(values).length ? into.values(values) : into.defaultValues()
  return (await run(db, query)).rowCount ?? 0
}
/** An update made from a record the reader opened is guarded by the version they saw. */
export async function updateRecord(
  db: Db,
  schema: string,
  table: string,
  id: string,
  values: object,
  version?: number | string
) {
  if (!Object.keys(values).length) return 0
  let query = k.withSchema(schema).updateTable(table).set(values).where('id', '=', id)
  if (version !== undefined) query = query.where('version', '=', version)
  return (await run(db, query)).rowCount ?? 0
}
export async function deleteRecord(
  db: Db,
  schema: string,
  table: string,
  id: string,
  version?: number | string
) {
  let query = k.withSchema(schema).deleteFrom(table).where('id', '=', id)
  if (version !== undefined) query = query.where('version', '=', version)
  return (await run(db, query)).rowCount ?? 0
}

/** The rows a relation may point at, by the column they are known by. */
export async function relationOptions(
  db: Db,
  schema: string,
  table: string,
  label: string | null,
  search: string
) {
  const shown = label ? asText(label) : asText('id')
  const term = search.trim()
  let query = k
    .withSchema(schema)
    .selectFrom(table)
    .select([asText('id').as('id'), shown.as('label')])
    .orderBy('label')
    .limit(20)
  if (term)
    query = query.where((eb) =>
      eb.or([eb(shown, 'ilike', `%${escaped(term)}%`), eb(asText('id'), '=', term)])
    )
  return (await run<{ id: string; label: string }>(db, query)).rows
}
/** The names of the rows a page of records points at, where the reader may read them. */
export async function relationLabels(
  db: Db,
  catalog: Catalog,
  schema: string,
  table: string,
  rows: Record<string, unknown>[],
  columns: string[]
) {
  const out: Record<string, Record<string, string>> = {}
  for (const column of columns) {
    const relation = relationOf(catalog, schema, table, column)
    const ids = [...new Set(rows.map((r) => r[column]).filter((v) => v != null))].map(String)
    if (!relation || !ids.length) continue
    const label = labelColumn(catalog, relation.target_schema, relation.target_table)
    if (!label || !tableOf(catalog, relation.target_schema, relation.target_table)?.can_select)
      continue
    const found = await run<{ id: string; label: string }>(
      db,
      k
        .withSchema(relation.target_schema)
        .selectFrom(relation.target_table)
        .select([asText('id').as('id'), asText(label).as('label')])
        .where(asText('id'), 'in', ids)
    ).catch(() => null) // a row policy or a column grant may refuse: the ids are shown instead
    if (found) out[column] = Object.fromEntries(found.rows.map((r) => [r.id, r.label]))
  }
  return out
}
