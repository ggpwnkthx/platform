import { JsonInput } from '@mantine/core'
import type { FieldType } from './types.ts'
import { Clipped, Document, Mono, textOf } from './values.tsx'

/** A column that holds a document: PostgreSQL's own jsonb. */
export const jsonType: FieldType = {
  name: 'json',
  label: 'JSON',
  claims: (field) => (field.kind === 'json' ? 10 : 0),
  draw: {
    list: ({ value }) => (
      <Mono>
        <Clipped text={JSON.stringify(value)} />
      </Mono>
    ),
    record: ({ value }) => <Document value={value} />,
  },
  Input: (props) => (
    <JsonInput
      label={props.label}
      error={props.error}
      value={textOf(props.value)}
      onChange={props.onChange}
      autosize
      minRows={3}
      formatOnBlur
    />
  ),
  toForm: (value) => (value === null || value === undefined ? '' : JSON.stringify(value, null, 2)),
  // The value travels as JSON text. Metadata is typed as it is meant: a sentence is a string.
  fromForm(held, field) {
    const text = textOf(held).trim()
    if (!text) return null
    try {
      JSON.parse(text)
      return text
    } catch {
      if (field.column?.schema === 'platform' && field.column?.table === 'item_metadata')
        return JSON.stringify(text)
      throw new Error('This is not JSON')
    }
  },
  operators: ['contains', 'is_null', 'not_null'],
}
