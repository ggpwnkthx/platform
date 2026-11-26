import { defaultObjects, type DefaultObjects, defaultPrivilegeStatement } from '@platform/core'
import { SelectInput } from 'react-admin'
import { choices, mono, ownsSchema } from '../data/kinds.ts'
import { Mono } from '../kit/marks.tsx'
import { type Granted, grantKind } from './granted.tsx'
import { Role, RoleInput } from './roles.tsx'

/** What a schema's new objects start with: ALTER DEFAULT PRIVILEGES, by the role that makes them. */
type DefaultRow = Granted & { for_role: string; schema: string | null; objects: DefaultObjects }
export const defaultGrants = grantKind<DefaultRow, { schema: string }>({
  name: 'default-grants',
  title: 'Default privileges',
  note: 'ALTER DEFAULT PRIVILEGES: the privileges each table, sequence, function or type a role creates here is created with.',
  noun: 'default privileges',
  empty: 'No default privileges in this schema.',
  view: ['access_default_grants', ['schema'], '1, 3, 4, 5'],
  on: (row) => `${row.for_role} ${row.objects}`,
  columns: [
    { source: 'objects', label: 'New', render: (row) => <Mono>{row.objects}</Mono> },
    { source: 'for_role', label: 'FOR ROLE', render: (row) => <Role name={row.for_role} /> },
  ],
  may: ownsSchema,
  On: () => (
    <>
      <SelectInput
        source="objects"
        label="New"
        choices={choices(Object.keys(defaultObjects))}
        {...mono}
      />
      <RoleInput source="for_role" label="FOR ROLE: objects this role creates" />
    </>
  ),
  privileges: (form) => defaultObjects[form.objects ?? 'TABLES'],
  start: (where, { catalog }) => ({
    objects: 'TABLES',
    for_role: catalog.schemas.find((s) => s.name === where.schema)?.owner,
    privileges: ['SELECT'],
  }),
  statement: (grant, revoke, { schema }) =>
    defaultPrivilegeStatement({ ...grant, forRole: grant.for_role, schema }, revoke),
})
