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
import { registerFieldType } from './registry.ts'
import type { Field, FieldType } from './types.ts'
import { Mono, textOf } from './values.tsx'

/** The field types of a relation: a column that points at one row, and the rows a record is linked to. */
const blankIsNull = (held: unknown) => (held === '' || held === undefined ? null : held)
/** Whether the rows a field points at are found by their id, and may be read: react-admin reads them by id. */
const reads = (field: Field) => !field.relation || field.relation.target_column === 'id'
const reference = (field: Field) => {
  const to = field.relation ?? field.link!.path
  return `${to.target_schema}.${to.target_table}`
}
const many = (op?: Operator) =>
  !!op && ['in', 'not_in', 'has_any', 'has_none', 'has_all'].includes(op)
const search = (q: string) => ({ q })

const types: FieldType[] = [
  {
    name: 'relation',
    label: 'Relation',
    claims: (field) => (field.relation ? 30 : 0),
    // The name of the row it points at, where the reader may read it; the key itself otherwise.
    draw: ({ field, value }) =>
      reads(field) ? (
        <ReferenceField
          source={field.name}
          reference={reference(field)}
          link="edit"
          emptyText={textOf(value).slice(0, 8)}
        />
      ) : (
        <Mono>{textOf(value)}</Mono>
      ),
    Input: (props) =>
      !reads(props.field) ? (
        <TextInput source={props.source} label={props.label} helperText={false} className="mono" />
      ) : many(props.op) ? (
        <ReferenceArrayInput source={props.source} reference={reference(props.field)}>
          <AutocompleteArrayInput label={props.label} helperText={false} filterToQuery={search} />
        </ReferenceArrayInput>
      ) : (
        <ReferenceInput source={props.source} reference={reference(props.field)}>
          <AutocompleteInput label={props.label} helperText={false} filterToQuery={search} />
        </ReferenceInput>
      ),
    toColumn: blankIsNull,
    operators: ['eq', 'neq', 'in', 'not_in', 'is_null', 'not_null'],
  },
  {
    name: 'links',
    label: 'Links',
    claims: (field) => (field.link ? 30 : 0),
    draw: ({ field }) => <ReferenceArrayField source={field.name} reference={reference(field)} />,
    Input: ({ field, source, label }) => (
      <ReferenceArrayInput source={source} reference={reference(field)}>
        <AutocompleteArrayInput label={label} helperText={false} filterToQuery={search} />
      </ReferenceArrayInput>
    ),
    operators: ['has_any', 'has_none', 'has_all'],
  },
]
for (const type of types) registerFieldType(type)
