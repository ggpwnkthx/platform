import { qualified } from '@platform/vocabulary'
import { plural } from '../../format.ts'
import { Confirm } from '../../ui/overlay.tsx'

/** The confirmation that the chosen records are deleted, and what it runs. */
export function DeleteRecords({
  confirming,
  deleting,
  count,
  ws,
  table,
  onConfirm,
  onClose,
}: {
  confirming: boolean
  deleting: boolean
  /** How many records are chosen. */
  count: number
  ws: string
  table: string
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Confirm
      open={confirming}
      title={`Delete ${plural(count, 'record')}?`}
      confirm="Delete"
      busy={deleting}
      onConfirm={onConfirm}
      onClose={onClose}
    >
      <p>
        Each runs as <span class="mono">DELETE FROM {qualified(ws, table)} WHERE id = …</span> under
        your role. A row policy may keep the database from deleting some of them; you will be told
        how many it deleted.
      </p>
    </Confirm>
  )
}
