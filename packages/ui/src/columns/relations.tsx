import type { Operator } from '@platform/core'
import {
  AutocompleteArrayInput,
  AutocompleteInput,
  ReferenceArrayField,
  ReferenceArrayInput,
  ReferenceField,
  ReferenceInput,
  TextInput,
} from 'react-admin'
import { registerColumnType } from './registry.ts'
import type { Column, ColumnType } from './types.ts'
import { Mono, textOf } from './values.tsx'

/** The column types of a relation: a column that points at one row, and the rows a row is linked to. */
const blankIsNull = (held: unknown) => (held === '' || held === undefined ? null : held)
/** Whether the rows a column points at are found by their id, and may be read: react-admin reads them by id. */
const reads = (column: Column) => !column.relation || column.relation.target_column === 'id'
const reference = (column: Column) => {
  const to = column.relation ?? column.link!.path
  return `${to.target_schema}.${to.target_table}`
}
const many = (op?: Operator) =>
  !!op && ['in', 'not_in', 'has_any', 'has_none', 'has_all'].includes(op)
const search = (q: string) => ({ q })

const types: ColumnType[] = [
  {
    name: 'relation',
    label: 'Relation',
    claims: (column) => (column.relation ? 30 : 0),
    // The name of the row it points at, where the reader may read it; the key itself otherwise.
    draw: ({ column, value }) =>
      reads(column) ? (
        <ReferenceField
          source={column.name}
          reference={reference(column)}
          link="edit"
          emptyText={textOf(value).slice(0, 8)}
        />
      ) : (
        <Mono>{textOf(value)}</Mono>
      ),
    Input: (props) =>
      !reads(props.column) ? (
        <TextInput source={props.source} label={props.label} helperText={false} className="mono" />
      ) : many(props.op) ? (
        <ReferenceArrayInput source={props.source} reference={reference(props.column)}>
          <AutocompleteArrayInput label={props.label} helperText={false} filterToQuery={search} />
        </ReferenceArrayInput>
      ) : (
        <ReferenceInput source={props.source} reference={reference(props.column)}>
          <AutocompleteInput label={props.label} helperText={false} filterToQuery={search} />
        </ReferenceInput>
      ),
    toColumn: blankIsNull,
    operators: ['eq', 'neq', 'in', 'not_in', 'is_null', 'not_null'],
  },
  {
    name: 'links',
    label: 'Links',
    claims: (column) => (column.link ? 30 : 0),
    draw: ({ column }) => (
      <ReferenceArrayField source={column.name} reference={reference(column)} />
    ),
    Input: ({ column, source, label }) => (
      <ReferenceArrayInput source={source} reference={reference(column)}>
        <AutocompleteArrayInput label={label} helperText={false} filterToQuery={search} />
      </ReferenceArrayInput>
    ),
    operators: ['has_any', 'has_none', 'has_all'],
  },
]
for (const type of types) registerColumnType(type)
