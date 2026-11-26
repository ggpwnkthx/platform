import { grantStatement, schemaReach, type SchemaReachInfo } from '@platform/core'
import { BooleanInput } from 'react-admin'
import { defineKind, grantsOn } from '../data/kinds.ts'
import { Privilege } from '../kit/marks.tsx'
import { Role, RoleInput } from './roles.tsx'

/** Who may use a schema: USAGE and CREATE on the schema, as PostgreSQL answers for each role. */
export const schemaGrants = defineKind<
  SchemaReachInfo,
  { schema: string },
  { role: string; usage: boolean; create: boolean }
>({
  name: 'schema-grants',
  title: 'Grants',
  note: 'USAGE lets a role look up objects in the schema; CREATE lets it create objects in it. Privileges on each table are granted on that table.',
  noun: 'privileges',
  verbs: { create: 'Grant', update: 'Grant or revoke', remove: 'Revoke' },
  empty: 'No role but its owner holds USAGE or CREATE on this schema.',
  read: async (db, { schema }) =>
    (await schemaReach(db, schema)).filter((r) => r.usage || r.create),
  key: (row) => row.role,
  columns: [
    { source: 'role', label: 'Role', render: (row) => <Role name={row.role} /> },
    {
      source: 'usage',
      label: 'Holds',
      wide: true,
      render: (row) => (
        <>
          <Privilege name="USAGE" held={row.usage} />
          <Privilege name="CREATE" held={row.create} />
        </>
      ),
    },
  ],
  may: grantsOn,
  Inputs: ({ row }) => (
    <>
      {!row && <RoleInput source="role" label="Role" everyone />}
      <BooleanInput source="usage" label="USAGE" helperText={false} />
      <BooleanInput source="create" label="CREATE" helperText={false} />
    </>
  ),
  defaults: (_where, row) => ({ usage: row?.usage ?? true, create: row?.create ?? false }),
  create: (form, { schema }) =>
    schemaRights(schema, form.role, { usage: false, create: false }, form),
  update: (form, { schema }, row) => schemaRights(schema, row.role, row, form),
  remove: (row, { schema }) => [
    grantStatement(
      { schema, table: null, privileges: ['USAGE', 'CREATE'], grantee: row.role },
      true
    ),
  ],
})
function schemaRights(
  schema: string,
  role: string,
  held: { usage: boolean; create: boolean },
  form: { usage: boolean; create: boolean }
) {
  const change = (grant: boolean) => {
    const privileges = (['usage', 'create'] as const)
      .filter((p) => !!form[p] === grant && held[p] !== grant)
      .map((p) => p.toUpperCase())
    return privileges.length
      ? [grantStatement({ schema, table: null, privileges, grantee: role }, !grant)]
      : []
  }
  return [...change(false), ...change(true)]
}
