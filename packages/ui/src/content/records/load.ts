import { type Catalog, type Filter, fieldMetadata, records, relationLabels } from '@platform/data'
import { useLoad } from '../../session.tsx'

/**
 * The page of records the database holds: the rows themselves, the names of the rows they
 * point at, and what each field is called.
 */
export function useRecordsLoad({
  catalog,
  ws,
  table,
  readable,
  filter,
  search,
  sort,
  limit,
  pageNumber,
}: {
  catalog: Catalog
  ws: string
  table: string
  /** The columns the reader may read. */
  readable: { name: string }[]
  filter: Filter
  search: string
  sort: string[]
  limit: number
  pageNumber: number
}) {
  return useLoad(
    readable.length
      ? async (db) => {
          const page = await records(db, {
            schema: ws,
            table,
            columns: readable.map((c) => c.name),
            searchable: readable.map((c) => c.name),
            filter,
            search,
            sort,
            limit,
            offset: (pageNumber - 1) * limit,
          })
          const labels = await relationLabels(
            db,
            catalog,
            ws,
            table,
            page.rows,
            readable.map((c) => c.name)
          )
          // The fields' own metadata: what each is called, where it appears and how it is
          // drawn, for the fields this reader reaches.
          const described = await fieldMetadata(db, ws, table)
          return { ...page, labels, described }
        }
      : null,
    [ws, table, JSON.stringify(filter), search, sort.join(','), limit, pageNumber, catalog]
  )
}
