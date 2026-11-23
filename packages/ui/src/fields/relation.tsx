import { Select } from '@mantine/core'
import { labelColumn, relationOptions } from '@platform/core'
import { useState } from 'react'
import { useSession } from '../session/context.ts'
import { useDb } from '../session/hooks.ts'
import type { FieldType, InputProps } from './types.ts'
import { Clipped, Mono, textOf } from './values.tsx'

function RelationInput({ field, value, onChange, error, label }: InputProps) {
  const { catalog, presentations } = useSession()
  const [search, setSearch] = useState('')
  const { target_schema: schema, target_table: table } = field.relation!
  const shown = labelColumn(
    catalog,
    schema,
    table,
    presentations[`${schema}.${table}`]?.displayField
  )
  const options = useDb(['relation', schema, table, search], (db) =>
    relationOptions(db, schema, table, shown, search)
  )
  const data = (options.data ?? []).map((row) => ({ value: row.id, label: row.label ?? row.id }))
  if (value && !data.some((row) => row.value === value))
    data.unshift({ value: String(value), label: String(value) })
  return (
    <Select
      label={label}
      error={
        error ??
        (options.error ? 'The rows it may point at are not yours to read: give an id.' : undefined)
      }
      data={data}
      value={value ? String(value) : null}
      onChange={(id) => onChange(id ?? '')}
      searchable
      clearable
      searchValue={search}
      onSearchChange={setSearch}
      filter={({ options: all }) => all}
      placeholder={`A row of ${table}`}
      nothingFoundMessage="No row matches"
    />
  )
}

/** A field that points at a row of another collection. */
export const relationType: FieldType = {
  name: 'relation',
  label: 'Relation',
  claims: (field) => (field.relation ? 30 : 0),
  draw: {
    list: ({ value, label }) =>
      label ? (
        <Clipped text={label} />
      ) : (
        <Mono title={textOf(value)}>{textOf(value).slice(0, 8)}</Mono>
      ),
    record: ({ value, label }) => (
      <>
        {label} <Mono>{textOf(value)}</Mono>
      </>
    ),
  },
  Input: RelationInput,
  fromForm: (held) => (held === '' || held === undefined ? null : held),
  operators: ['eq', 'neq', 'is_null', 'not_null'],
}
