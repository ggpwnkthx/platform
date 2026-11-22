import { useState } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import { activity, type ActivityInfo } from '@platform/data'
import { ago, moment } from '../format.ts'
import { describe, useLoad } from '../session.tsx'
import { Page } from '../shell/page.tsx'
import { useWorkspaceView } from '../workspace/view.ts'
import { href } from '../url.ts'
import { Badge, type BadgeTone, Empty, Loading, Notice } from '../ui/bits.tsx'
import { Button } from '../ui/button.tsx'
import { Grid } from '../ui/grid.tsx'
import { ActivityIcon, HistoryIcon } from '../ui/icons.tsx'
import { RevisionDrawer } from './revision-drawer.tsx'
import { changes, operations, recordLabel } from './shared.ts'

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
