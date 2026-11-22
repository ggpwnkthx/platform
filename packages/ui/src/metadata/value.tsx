import { metadataCollection } from '@platform/data'
import { TextArea } from '../ui/form.tsx'
import type { FieldType } from '../fields/field.ts'

/**
 * The value of a piece of metadata, as a type of field.
 *
 * Metadata is a system collection, and its value is a JSON column like any other — but what
 * people keep in it is mostly a sentence: a purpose, a contact. So the field is typed as it
 * is meant: plain text is kept as a string, and what reads as JSON — an object, a list, a
 * number, true — is kept as itself. It is one more field type, claiming one column, and the
 * record form asks it as it asks any other.
 */

/** A value as the form holds it: a string as itself, anything else as JSON. */
const metadataText = (value: unknown): string =>
  typeof value === 'string' ? value : JSON.stringify(value, null, 2)

/** What was typed, as the value it means: JSON where it reads as JSON, text where it does not. */
function metadataValueOf(text: string): unknown {
  const trimmed = text.trim()
  if (/^[[{"]|^(true|false|null|-?\d+(\.\d+)?)$/.test(trimmed)) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return text
    }
  }
  return text
}

export const metadataValue: FieldType = {
  name: 'metadata-value',
  label: 'Metadata value',
  // Above every claim the platform makes by kind, by choices or by relation: the column is this type's.
  claims: ({ column }) =>
    column.schema === metadataCollection.schema &&
    column.table === metadataCollection.table &&
    column.name === 'value'
      ? 40
      : 0,
  draw: {
    list: ({ value }) =>
      typeof value === 'string' ? (
        <span class="clip" title={value}>
          {value}
        </span>
      ) : (
        <span class="mono cell-json clip">{JSON.stringify(value)}</span>
      ),
    record: ({ value }) =>
      typeof value === 'string' ? (
        <span class="value-text">{value}</span>
      ) : (
        <pre class="mono value-json">{JSON.stringify(value, null, 2)}</pre>
      ),
  },
  toText: metadataText,
  // The column is JSON, so what it receives is JSON: a sentence goes in as a JSON string.
  fromText: (typed) => ({ value: JSON.stringify(metadataValueOf(typed)) }),
  wide: () => true,
  Input: (props) => (
    <TextArea
      id={props.id}
      rows={6}
      value={props.text}
      disabled={props.disabled}
      onInput={(e) => props.onChange(e.currentTarget.value)}
    />
  ),
  filter: { operators: ['is_null', 'not_null'] },
}
