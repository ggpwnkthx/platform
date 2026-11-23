import { Group, Pill, TextInput } from '@mantine/core'
import { type Condition, type Filter, isRelationOperator, valueless } from '@platform/core'
import { Search } from 'lucide-react'
import { operatorWords } from '../fields/filters.ts'
import { textOf } from '../fields/values.tsx'
import type { Field } from '../fields/types.ts'
import { FilterBuilder } from './filter.tsx'

/** The search, the filters, and the filters that are on: everything kept in the address. */
export function Toolbar({
  fields,
  filter,
  value,
  onSearch,
  onAdd,
  onRemove,
}: {
  fields: Field[]
  filter: Filter
  /** What the address says the search is; the box starts with it and is left alone after. */
  value: string
  onSearch(value: string): void
  onAdd(name: string, condition: Condition): void
  onRemove(name: string): void
}) {
  return (
    <Group mb="sm">
      <TextInput
        placeholder="Search every readable column, and the names it knows"
        leftSection={<Search size={16} />}
        radius="xl"
        w={320}
        defaultValue={value}
        onChange={(e) => onSearch(e.currentTarget.value)}
      />
      <FilterBuilder fields={fields} add={onAdd} />
      {Object.entries(filter).map(([name, one]) => (
        <Pill key={name} size="lg" withRemoveButton onRemove={() => onRemove(name)}>
          {fields.find((f) => f.name === name)?.label ?? name}{' '}
          {one.through ? <span className="mono">{one.through.column}</span> : null}{' '}
          {operatorWords[one.op]}{' '}
          {valueless.includes(one.op) ? (
            ''
          ) : isRelationOperator(one.op) ? (
            <span className="mono">{[one.value].flat().length} rows</span>
          ) : (
            <span className="mono">{textOf([one.value].flat().join(', '))}</span>
          )}
        </Pill>
      ))}
    </Group>
  )
}
