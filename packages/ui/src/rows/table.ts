import { type Operator, tableOf } from '@platform/core'
import { use } from 'react'
import { useResourceContext } from 'react-admin'
import { columnsOfTable, placeOf } from '../columns/resolve.ts'
import { useNames } from '../kit/place.ts'
import { useSession } from '../session/session.ts'

/** The table a page is about: what PostgreSQL says of it, its columns, and what it is called. */
export function useTable() {
  const resource = useResourceContext()!
  const { db, catalog, presentations } = useSession()
  const { schema, table } = placeOf(resource)
  const columns = use(columnsOfTable(db, catalog, presentations, resource))
  return {
    resource,
    schema,
    table,
    columns,
    info: tableOf(catalog, schema, table),
    said: useNames()(schema, table),
    schemaSaid: useNames()(schema),
    hasId: columns.some((f) => f.name === 'id' && f.column?.can_select),
  }
}

/** The conditions a filter may carry, as they are said. */
export const operatorWords: Record<Operator, string> = {
  eq: 'is',
  neq: 'is not',
  contains: 'contains',
  starts_with: 'starts with',
  ends_with: 'ends with',
  matches: 'has the words',
  gt: 'is more than',
  gte: 'is at least',
  lt: 'is less than',
  lte: 'is at most',
  in: 'is one of',
  not_in: 'is none of',
  has_any: 'is linked to any of',
  has_none: 'is linked to none of',
  has_all: 'is linked to all of',
  is_null: 'is empty',
  not_null: 'is not empty',
}
