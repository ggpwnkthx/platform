import { Box } from '@mui/material'
import { type MetadataRow, type OnDelete, situationModes } from '@platform/core'
import { BooleanInput, NumberInput, SelectInput, TextInput } from 'react-admin'
import { useWatch } from 'react-hook-form'
import { mono, onDelete, type Place } from '../data/kinds.ts'
import { renderersFor } from '../columns/renderers.tsx'
import type { Column } from '../columns/types.ts'
import { itemIcons } from '../kit/marks.tsx'
import { palette } from '../kit/palette.ts'
import { useSession } from '../session/session.ts'
import { TableInput } from './tables.tsx'
import { columnTypeChoices } from './constraints.tsx'

/** The two forms of a column: what a new one is, and what the owner says of one that is there. */
export type Row = Column & { type_name: string; said: MetadataRow[] }
export interface ColumnForm {
  name: string
  type: string
  /** A column that is there: its type as PostgreSQL names it, and how its values are converted. */
  type_name: string
  using: string
  generated: string
  identity: boolean
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
  list: 'In the grid',
  row: 'In the row form',
  filter: 'In the filters',
}

export function NewColumn({ where }: { where: Place }) {
  const type = useWatch({ name: 'type' })
  const computed = !!useWatch({ name: 'generated' })?.trim()
  const { catalog } = useSession()
  // The types the schemas make — enums, domains, composites — beside PostgreSQL's own.
  const own = catalog.types
    .filter((t) => t.schema !== 'platform' && t.schema !== 'public')
    .map((t) => ({
      id: t.name,
      name: `${t.label} (${t.kind === 'e' ? 'one of a list' : t.kind === 'd' ? 'domain' : 'type'})`,
    }))
  return (
    <>
      <TextInput source="name" label="Column name" {...mono} />
      <SelectInput source="type" label="Type" choices={[...columnTypeChoices, ...own]} />
      {type === 'relation' && (
        <TableInput source="relation" label="REFERENCES" schema={where.schema} />
      )}
      {type === 'relation' && (
        <SelectInput source="on_delete" label="ON DELETE" choices={onDelete} helperText={false} />
      )}
      <Box sx={{ display: 'flex', gap: 4 }}>
        <BooleanInput source="required" label="NOT NULL" helperText={false} />
        <BooleanInput source="unique" label="Unique" helperText={false} />
        <BooleanInput source="indexed" label="Indexed" helperText={false} />
      </Box>
      {type !== 'relation' && (
        <TextInput source="generated" label="GENERATED ALWAYS AS (expression) STORED" {...mono} />
      )}
      {['integer', 'bigint'].includes(type) && !computed && (
        <BooleanInput source="identity" label="GENERATED ALWAYS AS IDENTITY" helperText={false} />
      )}
      {type !== 'relation' && !computed && <TextInput source="default" label="Default" {...mono} />}
      {type === 'text' && (
        <NumberInput source="max_length" label="CHECK char_length <=" helperText={false} />
      )}
      {type === 'text' && (
        <TextInput
          source="choices"
          label="CHECK IN: values, separated by commas"
          helperText={false}
        />
      )}
      {['integer', 'bigint', 'decimal', 'float'].includes(type) && (
        <Box sx={{ display: 'flex', gap: 4 }}>
          <NumberInput source="min" label="CHECK >=" helperText={false} />
          <NumberInput source="max" label="CHECK <=" helperText={false} />
        </Box>
      )}
      <TextInput source="note" label="Note" helperText={false} />
    </>
  )
}
/** What the owner says of a column: its name for people, where it appears, and how it is drawn. */
export function SaidOfColumn({ row }: { row: Row }) {
  const chosen = useWatch({ name: 'renderers' }) as ColumnForm['renderers']
  const retyped = useWatch({ name: 'type_name' }) !== row.type_name
  return (
    <>
      {!row.system && (
        <>
          <TextInput source="name" label="Column name" {...mono} />
          <TextInput source="type_name" label="Data type" {...mono} />
          {retyped && (
            <TextInput
              source="using"
              label={`How each value becomes the new type, in SQL: ${row.name}::… (empty: as PostgreSQL converts it)`}
              {...mono}
            />
          )}
          {!row.computed && (
            <TextInput source="default" label="Default, in SQL (empty: none)" {...mono} />
          )}
        </>
      )}
      <TextInput source="display_name" label="display_name" helperText={false} />
      <TextInput source="note" label="Note" helperText={false} />
      <BooleanInput source="required" label="NOT NULL" helperText={false} />
      {(['list', 'row', 'filter'] as const).map((place) => (
        <SelectInput
          key={place}
          source={`views.${place}`}
          label={places[place]}
          helperText={false}
          choices={situationModes[place].map((id) => ({ id, name: words[id] }))}
          validate={(value) => (value ? undefined : 'Required')}
        />
      ))}
      {(['list', 'row'] as const).map((place) => (
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
