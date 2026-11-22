import { useState } from 'preact/hooks'
import { deleteRecord } from '@platform/data'
import { plural } from '../../format.ts'
import { describe, useSession } from '../../session.tsx'

/**
 * The records the reader has chosen, and what deleting them would do: each is deleted as
 * they are, and the database is told how many it refused.
 */
export function useRecordsDelete({
  ws,
  table,
  selected,
  onDeleted,
}: {
  ws: string
  table: string
  /** The records the reader has chosen, by id. */
  selected: Set<string>
  onDeleted: () => void
}) {
  const { withDb, notify } = useSession()
  const [deleting, setDeleting] = useState(false)
  const removeSelected = async () => {
    setDeleting(true)
    try {
      const ids = [...selected]
      const removed = await withDb(async (db) => {
        let n = 0
        for (const id of ids) n += await deleteRecord(db, ws, table, id)
        return n
      })
      const refused = ids.length - removed
      if (refused > 0)
        notify({
          tone: 'error',
          title: `${plural(removed, 'record')} deleted, ${plural(refused, 'record')} not`,
          detail:
            'The database deleted no row it would not let you reach: a row policy on this collection keeps the rest from you.',
        })
      else notify({ tone: 'success', title: `${plural(removed, 'record')} deleted` })
      onDeleted()
    } catch (error) {
      notify({ tone: 'error', ...describe(error) })
    } finally {
      setDeleting(false)
    }
  }
  return { deleting, removeSelected }
}
