import { useMemo } from 'react'
import { type Filter, type Operator, operators, records, relationLabels } from '@platform/core'
import { useDb } from '../session/hooks.ts'
import { filterValue } from '../fields/filters.ts'
import { reachesOf } from '../fields/reach.ts'
import { resolveFields } from '../fields/resolve.ts'
import type { Field } from '../fields/types.ts'
export type Row = Record<string, unknown>
export const pageSizes = [25, 50, 100]

/** The filters the address says: `f.<field>=<operator>.<value>`. */
export function filterOf(
  params: URLSearchParams,
  byName: Record<string, Field>,
  targets: Record<string, Field[]> = {}
): Filter {
  const filter: Filter = {}
  for (const [key, value] of params) {
    if (!key.startsWith('f.')) continue
    const name = key.slice(2)
    const [op, ...rest] = value.split('.')
    // A condition on the rows a relation reaches: `through.<column>.<operator>.<value>`.
    if (op === 'through') {
      const [column, inner, ...held] = rest
      if (!column || !operators.includes(inner as Operator)) continue
      const field = targets[name]?.find((one) => one.name === column)
      const one = filterValue(field, inner as Operator, held.join('.'))
      filter[name] = {
        op: inner as Operator,
        value: one,
        through: { column, op: inner as Operator, value: one },
      }
      continue
    }
    if (!operators.includes(op as Operator)) continue
    filter[name] = {
      op: op as Operator,
      value: filterValue(byName[name], op as Operator, rest.join('.')),
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
  const readable = fields.filter((f) => f.column?.can_select)
  const shown = readable.filter((f) => f.views.list !== 'hide')
  const byName = Object.fromEntries(fields.map((f) => [f.name, f]))
  // How each relation is reached: the conditions that cross one, and the search that
  // follows the names of the rows on the other side.
  const reaches = useMemo(() => reachesOf(catalog, fields), [catalog, fields])
  // The fields of the rows a relation reaches: a condition may be on one of theirs.
  const targets = useMemo(() => {
    const out: Record<string, Field[]> = {}
    for (const [name, reach] of Object.entries(reaches)) {
      const other =
        reach.kind === 'column'
          ? { schema: reach.schema, table: reach.table }
          : { schema: reach.target_schema, table: reach.target_table }
      out[name] = resolveFields(catalog, other.schema, other.table)
    }
    return out
  }, [catalog, reaches])
  const hasId = readable.some((f) => f.name === 'id')
  const filter = filterOf(params, byName, targets)
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
        reaches,
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
