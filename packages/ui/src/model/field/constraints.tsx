import type { FieldDraft, OnDelete } from '../statements.ts'
import { Field, Input, Select } from '../../ui/form.tsx'

/** What the field's type takes of it: what it points at, and what it holds. */
export function FieldRelation({
  field,
  prefix,
  collections,
  set,
}: {
  field: FieldDraft
  prefix: string
  /** The collections in this workspace the field may point at. */
  collections: string[]
  set: (changes: Partial<FieldDraft>) => void
}) {
  return (
    <>
      <Field
        label="Points at"
        id={`${prefix}-rel`}
        required
        hint="A collection in this workspace; the field holds one of its ids."
      >
        <Select
          id={`${prefix}-rel`}
          value={field.relation ?? ''}
          onChange={(e) => set({ relation: e.currentTarget.value })}
        >
          <option value="">Choose a collection</option>
          {collections.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="When that row is deleted" id={`${prefix}-ondelete`}>
        <Select
          id={`${prefix}-ondelete`}
          value={field.onDelete ?? 'restrict'}
          onChange={(e) => set({ onDelete: e.currentTarget.value as OnDelete })}
        >
          <option value="restrict">Refuse the delete (RESTRICT)</option>
          <option value="cascade">Delete this record too (CASCADE)</option>
          <option value="set_null">Empty this field (SET NULL)</option>
        </Select>
      </Field>
    </>
  )
}

/** What a field of text may hold: the values it accepts, and how long they may be. */
export function FieldChoices({
  field,
  prefix,
  set,
}: {
  field: FieldDraft
  prefix: string
  set: (changes: Partial<FieldDraft>) => void
}) {
  return (
    <>
      <Field
        label="Choices"
        id={`${prefix}-choices`}
        hint="Comma-separated. The database will accept only these values."
      >
        <Input
          id={`${prefix}-choices`}
          value={(field.choices ?? []).join(', ')}
          onInput={(e) => {
            const list = e.currentTarget.value
              .split(',')
              .map((v) => v.trim())
              .filter(Boolean)
            set({ choices: list.length ? list : undefined })
          }}
          placeholder="draft, review, published"
        />
      </Field>
      <Field label="Maximum length" id={`${prefix}-max`}>
        <Input
          id={`${prefix}-max`}
          mono
          inputMode="numeric"
          value={field.maxLength?.toString() ?? ''}
          onInput={(e) =>
            set({
              maxLength: e.currentTarget.value ? Number(e.currentTarget.value) : undefined,
            })
          }
        />
      </Field>
    </>
  )
}

/** The bounds a number is held to. */
export function FieldBounds({
  field,
  prefix,
  set,
}: {
  field: FieldDraft
  prefix: string
  set: (changes: Partial<FieldDraft>) => void
}) {
  return (
    <>
      <Field label="Minimum" id={`${prefix}-min`}>
        <Input
          id={`${prefix}-min`}
          mono
          inputMode="decimal"
          value={field.min?.toString() ?? ''}
          onInput={(e) =>
            set({
              min: e.currentTarget.value === '' ? undefined : Number(e.currentTarget.value),
            })
          }
        />
      </Field>
      <Field label="Maximum" id={`${prefix}-maxv`}>
        <Input
          id={`${prefix}-maxv`}
          mono
          inputMode="decimal"
          value={field.max?.toString() ?? ''}
          onInput={(e) =>
            set({
              max: e.currentTarget.value === '' ? undefined : Number(e.currentTarget.value),
            })
          }
        />
      </Field>
    </>
  )
}
