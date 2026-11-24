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
import { defineKind } from '../data/kinds.ts'
import { Mono, Tag } from '../kit/marks.tsx'
import { mono, ownsTable, type Place } from '../model/collections.tsx'
import { named, Role, RoleInput } from './roles.tsx'

/** Which rows: the row policies of a collection, and whether row security is on. */
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
  title: 'Row policies',
  note: 'A policy decides which rows a role reaches, over and above its grants. It is written and changed on its own collection.',
  noun: 'row policy',
  empty:
    'No row policy. Where row security is on, a collection with none shows its rows to its owner alone.',
  read: (db, { schema, table }) => readPolicies(db, schema, table),
  key: (row) => `${row.name} on ${row.table}`,
  columns: [
    { source: 'name', label: 'Policy', render: (row) => <Mono>{row.name}</Mono> },
    { source: 'table', label: 'Collection', render: (row) => <Mono>{row.table}</Mono> },
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
  Inputs: ({ row }) => (
    <>
      <TextInput source="name" label="Name" disabled={!!row} {...mono} />
      <SelectInput
        source="command"
        label="For"
        choices={named(policyCommands)}
        validate={(v) => (v ? undefined : 'Required')}
        {...mono}
      />
      <RoleInput source="roles" label="To: nobody named is PUBLIC" many everyone />
      <BooleanInput
        source="permissive"
        label="Permissive: it lets rows in. Off, it is restrictive and keeps rows out"
        helperText={false}
      />
      <TextInput source="using" label="USING: the rows it reaches" multiline {...mono} />
      <TextInput
        source="check"
        label="WITH CHECK: the rows it lets be written"
        multiline
        {...mono}
      />
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
    drafted({ ...form, name: row.name }, where.schema, row.table),
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
  note: 'With it on, a role reaches only the rows a policy gives it: grants alone show nobody a row.',
  noun: 'row security',
  empty: '',
  read: async (_db, { schema, table }, { catalog }) => [tableOf(catalog, schema, table)!],
  key: () => 'of this collection',
  columns: [
    {
      source: 'rls',
      label: 'Row security',
      render: (row) => (
        <Tag color="info">
          {row.rls ? 'On: policies decide which rows a role reaches' : 'Off: grants alone decide'}
        </Tag>
      ),
    },
    {
      source: 'force_rls',
      label: 'Its owner',
      render: (row) => (row.force_rls ? 'Held to the policies too' : 'Reads every row'),
    },
  ],
  may: ownsTable,
  Inputs: () => (
    <>
      <BooleanInput source="rls" label="Row security is on" helperText={false} />
      <BooleanInput
        source="force_rls"
        label="The owner is held to the policies too"
        helperText={false}
      />
    </>
  ),
  defaults: (_where, row) => ({ rls: row!.rls, force_rls: row!.force_rls }),
  update(form, { schema, table }, row) {
    const out = [
      ...(!!form.rls !== row.rls ? [rowSecurityStatement(schema, table, !!form.rls)] : []),
      ...(!!form.force_rls !== row.force_rls
        ? [forceRowSecurityStatement(schema, table, !!form.force_rls)]
        : []),
    ]
    if (!out.length) throw new Error('Nothing is changed yet.')
    return out
  },
})
