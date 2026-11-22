import { useMemo } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import { columnsOf, presentationOf, tableOf } from '@platform/data'
import { resolveFields } from '../../fields/resolve.ts'
import { useSession } from '../../session.tsx'
import { useWorkspaceView } from '../../workspace/view.ts'
import { cameFrom, fieldsOf, startOf } from './helpers.ts'
import { useRecordLoad } from './load.ts'

/**
 * The page of a record: what it is, where it is, and what the reader may reach of it. The
 * record is read once, and the fields of the collection are worked out from what the database
 * said of them.
 */
export function useRecordPage() {
  const { catalog, presentations, refresh } = useSession()
  const location = useLocation()
  const { ws, shown: workspace } = useWorkspaceView()
  const table = location.query.c ?? ''
  const collection = presentationOf(presentations, ws, table)
  const id = location.query.id ?? '+'
  const creating = id === '+'
  const from = cameFrom(location.query.from)
  // What the address says a new record starts with, as one text: it changes when the address does.
  const startText = creating ? JSON.stringify(startOf(location.query)) : '{}'
  const info = tableOf(catalog, ws, table)
  const columns = columnsOf(catalog, ws, table)
  const readable = columns.filter((c) => c.can_select)
  const { loaded, wanted } = useRecordLoad({
    catalog,
    creating,
    id,
    info,
    readable,
    table,
    ws,
  })
  const original = loaded.data?.record ?? null
  // The fields of the collection, each read once: what the database says of the column, what
  // the field says of itself — its name, where it appears, how it is drawn — and the type
  // that follows. The saying is the field's own metadata, so the database's row security
  // decided who may read it.
  const described = loaded.data?.described
  const all = useMemo(
    () => resolveFields(catalog, ws, table, described),
    [catalog, ws, table, described]
  )
  const { fields, unreachable, withheld } = fieldsOf(all, creating)
  const version = typeof original?.version === 'number' ? original.version : undefined
  return {
    all,
    catalog,
    collection,
    creating,
    fields,
    from,
    id,
    info,
    loaded,
    original,
    readable,
    refresh,
    startText,
    table,
    unreachable,
    version,
    wanted,
    withheld,
    workspace,
    ws,
  }
}
