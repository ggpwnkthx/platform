import { insertRow, parseCsv, toCsv, transaction } from '@platform/core'
import type { GetListParams } from 'react-admin'
import { columnsOfTable, placeOf } from '../columns/resolve.ts'
import type { Column } from '../columns/types.ts'
import { session } from '../session/session.ts'
import { getList } from './rows.ts'

/**
 * A table's rows out to a CSV file and in from one. Out, the reader gets what the grid
 * reads for them: the columns they may read, under the filters and the sort in view. In, every
 * row is one INSERT as the reader, in one transaction: one refused, none is written.
 */
const columnsIn = (resource: string) => {
  const { db, catalog, presentations } = session.get()!
  return columnsOfTable(db, catalog, presentations, resource)
}
export async function exportCsv(resource: string, params: GetListParams) {
  const readable = (await columnsIn(resource))
    .filter((f) => f.column?.can_select)
    .map((f) => f.name)
  const found = await getList(resource, { ...params, pagination: { page: 1, perPage: 10000 } })
  return { csv: toCsv(readable, found.data), count: found.data.length, total: found.total }
}

/** The columns a column of the file is written to: by the column's own name, or the name people read. */
export interface Plan {
  header: string[]
  columns: (Column | null)[]
  rows: string[][]
}
export const writable = (f: Column) => !!f.column?.can_insert && !f.computed && !f.system
export async function planImport(resource: string, text: string): Promise<Plan> {
  const [header = [], ...rows] = parseCsv(text)
  const all = await columnsIn(resource)
  const columns = header.map(
    (h) =>
      all.find(
        (f) =>
          writable(f) && (f.name === h.trim() || f.label.toLowerCase() === h.trim().toLowerCase())
      ) ?? null
  )
  return { header, columns, rows }
}
export async function importCsv(resource: string, plan: Plan) {
  const { db } = session.get()!
  const { schema, table } = placeOf(resource)
  await db.exclusive((one) =>
    transaction(one, async () => {
      for (const [at, row] of plan.rows.entries()) {
        // An empty cell gives nothing, so the column's default applies.
        const values = Object.fromEntries(
          plan.columns.flatMap((f, i) =>
            f && row[i] !== undefined && row[i] !== '' ? [[f.name, row[i]]] : []
          )
        )
        try {
          await insertRow(one, schema, table, values)
        } catch (error) {
          throw Object.assign(error as object, {
            message: `Line ${at + 2}: ${(error as Error).message}`,
          })
        }
      }
    })
  )
  return plan.rows.length
}
