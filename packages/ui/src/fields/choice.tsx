import { Select } from '@mantine/core'
import type { FieldType } from './types.ts'
import { Choice, textOf } from './values.tsx'

/** A field whose value is one of a list the owner named. */
export const choiceType: FieldType = {
  name: 'choice',
  label: 'One of a list',
  claims: (field) => (field.choices ? 20 : 0),
  draw: { list: Choice, record: Choice },
  Input: (props) => (
    <Select
      label={props.label}
      error={props.error}
      data={props.field.choices ?? []}
      value={textOf(props.value) || null}
      onChange={(v) => props.onChange(v ?? '')}
      clearable={!props.field.column.required}
    />
  ),
  fromForm: (held) => (held === '' || held === undefined ? null : held),
  operators: ['eq', 'neq', 'in', 'not_in', 'is_null', 'not_null'],
}
