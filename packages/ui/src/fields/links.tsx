import { Group, Text } from '@mantine/core'
import type { FieldType, FilterInputProps, InputProps } from './types.ts'
import { Clipped, Mono, textOf } from './values.tsx'
import { RelationPicker } from './picker.tsx'

/** The ids a set of rows is held by. */
const idsOf = (value: unknown): string[] =>
  (Array.isArray(value) ? value : []).map((one) =>
    typeof one === 'object' && one !== null && 'id' in one
      ? String((one as { id: unknown }).id)
      : String(one)
  )
/** The names of a set of rows, when the page holds the rows themselves. */
const labelsOf = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [])
    .map((one) =>
      typeof one === 'object' && one !== null && 'label' in one
        ? String((one as { label: unknown }).label)
        : String(one)
    )
    .filter(Boolean)

/** The rows a record is linked to: a picker of the other side of a join. */
function LinksInput({ field, value, onChange, error, label }: InputProps) {
  const path = field.link!.path
  return (
    <RelationPicker
      schema={path.target_schema}
      table={path.target_table}
      value={idsOf(value)}
      onChange={onChange}
      multiple
      label={label}
      error={error}
    />
  )
}

/** The condition on a link: which of the other rows the record is linked to. */
function LinksFilter({ field, value, onChange, error, label }: FilterInputProps) {
  const path = field.link!.path
  return (
    <RelationPicker
      schema={path.target_schema}
      table={path.target_table}
      value={idsOf(value)}
      onChange={onChange}
      multiple
      label={label}
      error={error}
    />
  )
}

/**
 * A relation read as rows: what a record is linked to, through a join table. It has no
 * column of its own — the join table holds the links, and the interface writes them there.
 */
export const linksType: FieldType = {
  name: 'links',
  label: 'Links',
  claims: (field) => (field.link?.kind === 'links' ? 30 : 0),
  draw: {
    list: ({ value }) => <Clipped text={`${labelsOf(value).length} links`} />,
    record: ({ value }) => {
      const labels = labelsOf(value)
      if (!labels.length) return <Text c="dimmed">Not linked to anything</Text>
      return (
        <Group gap={6}>
          {labels.map((one) => (
            <Text key={one} size="sm">
              {one}
            </Text>
          ))}
        </Group>
      )
    },
  },
  Input: LinksInput,
  toForm: (value) => idsOf(value),
  fromForm: (held) => idsOf(held),
  operators: ['has_any', 'has_none', 'has_all'],
  FilterInput: LinksFilter,
}

/** The rows that point at a record: they are read, and left to the collection they are in. */
export const childrenType: FieldType = {
  name: 'children',
  label: 'Related rows',
  claims: (field) => (field.link?.kind === 'children' ? 30 : 0),
  draw: {
    list: ({ value }) => <Mono>{textOf(value)}</Mono>,
    record: ({ value }) => <Text size="sm">{textOf(value)}</Text>,
  },
  Input: ({ label, error }) => (
    <Text size="sm" c="dimmed">
      {label}
      {error ? ` — ${error}` : ''}
    </Text>
  ),
  toForm: (value) => idsOf(value),
  fromForm: (held) => idsOf(held),
  operators: ['has_any', 'has_none', 'has_all'],
  FilterInput: LinksFilter,
}
