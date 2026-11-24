import { Box } from '@mui/material'
import {
  columnsOf,
  grantChangeStatements,
  grants as readGrants,
  grantStatement,
  heldBy,
  type Held,
  type Hold,
  InvalidName,
  narrows,
  reach,
  type ReachInfo,
  tablePrivileges,
  type Wanted,
} from '@platform/core'
import { BooleanInput, SelectArrayInput, SelectInput } from 'react-admin'
import { useWatch } from 'react-hook-form'
import { defineKind } from '../data/kinds.ts'
import { Mono, Privilege, PrivilegeLegend } from '../kit/marks.tsx'
import { grantsOn, mono } from '../model/collections.tsx'
import { useSession } from '../session/session.ts'
import { named, Role, RoleInput } from './roles.tsx'

/** Who holds what on a collection: read from the ACLs, and from PostgreSQL's own answer for each role. */
type GrantRow = ReachInfo & { acl: Record<string, Held> }
type Where = { schema: string; table?: string; role?: string }
interface GrantForm {
  role: string
  table: string
  usage: boolean
  wanted: Record<string, 'none' | 'all' | 'fields'>
  fields: Record<string, string[]>
}
const wantedOf = (form: GrantForm): Record<string, Wanted> =>
  Object.fromEntries(
    Object.entries(form.wanted ?? {}).map(([p, want]) => [
      p,
      want === 'fields' ? (form.fields?.[p] ?? []) : want,
    ])
  )
// A privilege and what it is held on: the mark names the input, whose own label is not drawn.
const between = {
  display: 'grid',
  gridTemplateColumns: '11em 1fr',
  alignItems: 'center',
  '& .MuiInputLabel-root': { display: 'none' },
}
const extents = [
  { id: 'none', name: 'Not held' },
  { id: 'all', name: 'Whole collection' },
  { id: 'fields', name: 'Chosen fields' },
]
/** One role on one collection: each privilege not held, held on the whole of it, or on chosen fields. */
function GrantInputs({ where, row }: { where: Where; row?: GrantRow }) {
  const { catalog } = useSession()
  const form = useWatch() as GrantForm
  const table = row?.table ?? form.table ?? where.table ?? ''
  const columns = columnsOf(catalog, where.schema, table).map((c) => c.name)
  return (
    <>
      {!row && <RoleInput source="role" label="Role" everyone />}
      <PrivilegeLegend />
      {tablePrivileges.map((p) => {
        const want = form.wanted?.[p] ?? 'none'
        const chosen = form.fields?.[p] ?? []
        return (
          <Box key={p} data-privilege={p}>
            <Box sx={between}>
              <Privilege
                name={p}
                held={want === 'fields' ? 'some' : (want as Hold)}
                count={`${chosen.length}/${columns.length}`}
              />
              <SelectInput
                source={`wanted.${p}`}
                label="Held on"
                choices={narrows(p) ? extents : extents.slice(0, 2)}
                validate={(v) => (v ? undefined : 'Required')}
                helperText={false}
              />
            </Box>
            {want === 'fields' && (
              <SelectArrayInput
                source={`fields.${p}`}
                label={`${p} on`}
                choices={named(columns)}
                {...mono}
              />
            )}
          </Box>
        )
      })}
      <BooleanInput
        source="usage"
        label={`Also GRANT USAGE on ${where.schema} where the role lacks it: without it a grant is of no use`}
        helperText={false}
      />
    </>
  )
}
export const grants = defineKind<GrantRow, Where, GrantForm>({
  name: 'grants',
  title: 'Who holds what',
  note: "PostgreSQL's own answer for each role, so a right held through a group or as PUBLIC counts. A change writes the difference to the ACL.",
  add: 'Grant on this collection',
  noun: 'grant',
  empty: 'Nobody but its owner holds a right here.',
  async read(db, where) {
    const acl = await readGrants(db, where.schema)
    const reached = await reach(db, where.schema, where)
    return reached
      .filter(
        (r) =>
          where.role ||
          tablePrivileges.some((p) => ![false, 'none'].includes(r[p.toLowerCase() as 'select']))
      )
      .map((r) => ({ ...r, acl: heldBy(acl, r.table, r.role) }))
  },
  key: (row) => `${row.role} on ${row.table}`,
  columns: [
    { source: 'role', label: 'Role', render: (row) => <Role name={row.role} /> },
    { source: 'table', label: 'Collection', render: (row) => <Mono>{row.table}</Mono> },
    {
      source: 'select',
      label: 'Holds, by grant, by group or as PUBLIC',
      wide: true,
      render: (row, { catalog }) => {
        const fields = catalog.columns.filter((c) => c.table === row.table).length
        return tablePrivileges.slice(0, 5).map((p) => {
          const hold = row[p.toLowerCase() as 'select'] as Hold | boolean
          return (
            <Privilege
              key={p}
              name={p}
              held={hold}
              count={
                row.acl[p]?.columns.length ? `${row.acl[p].columns.length}/${fields}` : undefined
              }
            />
          )
        })
      },
    },
  ],
  // A grant is made on a collection's page; on a role's page each row is its own collection.
  may: (where, ctx) => !!where.table && grantsOn(where, ctx),
  mayRow: (row, where, ctx) => grantsOn({ schema: where.schema, table: row.table }, ctx),
  Inputs: GrantInputs,
  defaults: (where, row) => ({
    table: where.table,
    usage: true,
    wanted: Object.fromEntries(
      tablePrivileges.map((p) => [
        p,
        row?.acl[p]?.whole ? 'all' : row?.acl[p]?.columns.length ? 'fields' : 'none',
      ])
    ),
    fields: Object.fromEntries(tablePrivileges.map((p) => [p, row?.acl[p]?.columns ?? []])),
  }),
  create: (form, where, ctx) =>
    grantsFor(form.role, form.table ?? where.table, {}, form, where.schema, true, ctx),
  update: (form, where, row, ctx) =>
    grantsFor(row.role, row.table, row.acl, form, where.schema, row.usage, ctx),
  // What the ACL records for the role is taken back: what it holds through a group stays the group's.
  remove(row, where) {
    const all = Object.fromEntries(Object.keys(row.acl).map((p) => [p, 'none' as const]))
    const said = { schema: where.schema, table: row.table, grantee: row.role }
    const out = grantChangeStatements({ ...said, held: row.acl, wanted: all })
    if (!out.length)
      throw new Error(
        `The ACL of ${row.table} names ${row.role} nowhere: what it holds comes from a group or from PUBLIC.`
      )
    return out
  },
})
/** The difference between what an ACL records and what is asked, and USAGE on the workspace beside it. */
function grantsFor(
  role: string,
  table: string | undefined,
  held: Record<string, Held>,
  form: GrantForm,
  schema: string,
  hasUsage: boolean,
  ctx: Parameters<typeof grantsOn>[1]
) {
  if (!role?.trim()) throw new InvalidName('Choose the role the grant is for.')
  if (!table) throw new InvalidName('Choose the collection.')
  const out = grantChangeStatements({ schema, table, grantee: role, held, wanted: wantedOf(form) })
  if (!out.length) throw new Error('Nothing is changed yet.')
  const grantsSomething = out.some((s) => s.startsWith('GRANT'))
  return [
    ...(form.usage && !hasUsage && grantsSomething && grantsOn({ schema }, ctx)
      ? [grantStatement({ schema, table: null, privileges: ['USAGE'], grantee: role })]
      : []),
    ...out,
  ]
}
