import type { FieldType, FilterInputProps, InputProps } from './types.ts'
import { Clipped, Mono, textOf } from './values.tsx'
import { RelationPicker } from './picker.tsx'

/** A field that points at a row of another collection: one row, held by its id. */
function RelationInput({ field, value, onChange, error, label }: InputProps) {
  const relation = field.relation!
  return (
    <RelationPicker
      schema={relation.target_schema}
      table={relation.target_table}
      value={value ? [String(value)] : []}
      onChange={(ids) => onChange(ids[0] ?? '')}
      label={label}
      error={error}
    />
  )
}

/** The condition on a relation: one row, or a list of them. */
function RelationFilter({ field, op, value, onChange, error, label }: FilterInputProps) {
  const relation = field.relation!
  const many = op === 'in' || op === 'not_in'
  return (
    <RelationPicker
      schema={relation.target_schema}
      table={relation.target_table}
      value={Array.isArray(value) ? value.map(String) : value ? [String(value)] : []}
      onChange={onChange}
      multiple={many}
      label={label}
      error={error}
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
  operators: ['eq', 'neq', 'in', 'not_in', 'is_null', 'not_null'],
  FilterInput: RelationFilter,
}
