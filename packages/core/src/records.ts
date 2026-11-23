import { labelColumn, relationOf, tableOf } from './catalog/labels.ts'
import type { Catalog } from './catalog/types.ts'
import type { Db } from './db.ts'
import { k, sql } from './sql/kit.ts'
import { asText, pattern, run } from './records/query.ts'
import { predicate } from './records/conditions.ts'
import type { Filter, RelationReach } from './records/query.ts'

export {
  countLinked,
  insertRecordWithLinks,
  linkedRows,
  namesOf,
  setLinks,
} from './records/links.ts'

export interface RecordQuery {
  schema: string
  table: string
  columns: string[]
  searchable?: string[]
  filter?: Filter
  /** How each relation of the collection is reached, for the conditions that cross one. */
  reaches?: Record<string, RelationReach>
  search?: string
  /** Column names; a leading `-` sorts descending. */
  sort?: string[]
  limit: number
  offset?: number
}
/** A page of records and the count of rows the same predicate allows under row security. */
export async function records(db: Db, q: RecordQuery) {
  const where = predicate({
    filter: q.filter ?? {},
    search: q.search ?? '',
    searchable: q.searchable ?? [],
    base: { schema: q.schema, table: q.table },
    reaches: q.reaches ?? {},
  })
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
  search: string,
  limit = 20
) {
  const shown = label ? asText(label) : asText('id')
  const term = search.trim()
  let query = k
    .withSchema(schema)
    .selectFrom(table)
    .select([asText('id').as('id'), shown.as('label')])
    .orderBy('label')
    .limit(limit)
  if (term)
    query = query.where((eb) =>
      eb.or([eb(shown, 'ilike', pattern(term, 'any')), eb(asText('id'), '=', term)])
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
