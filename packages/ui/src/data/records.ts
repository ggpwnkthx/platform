import {
  type Condition,
  type Db,
  deleteRecord,
  type Filter,
  insertRecord,
  insertRecordWithLinks,
  k,
  linkedRows,
  type Operator,
  operators,
  record,
  records,
  run,
  setLinks,
  sqlState,
  transaction,
  updateRecord,
  valueless,
} from '@platform/core'
import type { GetListParams, RaRecord } from 'react-admin'
import { fieldsOf, placeOf, reachesOf } from '../fields/resolve.ts'
import type { Field } from '../fields/types.ts'
import { session } from '../session/session.ts'

/**
 * The records of a collection, as react-admin asks for them. Each is ordinary SQL run as the
 * reader: PostgreSQL decides what is read and what is written, writes carry no RETURNING, and
 * an update is guarded by the version the reader saw.
 */
type Row = Record<string, unknown>
const here = (resource: string) => {
  const { db, catalog, presentations } = session.get()!
  return {
    db,
    catalog,
    ...placeOf(resource),
    fields: fieldsOf(db, catalog, presentations, resource),
  }
}
const readable = (fields: Field[]) => fields.filter((f) => f.column?.can_select).map((f) => f.name)
/** react-admin knows a record by its id; a relation without one is known by what it holds. */
const identified = (row: Row): RaRecord => ({
  ...row,
  id: (row.id as string) ?? JSON.stringify(row),
})

/** The conditions the address carries: `{ field: { op, value } }`, or a bare value that must equal. */
function filterOf(said: Row, fields: Field[]): Filter {
  const filter: Filter = {}
  for (const [name, given] of Object.entries(said)) {
    const field = fields.find((f) => f.name === name)
    const one = (
      given && typeof given === 'object' && 'op' in given ? given : { op: 'eq', value: given }
    ) as Condition
    if (!field || !operators.includes(one.op as Operator)) continue
    const empty =
      one.value === '' || one.value == null || (Array.isArray(one.value) && !one.value.length)
    if (empty && !valueless.includes(one.op)) continue
    const many = ['in', 'not_in', 'has_any', 'has_none', 'has_all'].includes(one.op)
    const list = (value: unknown) =>
      Array.isArray(value)
        ? value
        : String(value)
            .split(',')
            .map((v) => v.trim())
    filter[name] = { op: one.op, value: many ? list(one.value) : one.value }
  }
  return filter
}

export async function getList(resource: string, params: GetListParams) {
  const { db, catalog, schema, table, fields: found } = here(resource)
  const fields = await found
  const { q, ...said } = (params.filter ?? {}) as Row
  const { page = 1, perPage = 25 } = params.pagination ?? {}
  const sort = params.sort?.field && fields.some((f) => f.name === params.sort!.field && f.column)
  const result = await records(db, {
    schema,
    table,
    columns: readable(fields),
    searchable: readable(fields),
    search: typeof q === 'string' ? q : '',
    filter: filterOf(said, fields),
    reaches: reachesOf(catalog, fields),
    sort: sort ? [`${params.sort!.order === 'DESC' ? '-' : ''}${params.sort!.field}`] : [],
    limit: perPage,
    offset: (page - 1) * perPage,
  })
  return { data: result.rows.map(identified), total: result.total }
}

/** One record, with the rows a join table links it to: their ids, as the form holds them. */
export async function getOne(resource: string, id: string) {
  const { db, catalog, schema, table, fields: found } = here(resource)
  const fields = await found
  const row = (await record(db, schema, table, readable(fields), id)) as Row | null
  if (!row)
    throw new Error(
      'No such record that you may read: it is gone, or a row policy keeps it from you.'
    )
  for (const field of fields.filter((f) => f.link?.kind === 'links'))
    row[field.name] = (await linkedRows(db, catalog, field.link!.path, id).catch(() => [])).map(
      (linked) => linked.id
    )
  return identified(row)
}

export async function getMany(resource: string, ids: unknown[]) {
  const { db, schema, table, fields } = here(resource)
  const query = k
    .withSchema(schema)
    .selectFrom(table)
    .select(readable(await fields))
    .where('id', 'in', ids)
  return (await run<Row>(db, query)).rows.map(identified)
}

/** What the form holds, as the columns receive it: only what the reader may write and did change. */
function written(fields: Field[], data: Row, previous?: Row) {
  const text = (value: unknown) => JSON.stringify(value ?? null)
  // A document is held as text by the form and as a document by the record.
  const same = (a: unknown, b: unknown) =>
    text(a) === text(b) || (typeof a === 'string' && a === text(b))
  const values: Row = {}
  const links: { path: NonNullable<Field['link']>['path']; ids: string[] }[] = []
  for (const field of fields) {
    const held = field.type.toColumn ? field.type.toColumn(data[field.name]) : data[field.name]
    if (previous ? same(held, previous[field.name]) : held == null || same(held, [])) continue
    if (field.link?.kind === 'links')
      links.push({ path: field.link.path, ids: (held as unknown[]).map(String) })
    else if (field.column && !field.system && !field.computed) values[field.name] = held
  }
  return { values, links }
}

export async function create(resource: string, data: Row) {
  const { db, schema, table, fields } = here(resource)
  const { values, links } = written(await fields, data)
  let note: string | undefined
  await db.exclusive(async (one) => {
    if (!links.length) return void (await insertRecord(one, schema, table, values))
    // The links need the new row's id, which is read back: a writer who may not read writes the row alone.
    await insertRecordWithLinks(one, schema, table, values, links).catch(async (error) => {
      if (sqlState(error) !== '42501') throw error
      await insertRecord(one, schema, table, values)
      note = 'The record was written; its links were not: you may not read the row you wrote.'
    })
  })
  return { id: 'written', ...data, note }
}

export async function update(resource: string, id: string, data: Row, previous: Row) {
  const { db, schema, table, fields } = here(resource)
  const { values, links } = written(await fields, data, previous)
  await db.exclusive((one: Db) =>
    transaction(one, async () => {
      const changed = Object.keys(values).length
        ? await updateRecord(one, schema, table, id, values, previous.version as number)
        : 1
      if (!changed) {
        const now = (await record(one, schema, table, ['version'], id).catch(
          () => null
        )) as Row | null
        throw new Error(
          now && now.version !== previous.version
            ? 'Someone changed this record since you opened it. Read it again before saving.'
            : 'PostgreSQL changed no row: a row policy refused the change, or the row is gone.'
        )
      }
      for (const link of links) await setLinks(one, link.path, id, link.ids)
    })
  )
  return getOne(resource, id)
}

/** Deletes rows, each under the version the reader saw of it, all or none. */
export async function remove(resource: string, ids: string[], versions: Row = {}) {
  const { db, schema, table } = here(resource)
  await db.exclusive((one: Db) =>
    transaction(one, async () => {
      for (const id of ids)
        if (!(await deleteRecord(one, schema, table, id, versions[id] as number | undefined)))
          throw new Error(
            `PostgreSQL deleted no row for ${id}: it changed since you read it, or a row policy refused. Nothing was deleted.`
          )
    })
  )
}
