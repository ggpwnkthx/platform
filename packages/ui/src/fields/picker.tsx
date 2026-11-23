import { MultiSelect, Select } from '@mantine/core'
import { labelColumn, namesOf, relationOptions } from '@platform/core'
import { useState } from 'react'
import { useSession } from '../session/context.ts'
import { useDb } from '../session/hooks.ts'

/**
 * A picker of the rows of another collection: what a relation is set to, and what a
 * condition on a relation is set to. The reader types a name and the rows that carry it
 * are offered; the ids are what the page holds.
 */
export function RelationPicker({
  schema,
  table,
  value,
  onChange,
  multiple = false,
  label,
  error,
  placeholder,
}: {
  schema: string
  table: string
  /** The ids held. */
  value: string[]
  onChange(ids: string[]): void
  multiple?: boolean
  label?: React.ReactNode
  error?: React.ReactNode
  placeholder?: string
}) {
  const { catalog, presentations } = useSession()
  const [search, setSearch] = useState('')
  const shown = labelColumn(
    catalog,
    schema,
    table,
    presentations[`${schema}.${table}`]?.displayField
  )
  const options = useDb(['relation', schema, table, search], (db) =>
    relationOptions(db, schema, table, shown, search)
  )
  // The rows that are held are named too: they may be past the first page of names.
  const held = useDb(
    ['relation-held', schema, table, value.join(',')],
    (db) => namesOf(db, catalog, schema, table, value),
    value.length > 0
  )
  const data = [
    ...(held.data ?? []).map((row) => ({ value: row.id, label: row.label ?? row.id })),
    ...(options.data ?? [])
      .map((row) => ({ value: row.id, label: row.label ?? row.id }))
      .filter((row) => !value.includes(row.value)),
  ]
  const refuse = options.error
    ? 'The rows it may point at are not yours to read: give an id.'
    : undefined
  if (multiple)
    return (
      <MultiSelect
        label={label}
        error={error ?? refuse}
        data={data}
        value={value}
        onChange={onChange}
        searchable
        clearable
        searchValue={search}
        onSearchChange={setSearch}
        filter={({ options: all }) => all}
        placeholder={placeholder ?? `A row of ${table}`}
        nothingFoundMessage="No row matches"
      />
    )
  return (
    <Select
      label={label}
      error={error ?? refuse}
      data={data}
      value={value[0] ?? null}
      onChange={(id) => onChange(id ? [id] : [])}
      searchable
      clearable
      searchValue={search}
      onSearchChange={setSearch}
      filter={({ options: all }) => all}
      placeholder={placeholder ?? `A row of ${table}`}
      nothingFoundMessage="No row matches"
    />
  )
}
