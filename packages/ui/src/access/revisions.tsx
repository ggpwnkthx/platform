import { type ActivityInfo, activity } from '@platform/core'
import { defineKind } from '../data/kinds.ts'
import { minute } from '../fields/values.tsx'
import { Mono, Tag } from '../kit/marks.tsx'
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
  note: "Database triggers log every write in its own transaction. A workspace's owners read its history, and in each row only the fields they may read.",
  noun: 'revision',
  empty: "No revision that you may read: a workspace's owners read its history.",
  read: (db, where) => activity(db, { ...where, limit: where.row ? 20 : 200 }),
  key: (row) => String(row.id),
  columns: [
    { source: 'at', label: 'When', render: (row) => <Mono title={row.at}>{minute(row.at)}</Mono> },
    { source: 'actor', label: 'Who', render: (row) => <Role name={row.actor} /> },
    { source: 'operation', label: 'What', render: (row) => <Tag>{row.operation}</Tag> },
    { source: 'table_name', label: 'Collection', render: (row) => <Mono>{row.table_name}</Mono> },
    {
      source: 'after_row',
      label: 'The row, as you may read it',
      render: (row) => {
        const id = String((row.after_row ?? row.before_row)?.id ?? '').slice(0, 8)
        return (
          <Mono>
            {id}{' '}
            {changed(row)
              .map(
                (key) =>
                  `${key}: ${JSON.stringify(row.before_row![key])} → ${JSON.stringify(row.after_row![key])}`
              )
              .join(' · ')}
          </Mono>
        )
      },
    },
  ],
})
