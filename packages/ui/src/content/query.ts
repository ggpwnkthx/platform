import { type Filter, type Operator, operators, records, relationLabels } from '@platform/core'
import { useDb } from '../session/hooks.ts'
import { filterValue } from '../fields/filters.ts'
import type { Field } from '../fields/types.ts'
export type Row = Record<string, unknown>
export const pageSizes = [25, 50, 100]

/** The filters the address says: `f.<field>=<operator>.<value>`. */
export function filterOf(params: URLSearchParams, byName: Record<string, Field>): Filter {
  const filter: Filter = {}
  for (const [key, value] of params) {
    if (!key.startsWith('f.')) continue
    const [op, ...rest] = value.split('.')
    if (!operators.includes(op as Operator)) continue
    filter[key.slice(2)] = {
      op: op as Operator,
      value: filterValue(byName[key.slice(2)], op as Operator, rest.join('.')),
    }
  }
  return filter
}

/**
 * A page of records, read as the reader: the filters and the search of the address, the
 * fields that may be read, and the names of the rows they point at.
 */
export function useRecords({
  catalog,
  ws,
  table,
  fields,
  enabled,
  params,
}: {
  catalog: Parameters<typeof relationLabels>[1]
  ws: string
  table: string
  fields: Field[]
  enabled: boolean
  params: URLSearchParams
}) {
  const readable = fields.filter((f) => f.column.can_select)
  const shown = readable.filter((f) => f.views.list !== 'hide')
  const byName = Object.fromEntries(fields.map((f) => [f.name, f]))
  const hasId = readable.some((f) => f.name === 'id')
  const filter = filterOf(params, byName)
  const q = params.get('q') ?? ''
  const sort = params.get('sort') ?? ''
  const page = Number(params.get('page')) || 1
  const size = Number(params.get('size')) || pageSizes[0]!
  const columns = [
    ...new Set([
      ...shown.map((f) => f.name),
      ...(hasId ? ['id'] : []),
      ...(readable.some((f) => f.name === 'version') ? ['version'] : []),
    ]),
  ]
  const found = useDb(
    ['records', ws, table, columns, params.toString()],
    async (session) => {
      const result = await records(session, {
        schema: ws,
        table,
        columns,
        filter,
        search: q,
        sort: sort ? [sort] : [],
        searchable: readable.map((f) => f.name),
        limit: size,
        offset: (page - 1) * size,
      })
      const relations = shown.filter((f) => f.relation).map((f) => f.name)
      return {
        ...result,
        labels: await relationLabels(session, catalog, ws, table, result.rows, relations),
      }
    },
    enabled && columns.length > 0
  )
  return { found, readable, shown, hasId, filter, q, sort, page, size }
}
