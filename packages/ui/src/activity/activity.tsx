import clsx from 'clsx'
import { useState } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import { activity, type ActivityInfo } from '@platform/data'
import { ago, display, moment } from '../format.ts'
import { describe, useLoad } from '../session.tsx'
import { Page, useWorkspaceView } from '../shell.tsx'
import { href } from '../url.ts'
import { Badge, type BadgeTone, Empty, Loading, Notice } from '../ui/bits.tsx'
import { Button } from '../ui/button.tsx'
import { Grid } from '../ui/grid.tsx'
import { ActivityIcon, HistoryIcon } from '../ui/icons.tsx'
import { Drawer } from '../ui/overlay.tsx'

const operations: Record<string, { label: string; tone: BadgeTone }> = {
  INSERT: { label: 'Created', tone: 'success' },
  UPDATE: { label: 'Updated', tone: 'info' },
  DELETE: { label: 'Deleted', tone: 'danger' },
  TRUNCATE: { label: 'Truncated', tone: 'danger' },
}

/** What a revision's row is called: its title or name, else the start of its id. */
function recordLabel(entry: ActivityInfo): string {
  const row = entry.after_row ?? entry.before_row ?? {}
  for (const key of ['title', 'name', 'full_name', 'label', 'wording']) {
    const value = row[key]
    if (typeof value === 'string' && value)
      return value.length > 48 ? `${value.slice(0, 47)}…` : value
  }
  return rowId(entry).slice(0, 8)
}

const rowId = (entry: ActivityInfo) => display(entry.after_row?.id ?? entry.before_row?.id ?? '')

/** The fields a revision changed: every field, for a creation or a deletion. */
function changes(entry: ActivityInfo): { field: string; before: unknown; after: unknown }[] {
  const before = entry.before_row ?? {}
  const after = entry.after_row ?? {}
  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])]
  return fields
    .filter(
      (f) => entry.operation !== 'UPDATE' || JSON.stringify(before[f]) !== JSON.stringify(after[f])
    )
    .filter((f) => entry.operation !== 'UPDATE' || !['updated_at', 'version'].includes(f))
    .map((field) => ({ field, before: before[field], after: after[field] }))
}

function RevisionDrawer({ entry, onClose }: { entry: ActivityInfo | null; onClose: () => void }) {
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

export function Activity() {
  const location = useLocation()
  const { ws, schema, shown } = useWorkspaceView()
  const table = location.query.c
  const [before, setBefore] = useState<number | undefined>(undefined)
  const [open, setOpen] = useState<ActivityInfo | null>(null)
  const found = useLoad(
    ws ? (db) => activity(db, { schema: ws, table, before, limit: 100 }) : null,
    [ws, table, before]
  )
  const owner = schema?.can_alter
  const entries = found.data ?? []
  return (
    <Page
      title="Activity"
      icon={<ActivityIcon size={22} />}
      crumbs={[
        { label: shown.displayName ?? ws, href: href('/content', { ws }) },
        ...(table ? [{ label: 'Every collection', href: href('/activity', { ws }) }] : []),
      ]}
      subtitle={table ? `Revisions of ${ws}.${table}` : `Revisions in ${ws}`}
      toolbar={
        table ? (
          <a class="chip" href={href('/activity', { ws })}>
            Collection <span class="mono">{table}</span> · show every collection
          </a>
        ) : undefined
      }
    >
      {!owner && (
        <Notice tone="info" title="Revisions are read by the workspace's owners">
          <span class="mono">platform.revisions</span> shows a revision only to members of the role
          that owns its workspace, and in each row only the fields their grants let them read.
        </Notice>
      )}
      {found.error ? (
        <Notice tone="danger" title={describe(found.error).title} />
      ) : found.loading && !found.data ? (
        <Loading />
      ) : entries.length ? (
        <>
          <Grid head={['Action', 'Collection', 'Record', 'Changed', 'By', 'When']}>
            {entries.map((entry) => {
              const op = operations[entry.operation] ?? {
                label: entry.operation,
                tone: 'neutral' as BadgeTone,
              }
              const changed = changes(entry)
              return (
                <tr key={entry.id} class="is-link" onClick={() => setOpen(entry)}>
                  <td>
                    <Badge tone={op.tone}>{op.label}</Badge>
                  </td>
                  <td class="mono">{entry.table_name}</td>
                  <td>
                    <button type="button" class="link-button clip" onClick={() => setOpen(entry)}>
                      {recordLabel(entry) || '—'}
                    </button>
                  </td>
                  <td class="cell-muted">
                    {entry.operation === 'UPDATE'
                      ? changed.map((c) => c.field).join(', ')
                      : entry.operation === 'TRUNCATE'
                        ? 'every row'
                        : `${changed.length} fields`}
                  </td>
                  <td class="mono">{entry.actor}</td>
                  <td>
                    <time dateTime={entry.at} title={moment(entry.at)}>
                      {ago(entry.at)}
                    </time>
                  </td>
                </tr>
              )
            })}
          </Grid>
          <footer class="pager">
            <span>{entries.length} revisions</span>
            <span class="pager-nav">
              {before !== undefined && (
                <Button small onClick={() => setBefore(undefined)}>
                  Newest
                </Button>
              )}
              {entries.length === 100 && (
                <Button small onClick={() => setBefore(entries[entries.length - 1]!.id)}>
                  Older
                </Button>
              )}
            </span>
          </footer>
        </>
      ) : (
        <Empty icon={<HistoryIcon size={28} />} title="No revision you may read">
          Every insert, update, delete and truncate in a collection is recorded by a trigger in the
          same transaction, including changes made with psql.
        </Empty>
      )}
      <RevisionDrawer entry={open} onClose={() => setOpen(null)} />
    </Page>
  )
}
