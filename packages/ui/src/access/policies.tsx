import {
  dropPolicyStatement,
  forceRowSecurityStatement,
  policies as readPolicies,
  type PolicyCommand,
  policyCommands,
  type PolicyInfo,
  policyStatement,
  rowSecurityStatement,
  tableOf,
} from '@platform/core'
import { BooleanInput, SelectInput, TextInput } from 'react-admin'
import { defineKind, mono, ownsTable, type Place, choices } from '../data/kinds.ts'
import { Mono, Tag } from '../kit/marks.tsx'
import { TableLabel } from '../model/tables.tsx'
import { Role, RoleInput } from './roles.tsx'

/** Which rows: the row policies of a table, and whether row security is on. */
interface PolicyForm {
  table: string
  name: string
  command: PolicyCommand
  roles: string[]
  permissive: boolean
  using: string
  check: string
}
const drafted = (form: PolicyForm, schema: string, table: string) =>
  policyStatement({
    schema,
    table,
    name: form.name ?? '',
    command: form.command,
    roles: form.roles ?? [],
    permissive: form.permissive !== false,
    using: form.using ?? '',
    check: form.check ?? '',
  })
export const policies = defineKind<PolicyInfo, { schema: string; table?: string }, PolicyForm>({
  name: 'policies',
  title: 'Policies',
  note: 'Row-level security policies decide which rows a role may select or write, beyond its table privileges. A policy is created and altered on its own table.',
  noun: 'policy',
  empty:
    'No row policy. Where row security is on, a table with none shows its rows to its owner alone.',
  read: (db, { schema, table }) => readPolicies(db, schema, table),
  key: (row) => `${row.name} on ${row.table}`,
  columns: [
    { source: 'name', label: 'Policy', render: (row) => <Mono>{row.name}</Mono> },
    {
      source: 'table',
      label: 'Table',
      render: (row) => <TableLabel schema={row.schema} name={row.table} />,
    },
    { source: 'command', label: 'For', render: (row) => <Mono>{row.command}</Mono> },
    {
      source: 'roles',
      label: 'To',
      render: (row) => row.roles.map((role) => <Role key={role} name={role} />),
    },
    {
      source: 'using',
      label: 'USING',
      render: (row) => <Mono title={row.using ?? ''}>{row.using}</Mono>,
    },
    {
      source: 'check',
      label: 'WITH CHECK',
      render: (row) => <Mono title={row.check ?? ''}>{row.check}</Mono>,
    },
    {
      source: 'applies',
      label: '',
      render: (row) => (row.applies ? <Tag color="primary">applies to you</Tag> : null),
    },
  ],
  may: (where, ctx) => (where.table ? ownsTable(where as Place, ctx) : false),
  // On a schema's page each policy is its table's, and changed by whoever owns that.
  mayRow: (row, where, ctx) => ownsTable({ schema: where.schema, table: row.table }, ctx),
  Inputs: () => (
    <>
      <TextInput source="name" label="Name" {...mono} />
      <SelectInput
        source="command"
        label="For"
        choices={choices(policyCommands)}
        validate={(v) => (v ? undefined : 'Required')}
        {...mono}
      />
      <RoleInput source="roles" label="TO: roles (none chosen: PUBLIC)" many everyone />
      <BooleanInput source="permissive" label="PERMISSIVE (off: RESTRICTIVE)" helperText={false} />
      <TextInput source="using" label="USING" multiline {...mono} />
      <TextInput source="check" label="WITH CHECK" multiline {...mono} />
    </>
  ),
  defaults: (_where, row) =>
    row
      ? {
          name: row.name,
          command: row.command as PolicyCommand,
          roles: row.roles,
          permissive: row.permissive === 'PERMISSIVE',
          using: row.using ?? '',
          check: row.check ?? '',
        }
      : { command: 'ALL', roles: [], permissive: true },
  create: (form, where) => [drafted(form, where.schema, where.table!)],
  update: (form, where, row) => [
    dropPolicyStatement(where.schema, row.table, row.name),
    drafted({ ...form, name: form.name || row.name }, where.schema, row.table),
  ],
  remove: (row, where) => [dropPolicyStatement(where.schema, row.table, row.name)],
})

export const rowSecurity = defineKind<
  { rls: boolean; force_rls: boolean },
  Place,
  { rls: boolean; force_rls: boolean }
>({
  name: 'row-security',
  title: 'Row security',
  note: 'With ROW LEVEL SECURITY enabled, a role reaches only the rows a policy allows: table privileges alone return none.',
  noun: 'row security',
  empty: '',
  read: async (_db, { schema, table }, { catalog }) => [tableOf(catalog, schema, table)!],
  key: () => 'of this table',
  columns: [
    {
      source: 'rls',
      label: 'Row security',
      render: (row) => (
        <Tag color="info">
          {row.rls
            ? 'Enabled: policies decide which rows a role reaches'
            : 'Disabled: table privileges alone decide'}
        </Tag>
      ),
    },
    {
      source: 'force_rls',
      label: 'FORCE',
      render: (row) =>
        row.force_rls
          ? 'Forced: the owner is subject to policies'
          : 'Not forced: the owner bypasses policies',
    },
  ],
  may: ownsTable,
  Inputs: () => (
    <>
      <BooleanInput source="rls" label="ENABLE ROW LEVEL SECURITY" helperText={false} />
      <BooleanInput
        source="force_rls"
        label="FORCE ROW LEVEL SECURITY: the owner is subject to the policies"
        helperText={false}
      />
    </>
  ),
  defaults: (_where, row) => ({ rls: row!.rls, force_rls: row!.force_rls }),
  update: (form, { schema, table }, row) => [
    ...(!!form.rls !== row.rls ? [rowSecurityStatement(schema, table, !!form.rls)] : []),
    ...(!!form.force_rls !== row.force_rls
      ? [forceRowSecurityStatement(schema, table, !!form.force_rls)]
      : []),
  ],
})
