import { Checkbox, Group, NumberInput, Select, Stack, TagsInput, TextInput } from '@mantine/core'
import { type FieldSpec, columnTypes, kindOf, onDeleteActions, tablesIn } from '@platform/core'
import { useSession } from '../session/context.ts'
import { usePlace } from '../session/hooks.ts'
export const emptyField: FieldSpec = { name: '', type: 'text' }

/** A field, typed and constrained: real CHECK, NOT NULL, UNIQUE, an index, a foreign key. */
export function FieldForm({
  field,
  onChange,
}: {
  field: FieldSpec
  onChange(field: FieldSpec): void
}) {
  const { catalog } = useSession()
  const place = usePlace()
  const set = (changes: Partial<FieldSpec>) => onChange({ ...field, ...changes })
  const own = field.type in columnTypes || field.type === 'relation'
  const kind =
    field.type === 'relation'
      ? 'uuid'
      : own
        ? kindOf(columnTypes[field.type as keyof typeof columnTypes])
        : 'other'
  const number = (value: string | number) => (value === '' ? undefined : Number(value))
  return (
    <Stack gap="xs">
      <Group grow align="start">
        <TextInput
          label="Name"
          className="mono"
          value={field.name}
          onChange={(e) => set({ name: e.currentTarget.value })}
        />
        <Select
          label="Type"
          searchable
          allowDeselect={false}
          value={field.type}
          onChange={(type) => set({ type: type ?? 'text', relation: null, modifiers: undefined })}
          data={[
            { group: "The platform's", items: [...Object.keys(columnTypes), 'relation'] },
            // Any type the database holds, named with its schema so it means the same everywhere.
            { group: "The installation's", items: catalog.types.map((t) => t.name) },
          ]}
        />
      </Group>
      {!own && (
        <TextInput
          label="Modifiers"
          description="What the type takes, separated by commas: Point, 4326"
          value={(field.modifiers ?? []).join(', ')}
          onChange={(e) =>
            set({
              modifiers: e.currentTarget.value
                .split(',')
                .map((m) => m.trim())
                .filter(Boolean),
            })
          }
        />
      )}
      {field.type === 'relation' && (
        <Group grow>
          <Select
            label="Points at"
            data={tablesIn(catalog, place.ws)
              .filter((t) => t.kind !== 'v')
              .map((t) => t.name)}
            value={field.relation ?? null}
            onChange={(relation) => set({ relation })}
          />
          <Select
            label="When that row goes"
            allowDeselect={false}
            data={Object.keys(onDeleteActions)}
            value={field.onDelete ?? 'restrict'}
            onChange={(onDelete) => set({ onDelete: onDelete as FieldSpec['onDelete'] })}
          />
        </Group>
      )}
      <Group>
        <Checkbox
          label="Required"
          checked={!!field.required}
          onChange={(e) => set({ required: e.currentTarget.checked })}
        />
        <Checkbox
          label="Unique"
          checked={!!field.unique}
          onChange={(e) => set({ unique: e.currentTarget.checked })}
        />
        <Checkbox
          label="Indexed"
          checked={!!field.indexed}
          onChange={(e) => set({ indexed: e.currentTarget.checked })}
        />
      </Group>
      <Group grow align="start">
        {field.type !== 'relation' && (
          <TextInput
            label="Default"
            value={String(field.default ?? '')}
            onChange={(e) => set({ default: e.currentTarget.value })}
          />
        )}
        {kind === 'text' && (
          <NumberInput
            label="Longest"
            min={1}
            value={field.maxLength ?? ''}
            onChange={(n) => set({ maxLength: number(n) })}
          />
        )}
        {(kind === 'integer' || kind === 'number') && (
          <NumberInput
            label="At least"
            value={field.min ?? ''}
            onChange={(n) => set({ min: number(n) })}
          />
        )}
        {(kind === 'integer' || kind === 'number') && (
          <NumberInput
            label="At most"
            value={field.max ?? ''}
            onChange={(n) => set({ max: number(n) })}
          />
        )}
      </Group>
      {kind === 'text' && (
        <TagsInput
          label="Choices"
          description="The only values the field may hold"
          value={field.choices ?? []}
          onChange={(choices) => set({ choices })}
        />
      )}
      <TextInput
        label="Note"
        value={field.note ?? ''}
        onChange={(e) => set({ note: e.currentTarget.value })}
      />
    </Stack>
  )
}

/** The field as it must be before it is written: a relation names the collection it points at. */
export const fieldOf = (field: FieldSpec): FieldSpec => {
  if (field.type === 'relation' && !field.relation)
    throw new Error(`${field.name || 'The relation'}: choose the collection it points at.`)
  return field
}
