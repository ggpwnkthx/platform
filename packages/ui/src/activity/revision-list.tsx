import clsx from 'clsx'
import { useState } from 'preact/hooks'
import type { ActivityInfo } from '@platform/data'
import { ago, moment } from '../format.ts'
import type { BadgeTone } from '../ui/bits.tsx'
import { RevisionDrawer } from './revision-drawer.tsx'
import { changes, operations, recordLabel } from './shared.ts'

export function RevisionList({
  entries,
  compact,
  showTable,
}: {
  entries: ActivityInfo[]
  compact?: boolean
  /** Name the collection of each revision: for a list that spans a workspace. */
  showTable?: boolean
}) {
  const [open, setOpen] = useState<ActivityInfo | null>(null)
  return (
    <>
      <ol class={clsx('revisions', compact && 'revisions-compact')}>
        {entries.map((entry) => {
          const op = operations[entry.operation] ?? {
            label: entry.operation,
            tone: 'neutral' as BadgeTone,
          }
          const changed = changes(entry)
          return (
            <li key={entry.id}>
              <button type="button" class="revision" onClick={() => setOpen(entry)}>
                <span class={clsx('revision-dot', `dot-${op.tone}`)} aria-hidden="true" />
                <span class="revision-text">
                  <strong>{op.label}</strong>
                  {showTable && (
                    <>
                      {' '}
                      <span class="revision-record">{recordLabel(entry)}</span>
                      {' in '}
                      <span class="mono">{entry.table_name}</span>
                    </>
                  )}{' '}
                  by <span class="mono">{entry.actor}</span>
                  {entry.operation === 'UPDATE' && changed.length > 0 && (
                    <span class="revision-fields">
                      {' '}
                      ·{' '}
                      {changed
                        .slice(0, 3)
                        .map((c) => c.field)
                        .join(', ')}
                      {changed.length > 3 ? ` +${changed.length - 3}` : ''}
                    </span>
                  )}
                </span>
                <time dateTime={entry.at} title={moment(entry.at)}>
                  {ago(entry.at)}
                </time>
              </button>
            </li>
          )
        })}
      </ol>
      <RevisionDrawer entry={open} onClose={() => setOpen(null)} />
    </>
  )
}
