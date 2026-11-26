import { Alert } from '@mui/material'
import {
  dropRoutineStatement,
  routineKinds,
  routineStatement,
  type RoutineDraft,
  volatilities,
} from '@platform/core'
import { BooleanInput, SelectInput, TextInput } from 'react-admin'
import { useWatch } from 'react-hook-form'
import { defineKind, choices, mono, required, fromView, createsIn } from '../data/kinds.ts'
import { Mono, Tag } from '../kit/marks.tsx'
import { Role } from '../access/roles.tsx'

/**
 * A schema's functions and procedures. A function runs with its caller's rights unless it
 * is SECURITY DEFINER, when it runs with its owner's: then its search path is fixed, and the
 * reader is told what that means before anything runs.
 */
export interface RoutineRow {
  schema: string
  name: string
  signature: string
  arguments: string
  returns: string | null
  kind: string
  language: string
  security_definer: boolean
  volatility: (typeof volatilities)[number]
  owner: string
  comment: string | null
  body: string | null
  from_extension: boolean
  can_alter: boolean
}
type RoutineForm = Omit<RoutineDraft, 'schema' | 'securityDefiner'> & { security_definer: boolean }
function RoutineInputs({ row }: { row?: RoutineRow }) {
  const kind = useWatch({ name: 'kind' })
  const definer = useWatch({ name: 'security_definer' })
  return (
    <>
      {!row && (
        <SelectInput
          source="kind"
          label="Kind"
          choices={choices([...routineKinds])}
          helperText={false}
        />
      )}
      {!row && <TextInput source="name" label="Name" {...mono} />}
      <TextInput
        source="arguments"
        label="Arguments: a integer, b text"
        disabled={!!row}
        {...mono}
      />
      {kind !== 'procedure' && (
        <TextInput
          source="returns"
          label="RETURNS: integer, trigger, TABLE (id uuid, name text)"
          {...mono}
        />
      )}
      <SelectInput
        source="language"
        label="Language"
        choices={choices(['sql', 'plpgsql'])}
        helperText={false}
      />
      {kind !== 'procedure' && (
        <SelectInput
          source="volatility"
          label="Volatility"
          choices={choices([...volatilities])}
          helperText={false}
        />
      )}
      <TextInput source="body" label="Body" multiline minRows={8} {...mono} />
      <BooleanInput source="security_definer" label="SECURITY DEFINER" helperText={false} />
      {definer && (
        <Alert severity="warning">
          Whoever may call it acts with its owner's rights, row policies included. Its search path
          is fixed to PostgreSQL's own catalog, so name every table and function in the body with
          its schema, and revoke EXECUTE from PUBLIC unless everyone should call it.
        </Alert>
      )}
    </>
  )
}
export const routines = defineKind<RoutineRow, { schema: string }, RoutineForm>({
  name: 'routines',
  title: 'Functions and procedures',
  note: 'A function returns a value and is called in a query; a procedure is invoked with CALL.',
  noun: 'function',
  empty: 'This schema holds no function that you may see.',
  read: fromView<RoutineRow>('catalog_routines', ['schema'], 'name, signature'),
  key: (row) => row.signature,
  columns: [
    {
      source: 'signature',
      label: 'Signature',
      render: (row) => <Mono title={row.signature}>{row.signature}</Mono>,
    },
    {
      source: 'returns',
      label: 'Returns',
      render: (row) => (row.returns ? <Mono>{row.returns}</Mono> : row.kind),
    },
    {
      source: 'language',
      label: 'Runs',
      render: (row) => (
        <>
          <Tag>{row.language}</Tag> {row.kind === 'function' && <Tag>{row.volatility}</Tag>}{' '}
          {row.security_definer && <Tag color="warning">as its owner</Tag>}{' '}
          {row.from_extension && <Tag color="info">from an extension</Tag>}
        </>
      ),
    },
    { source: 'owner', label: 'Owner', render: (row) => <Role name={row.owner} /> },
  ],
  may: createsIn,
  mayRow: (row) =>
    row.can_alter &&
    !row.from_extension &&
    !!row.body &&
    ['function', 'procedure'].includes(row.kind),
  Inputs: RoutineInputs,
  defaults: (_where, row) =>
    row
      ? {
          kind: row.kind as RoutineForm['kind'],
          name: row.name,
          arguments: row.arguments,
          returns: row.returns ?? '',
          language: row.language,
          volatility: row.volatility,
          body: row.body?.replace(/^\n|\n$/g, '') ?? '',
          security_definer: row.security_definer,
        }
      : { kind: 'function', language: 'sql', volatility: 'volatile', security_definer: false },
  create: (form, { schema }) => [
    routineStatement({
      ...form,
      schema,
      name: required(form.name, 'Name it.'),
      securityDefiner: form.security_definer,
    }),
  ],
  // The same signature, written again: PostgreSQL replaces the body and keeps the grants.
  update: (form, { schema }, row) => [
    routineStatement({
      ...form,
      schema,
      name: row.name,
      kind: row.kind as RoutineForm['kind'],
      arguments: row.arguments,
      securityDefiner: form.security_definer,
      replace: true,
    }),
  ],
  loses: () => 'PostgreSQL refuses while a trigger, a default or a view still calls it.',
  remove: (row) => [dropRoutineStatement(row.signature, row.kind)],
})
