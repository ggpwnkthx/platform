import { type ActivityInfo, activity } from '@platform/core'
import { defineKind } from '../data/kinds.ts'
import { minute, textOf } from '../columns/values.tsx'
import { Mono, Tag } from '../kit/marks.tsx'
import { TableLabel } from '../model/tables.tsx'
import { useSession } from '../session/session.ts'
import { columnsOfTable } from '../columns/resolve.ts'
import { useNames } from '../kit/place.ts'
import { useQuery } from '@tanstack/react-query'
import { Role } from './roles.tsx'

/** What was done: the revisions the caller may read, as a kind. */
const changed = (row: ActivityInfo) =>
  row.before_row && row.after_row
    ? Object.keys(row.after_row).filter(
        (key) =>
          JSON.stringify(row.before_row![key]) !== JSON.stringify(row.after_row![key]) &&
          !['updated_at', 'updated_by', 'version'].includes(key)
      )
    : []
export const revisions = defineKind<
  ActivityInfo,
  { schema: string; table?: string; row?: string },
  never
>({
  name: 'revisions',
  title: 'Revisions',
  note: "Every INSERT, UPDATE and DELETE is logged in platform.activity, from any client. A schema's owners read its history, cut to the columns they may select.",
  noun: 'revision',
  empty: "No revision that you may read: a schema's owners read its history.",
  read: (db, where) => activity(db, { ...where, limit: where.row ? 20 : 200 }),
  key: (row) => String(row.id),
  columns: [
    { source: 'at', label: 'When', render: (row) => <Mono title={row.at}>{minute(row.at)}</Mono> },
    { source: 'actor', label: 'Who', render: (row) => <Role name={row.actor} /> },
    {
      source: 'operation',
      label: 'What',
      render: (row) => <Tag>{row.operation}</Tag>,
    },
    {
      source: 'table_name',
      label: 'Table',
      render: (row) => <TableLabel schema={row.schema_name} name={row.table_name} />,
    },
    {
      source: 'after_row',
      label: 'Row, as you may read it',
      render: (row) => <Revised row={row} />,
    },
  ],
})

/**
 * One revision in the reader's words: the row by the column that names it, then each column
 * it changed by the name people read, from what it was to what it became.
 */
function Revised({ row }: { row: ActivityInfo }) {
  const { db, catalog, presentations } = useSession()
  const said = useNames()(row.schema_name, row.table_name)
  const columns = useQuery({
    queryKey: ['columns', row.schema_name, row.table_name],
    queryFn: () =>
      columnsOfTable(db, catalog, presentations, `${row.schema_name}.${row.table_name}`),
    staleTime: Number.POSITIVE_INFINITY,
  }).data
  const snapshot = row.after_row ?? row.before_row ?? {}
  const named = said.displayColumn ? textOf(snapshot[said.displayColumn]) : ''
  const labelOf = (key: string) => columns?.find((f) => f.name === key)?.label ?? key
  return (
    <>
      {named || <Mono>{String(snapshot.id ?? '').slice(0, 8)}</Mono>}
      {changed(row).map((key) => (
        <span key={key}>
          {' · '}
          {labelOf(key)}: <Mono>{textOf(row.before_row![key]) || '—'}</Mono> →{' '}
          <Mono>{textOf(row.after_row![key]) || '—'}</Mono>
        </span>
      ))}
    </>
  )
}
