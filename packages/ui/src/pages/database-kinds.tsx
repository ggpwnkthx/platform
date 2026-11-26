import { Alert } from '@mui/material'
import { endSessionStatement, maintenanceStatement, maintenanceWords } from '@platform/core'
import { SelectInput } from 'react-admin'
import { defineKind, choices, mono } from '../data/kinds.ts'
import { Mono, Tag } from '../kit/marks.tsx'
import { Role } from '../access/roles.tsx'

/** The database as a whole: its sessions, and the upkeep of its tables. */
interface SessionRow {
  pid: number
  role: string
  application: string
  state: string | null
  since: string
  query: string | null
  waiting_on: string | null
  blocked_by: number[]
  this_one: boolean
}
const when = (at: string | null) => (at ? new Date(at).toLocaleString() : '')
export const sessions = defineKind<SessionRow, object, object>({
  name: 'sessions',
  title: 'Sessions',
  note: 'Who is connected to the database now, and what each is running. What another role runs is shown to that role and to members of pg_read_all_stats alone.',
  noun: 'session',
  verbs: { update: 'Cancel the query of', remove: 'Terminate' },
  empty: 'No session that you may see.',
  read: async (db) =>
    (await db.query<SessionRow>('SELECT * FROM platform.catalog_sessions ORDER BY since')).rows,
  key: (row) => String(row.pid),
  columns: [
    { source: 'pid', label: 'Session', render: (row) => <Mono>{row.pid}</Mono> },
    { source: 'role', label: 'Role', render: (row) => <Role name={row.role} /> },
    {
      source: 'state',
      label: 'Doing',
      render: (row) => (
        <>
          {row.state ?? 'hidden'}{' '}
          {row.waiting_on && <Tag color="warning">{`waiting on ${row.waiting_on}`}</Tag>}{' '}
          {row.blocked_by.length > 0 && (
            <Tag color="error">{`held up by ${row.blocked_by.join(', ')}`}</Tag>
          )}
        </>
      ),
    },
    { source: 'since', label: 'Since', render: (row) => when(row.since) },
    {
      source: 'query',
      label: 'Last statement',
      render: (row) => <Mono title={row.query ?? ''}>{row.query}</Mono>,
    },
  ],
  mayRow: (row) => !row.this_one,
  Inputs: () => (
    <Alert severity="info">
      Running this asks the session to stop the statement it is running. The session stays.
    </Alert>
  ),
  update: (_form, _where, row) => [endSessionStatement(row.pid, true)],
  loses: () => 'The session is ended, and a transaction it holds open is rolled back.',
  remove: (row) => [endSessionStatement(row.pid)],
})

interface StatsRow {
  schema: string
  name: string
  kind: string
  live_rows: number
  dead_rows: number
  size: string
  vacuumed: string | null
  analyzed: string | null
  can_maintain: boolean
}
export const tableStats = defineKind<StatsRow, object, { work: (typeof maintenanceWords)[number] }>(
  {
    name: 'table-stats',
    title: 'Tables, by size',
    note: 'How large each table you may reach is, the rows PostgreSQL counts in it, and its upkeep. VACUUM reclaims the space of deleted rows; ANALYZE reads its statistics again; REINDEX rebuilds its indexes.',
    noun: 'table',
    verbs: { update: 'Maintain' },
    empty: 'No table that you may reach.',
    atomic: false,
    read: async (db) =>
      (
        await db.query<StatsRow>(
          'SELECT * FROM platform.catalog_table_stats ORDER BY bytes DESC, 1, 2'
        )
      ).rows,
    key: (row) => `${row.schema}.${row.name}`,
    columns: [
      {
        source: 'name',
        label: 'Table',
        render: (row) => <Mono>{`${row.schema}.${row.name}`}</Mono>,
      },
      { source: 'size', label: 'Size' },
      {
        source: 'live_rows',
        label: 'Rows',
        render: (row) => `${row.live_rows} (${row.dead_rows} dead)`,
      },
      { source: 'vacuumed', label: 'Vacuumed', render: (row) => when(row.vacuumed) || 'never' },
      { source: 'analyzed', label: 'Analyzed', render: (row) => when(row.analyzed) || 'never' },
    ],
    mayRow: (row) => row.can_maintain,
    Inputs: () => (
      <SelectInput
        source="work"
        label="Upkeep"
        choices={choices([...maintenanceWords])}
        {...mono}
      />
    ),
    defaults: () => ({ work: 'ANALYZE' }),
    update: (form, _where, row) => [maintenanceStatement(form.work, row.schema, row.name)],
  }
)
