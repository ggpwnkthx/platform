import {
  dropTypeStatement,
  enumValueStatement,
  renameEnumValueStatement,
  renameTypeStatement,
  typeKinds,
  typeStatement,
  type TypeDraft,
  type TypeKind,
} from '@platform/core'
import { BooleanInput, SelectInput, TextInput } from 'react-admin'
import { useWatch } from 'react-hook-form'
import { defineKind, choices, mono, required, fromView, createsIn } from '../data/kinds.ts'
import { Mono, Tag } from '../kit/marks.tsx'

/** A schema's own types: enums, domains, composites and ranges, for its columns to be given. */
interface TypeRow {
  schema: string
  name: string
  kind: TypeKind
  values: string[]
  base: string | null
  not_null: boolean | null
  default: string | null
  checks: string[]
  columns: string | null
  can_alter: boolean
}
type TypeForm = Omit<TypeDraft, 'schema' | 'values' | 'notNull'> & {
  values: string
  not_null: boolean
  add_value: string
  before: string
  rename_from: string
  rename_to: string
}
const kindWords: Record<string, string> = {
  enum: 'One of a list (enum)',
  domain: 'A type with rules (domain)',
  composite: 'Columns held together (composite)',
  range: 'From one value to another (range)',
}
function TypeInputs({ row }: { row?: TypeRow }) {
  const kind = useWatch({ name: 'kind' }) as TypeKind
  if (row)
    return (
      <>
        <TextInput source="name" label="Name" {...mono} />
        {row.kind === 'enum' && (
          <>
            <TextInput
              source="add_value"
              label="ADD VALUE (PostgreSQL never drops one)"
              {...mono}
            />
            <SelectInput
              source="before"
              label="BEFORE (empty: at the end)"
              choices={choices(row.values)}
              {...mono}
            />
            <SelectInput
              source="rename_from"
              label="RENAME VALUE"
              choices={choices(row.values)}
              {...mono}
            />
            <TextInput source="rename_to" label="TO" {...mono} />
          </>
        )}
      </>
    )
  return (
    <>
      <SelectInput
        source="kind"
        label="Kind"
        choices={typeKinds.map((id) => ({ id, name: kindWords[id] }))}
        helperText={false}
      />
      <TextInput source="name" label="Name" {...mono} />
      {kind === 'enum' && (
        <TextInput source="values" label="Labels, in order, separated by commas" {...mono} />
      )}
      {(kind === 'domain' || kind === 'range') && (
        <TextInput
          source="base"
          label={
            kind === 'range'
              ? 'Of: date, numeric, timestamptz'
              : 'Made of: integer, text, numeric(10,2)'
          }
          {...mono}
        />
      )}
      {kind === 'domain' && (
        <>
          <TextInput source="check" label="CHECK: VALUE > 0" {...mono} />
          <TextInput source="default" label="Default, in SQL" {...mono} />
          <BooleanInput source="not_null" label="NOT NULL" helperText={false} />
        </>
      )}
      {kind === 'composite' && (
        <TextInput source="columns" label="Attributes: street text, city text" {...mono} />
      )}
    </>
  )
}
export const types = defineKind<TypeRow, { schema: string }, TypeForm>({
  name: 'types',
  title: 'Types',
  note: 'User-defined types: enums, domains, composites and ranges. A column is given one when it is created.',
  noun: 'type',
  empty: 'This schema defines no type.',
  read: fromView<TypeRow>('catalog_user_types', ['schema'], 'name'),
  key: (row) => row.name,
  columns: [
    { source: 'name', label: 'Type', render: (row) => <Mono>{row.name}</Mono> },
    { source: 'kind', label: 'Kind', render: (row) => kindWords[row.kind] ?? row.kind },
    {
      source: 'values',
      label: 'Definition',
      render: (row) =>
        row.kind === 'enum' ? (
          row.values.map((v) => <Tag key={v}>{v}</Tag>)
        ) : (
          <Mono>
            {[row.base, row.columns, ...row.checks, row.not_null && 'NOT NULL']
              .filter(Boolean)
              .join(' ')}
          </Mono>
        ),
    },
  ],
  may: createsIn,
  mayRow: (row) => row.can_alter,
  Inputs: TypeInputs,
  defaults: (_where, row) => (row ? { name: row.name } : { kind: 'enum' }),
  create: (form, { schema }) => [
    typeStatement({
      ...form,
      schema,
      values: (form.values ?? '').split(','),
      notNull: form.not_null,
    }),
  ],
  update(form, { schema }, row) {
    const out: string[] = []
    if (form.add_value?.trim())
      out.push(enumValueStatement(schema, row.name, form.add_value, form.before))
    if (form.rename_from && form.rename_to?.trim())
      out.push(renameEnumValueStatement(schema, row.name, form.rename_from, form.rename_to))
    const name = required(form.name, 'Name the type.')
    if (name !== row.name) out.push(renameTypeStatement(schema, row.name, name, row.kind))
    return out
  },
  loses: () => 'PostgreSQL refuses while a column is of this type.',
  remove: (row, { schema }) => [dropTypeStatement(schema, row.name, row.kind)],
})
