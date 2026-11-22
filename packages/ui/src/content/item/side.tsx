import { Fragment } from 'preact'
import { activity, systemColumns } from '@platform/data'
import { qualified } from '@platform/vocabulary'
import { RevisionList } from '../../activity/revision-list.tsx'
import { ago } from '../../format.ts'
import { Value } from '../../fields/renderers/renderers.tsx'
import type { Field as FieldInfo } from '../../fields/field.ts'
import { SideGroup } from '../../shell/page.tsx'
import { describe, useLoad } from '../../session.tsx'
import { Loading } from '../../ui/bits.tsx'
import { HistoryIcon, InfoIcon } from '../../ui/icons.tsx'
import { Confirm } from '../../ui/overlay.tsx'
import { CollectionSidebar } from '../sidebar.tsx'

/** What the record itself holds: the columns the platform keeps, and when it last changed. */
function RecordFacts({
  original,
  fields,
}: {
  original: Record<string, unknown>
  fields: FieldInfo[]
}) {
  return (
    <>
      <dl class="facts">
        {systemColumns.map((name) => {
          const field = fields.find((one) => one.name === name)
          if (!field || !(name in original)) return null
          return (
            <Fragment key={name}>
              <dt>{name.replace('_', ' ').replace(/^./, (c) => c.toUpperCase())}</dt>
              <dd>
                <Value value={original[name]} field={field} situation="record" />
              </dd>
            </Fragment>
          )
        })}
      </dl>
      {typeof original.updated_at === 'string' && (
        <p class="side-note">Last changed {ago(original.updated_at)}.</p>
      )}
    </>
  )
}

/** What the page shows beside the record: what the record holds, and how it changed. */
export function RecordSidebar({
  all,
  creating,
  id,
  original,
  table,
  ws,
}: {
  all: FieldInfo[]
  creating: boolean
  id: string
  original: Record<string, unknown> | null
  table: string
  ws: string
}) {
  return (
    <CollectionSidebar
      schema={ws}
      table={table}
      extra={
        !creating && original ? (
          <>
            <SideGroup title="Record" icon={<InfoIcon size={16} />}>
              <RecordFacts original={original} fields={all} />
            </SideGroup>
            <SideGroup title="Revisions" icon={<HistoryIcon size={16} />}>
              <RowRevisions schema={ws} table={table} id={id} />
            </SideGroup>
          </>
        ) : undefined
      }
    />
  )
}

/** The confirmation that a record is deleted, and the statement it runs. */
export function DeleteRecord({
  confirming,
  remove,
  saving,
  setConfirming,
  table,
  version,
  ws,
}: {
  confirming: boolean
  remove: () => void
  saving: boolean
  setConfirming: (on: boolean) => void
  table: string
  version: number | undefined
  ws: string
}) {
  return (
    <Confirm
      open={confirming}
      title="Delete this record?"
      confirm="Delete"
      busy={saving}
      onConfirm={remove}
      onClose={() => setConfirming(false)}
    >
      <p>
        This runs{' '}
        <span class="mono">
          DELETE FROM {qualified(ws, table)} WHERE id = …
          {version !== undefined ? ' AND version = …' : ''}
        </span>{' '}
        as you. The revision stays in the activity log.
      </p>
    </Confirm>
  )
}

/** The revisions of one record, as the database records them. */
function RowRevisions({ schema, table, id }: { schema: string; table: string; id: string }) {
  const found = useLoad(
    (db) => activity(db, { schema, table, row: id, limit: 20 }),
    [schema, table, id]
  )
  if (found.loading && !found.data) return <Loading label="Reading revisions" />
  if (found.error) return <p class="side-note">{describe(found.error).title}</p>
  if (!found.data?.length)
    return (
      <p class="side-note">
        No revision you may read. Revisions are readable by the workspace's owners.
      </p>
    )
  return <RevisionList entries={found.data} compact />
}
