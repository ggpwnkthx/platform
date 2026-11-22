import type { Catalog, ColumnInfo, TableInfo } from '@platform/data'
import { fieldMetadata, record, relationLabels } from '@platform/data'
import { useLoad } from '../../session.tsx'

/**
 * What the record is: the row itself, the names of the rows it points at, and the fields it
 * has. The record is read only when there is a column to read it with.
 */
export function useRecordLoad({
  catalog,
  creating,
  id,
  info,
  readable,
  table,
  ws,
}: {
  catalog: Catalog
  creating: boolean
  id: string
  info: TableInfo | undefined
  readable: ColumnInfo[]
  table: string
  ws: string
}) {
  const wanted = !creating && Boolean(info) && readable.length > 0
  const loaded = useLoad(
    // One connection, two questions: the record itself, and what its fields are called and
    // where they appear. A field this reader may not reach is not in the second answer:
    // The database did not return its metadata.
    info
      ? async (db) => {
          const row = wanted
            ? await record(
                db,
                ws,
                table,
                readable.map((c) => c.name),
                id
              )
            : null
          // The name of the row a relation points at, so the record may draw it by name.
          const labels = row
            ? await relationLabels(
                db,
                catalog,
                ws,
                table,
                [row],
                readable.map((c) => c.name)
              )
            : {}
          return {
            record: row,
            labels,
            described: await fieldMetadata(db, ws, table),
          }
        }
      : null,
    [ws, table, id, catalog, creating, wanted]
  )
  return { loaded, wanted }
}
