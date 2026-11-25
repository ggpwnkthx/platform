import { Typography } from '@mui/material'
import {
  InvalidName,
  metadata as readMetadata,
  type MetadataEntry,
  metadataRemoval,
  metadataStatement,
  type MetadataTarget,
} from '@platform/core'
import { SelectInput, TextInput } from 'react-admin'
import { useWatch } from 'react-hook-form'
import { defineKind } from '../data/kinds.ts'
import { textOf } from '../fields/values.tsx'
import { itemIcons, Mono } from '../kit/marks.tsx'
import { palette } from '../kit/palette.ts'
import { useSession } from '../session/session.ts'
import { mono, ownsSchema, ownsTable } from './collections.tsx'
import { metadataWord } from '../kit/words.ts'

/** What an item says of itself: its metadata, as a kind. */
/** A value as a document, or as the text it is. */
const parsed = (text: string) => {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}
const suggested: Record<string, readonly string[]> = {
  icon: itemIcons,
  color: Object.keys(palette),
}
function MetadataInputs({ where, row }: { where: MetadataTarget; row?: MetadataEntry }) {
  const { catalog } = useSession()
  const key = useWatch({ name: 'key' }) as string
  const columns = catalog.columns
    .filter((c) => c.schema === where.schema && c.table === where.table)
    .map((c) => c.name)
  const options = key === 'display_field' ? columns : suggested[key]
  return (
    <>
      <TextInput source="key" label="Key" disabled={!!row} {...mono} />
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        The interface reads display_name, icon and color
        {where.scope === 'collection' ? ', and display_field: the field a record is known by' : ''}.
        Any other key is yours.
      </Typography>
      {options ? (
        <SelectInput
          source="value"
          label="Value"
          choices={options.map((id) => ({ id, name: id }))}
          {...mono}
        />
      ) : (
        <TextInput source="value" label="Value: text, or a JSON document" multiline {...mono} />
      )}
    </>
  )
}
export const metadata = defineKind<MetadataEntry, MetadataTarget, { key: string; value: string }>({
  name: 'metadata',
  title: 'Metadata',
  note: 'Metadata describes the item it is on. Whoever may reach the item reads it; only its owner changes it.',
  noun: 'metadata entry',
  empty: 'No metadata yet.',
  read: (db, where) => readMetadata(db, where),
  key: (row) => row.key,
  columns: [
    {
      source: 'key',
      label: 'Key',
      render: (row) => {
        const word = metadataWord(row.key)
        return word ? <span title={row.key}>{word}</span> : <Mono>{row.key}</Mono>
      },
    },
    { source: 'value', label: 'Value', render: (row) => <Mono>{textOf(row.value)}</Mono> },
    { source: 'updated_by', label: 'Changed by' },
  ],
  may: (where, ctx) =>
    where.table
      ? ownsTable({ schema: where.schema, table: where.table }, ctx)
      : ownsSchema(where, ctx),
  Inputs: MetadataInputs,
  defaults: (_where, row) =>
    row
      ? {
          key: row.key,
          value: typeof row.value === 'string' ? row.value : JSON.stringify(row.value),
        }
      : {},
  create(form, where) {
    if (!form.key?.trim()) throw new InvalidName('Name the key.')
    if (form.value == null || form.value === '') throw new InvalidName('Say its value.')
    return [metadataStatement(where, form.key.trim(), parsed(form.value))]
  },
  update: (form, where, row) => [metadataStatement(where, row.key, parsed(form.value ?? ''))],
  remove: (row, where) => [metadataRemoval(where, row.key)],
})
