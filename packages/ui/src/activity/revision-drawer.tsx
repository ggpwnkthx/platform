import clsx from 'clsx'
import type { ActivityInfo } from '@platform/data'
import { display, moment } from '../format.ts'
import { Drawer } from '../ui/overlay.tsx'
import { changes, operations } from './shared.ts'

export function RevisionDrawer({
  entry,
  onClose,
}: {
  entry: ActivityInfo | null
  onClose: () => void
}) {
  return (
    <Drawer
      open={entry !== null}
      onClose={onClose}
      title={
        entry
          ? `${operations[entry.operation]?.label ?? entry.operation} · ${entry.schema_name}.${entry.table_name}`
          : ''
      }
      subtitle={
        entry
          ? `Revision ${entry.id} by ${entry.actor}, ${moment(entry.at)}, transaction ${entry.transaction_id}`
          : undefined
      }
    >
      {entry && (
        <table class="diff">
          <thead>
            <tr>
              <th>Field</th>
              {entry.before_row && <th>Before</th>}
              {entry.after_row && <th>After</th>}
            </tr>
          </thead>
          <tbody>
            {changes(entry).map((change) => (
              <tr key={change.field}>
                <th class="mono">{change.field}</th>
                {entry.before_row && (
                  <td class={clsx('mono', entry.operation === 'UPDATE' && 'diff-before')}>
                    {display(change.before) || <span class="null">null</span>}
                  </td>
                )}
                {entry.after_row && (
                  <td class={clsx('mono', entry.operation === 'UPDATE' && 'diff-after')}>
                    {display(change.after) || <span class="null">null</span>}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Drawer>
  )
}
