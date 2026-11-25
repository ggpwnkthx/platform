import { Box } from '@mui/material'
import { type OnDelete, situationModes } from '@platform/core'
import { BooleanInput, NumberInput, SelectInput, TextInput } from 'react-admin'
import { useWatch } from 'react-hook-form'
import { renderersFor } from '../fields/renderers.tsx'
import type { Field } from '../fields/types.ts'
import { itemIcons } from '../kit/marks.tsx'
import { palette } from '../kit/palette.ts'
import { CollectionInput, mono, onDelete, type Place } from './collections.tsx'
import { fieldTypeChoices } from './constraints.tsx'

/** The two forms of a field: what a new one is, and what the owner says of one that is there. */
export type Row = Field & { type_name: string }
export interface FieldForm {
  name: string
  type: string
  relation: string
  on_delete: OnDelete
  required: boolean
  unique: boolean
  indexed: boolean
  default: string
  max_length: number | null
  choices: string
  min: number | null
  max: number | null
  note: string
  display_name: string
  views: Record<string, string>
  renderers: Record<string, { renderer: string; options: Record<string, unknown> }>
}
export const words = { show: 'Shown', hide: 'Hidden', readonly: 'Shown, and locked' }
export const places = {
  list: 'In the records grid',
  record: 'In the record form',
  filter: 'In the filters',
}

export function NewField({ where }: { where: Place }) {
  const type = useWatch({ name: 'type' })
  return (
    <>
      <TextInput
        source="name"
        label="Name in the database: in the address and the SQL (a column)"
        {...mono}
      />
      <SelectInput source="type" label="Type" choices={fieldTypeChoices} />
      {type === 'relation' && (
        <CollectionInput source="relation" label="Points at" schema={where.schema} />
      )}
      {type === 'relation' && (
        <SelectInput
          source="on_delete"
          label="When that record is deleted"
          choices={onDelete}
          helperText={false}
        />
      )}
      <Box sx={{ display: 'flex', gap: 4 }}>
        <BooleanInput source="required" label="May not be empty" helperText={false} />
        <BooleanInput source="unique" label="Unique" helperText={false} />
        <BooleanInput source="indexed" label="Indexed" helperText={false} />
      </Box>
      {type !== 'relation' && <TextInput source="default" label="Default" {...mono} />}
      {type === 'text' && (
        <NumberInput source="max_length" label="Longest it may be" helperText={false} />
      )}
      {type === 'text' && (
        <TextInput
          source="choices"
          label="One of: values, separated by commas"
          helperText={false}
        />
      )}
      {['integer', 'bigint', 'decimal', 'float'].includes(type) && (
        <Box sx={{ display: 'flex', gap: 4 }}>
          <NumberInput source="min" label="At least" helperText={false} />
          <NumberInput source="max" label="At most" helperText={false} />
        </Box>
      )}
      <TextInput source="note" label="Note" helperText={false} />
    </>
  )
}
/** What the owner says of a field: its name for people, where it appears, and how it is drawn. */
export function SaidOfField({ row }: { row: Row }) {
  const chosen = useWatch({ name: 'renderers' }) as FieldForm['renderers']
  return (
    <>
      <TextInput source="display_name" label="The name people read" helperText={false} />
      <TextInput source="note" label="Note" helperText={false} />
      <BooleanInput source="required" label="May not be empty" helperText={false} />
      {(['list', 'record', 'filter'] as const).map((place) => (
        <SelectInput
          key={place}
          source={`views.${place}`}
          label={places[place]}
          helperText={false}
          choices={situationModes[place].map((id) => ({ id, name: words[id] }))}
          validate={(value) => (value ? undefined : 'Required')}
        />
      ))}
      {(['list', 'record'] as const).map((place) => (
        <Box key={place}>
          <SelectInput
            source={`renderers.${place}.renderer`}
            label={`Drawn ${places[place].toLowerCase()} as`}
            helperText={false}
            emptyText="Its type draws it"
            choices={renderersFor(row).map((r) => ({ id: r.name, name: r.label }))}
          />
          {renderersFor(row)
            .find((r) => r.name === chosen?.[place]?.renderer)
            ?.options?.map((option) =>
              option.type === 'icon' || option.type === 'colour' ? (
                <SelectInput
                  key={option.name}
                  source={`renderers.${place}.options.${option.name}`}
                  label={option.label}
                  helperText={false}
                  choices={(option.type === 'icon' ? itemIcons : Object.keys(palette)).map(
                    (id) => ({ id, name: id })
                  )}
                />
              ) : (
                <TextInput
                  key={option.name}
                  source={`renderers.${place}.options.${option.name}`}
                  label={option.label}
                  placeholder={option.placeholder}
                  helperText={false}
                />
              )
            )}
        </Box>
      ))}
    </>
  )
}
