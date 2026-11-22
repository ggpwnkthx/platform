import { builtInTypes, type FieldDraft, fieldTypeLabels, numericTypes } from '../statements.ts'
import { useSession } from '../../session.tsx'
import { Checkbox, Field, Input } from '../../ui/form.tsx'
import { FieldBounds, FieldChoices, FieldRelation } from './constraints.tsx'
import { TypeChoice } from './type.tsx'

/** Builds one field: its type, its name and the constraints the database will hold it to. */
export function FieldEditor({
  field,
  onChange,
  collections,
  prefix,
}: {
  field: FieldDraft
  onChange: (field: FieldDraft) => void
  collections: string[]
  prefix: string
}) {
  const { catalog } = useSession()
  const set = (changes: Partial<FieldDraft>) => onChange({ ...field, ...changes })
  const numeric = numericTypes.includes(field.type)
  // The types the installation holds besides the platform's own: an extension's, or its own.
  const others = catalog.types
  const own = builtInTypes.includes(field.type)
  return (
    <div class="form">
      <fieldset class="field field-wide types">
        <legend class="field-label">Type</legend>
        <div class="type-grid">
          {builtInTypes.map((type) => (
            <TypeChoice
              key={type}
              type={type}
              label={fieldTypeLabels[type]!}
              chosen={field.type}
              prefix={prefix}
              onChoose={(next) => set({ type: next, modifiers: undefined })}
            />
          ))}
        </div>
      </fieldset>
      {others.length > 0 && (
        <fieldset class="field field-wide types">
          <legend class="field-label">Types in this database</legend>
          <div class="type-grid">
            {others.map((type) => (
              <TypeChoice
                key={type.name}
                type={type.name}
                label={type.label}
                chosen={field.type}
                prefix={prefix}
                onChoose={(next) => set({ type: next, modifiers: undefined })}
              />
            ))}
          </div>
        </fieldset>
      )}
      {!own && (
        <Field
          label="Modifier"
          id={`${prefix}-mod`}
          hint="What the type itself takes: Point, 4326 for a geometry. Empty for the plain type."
        >
          <Input
            id={`${prefix}-mod`}
            mono
            value={(field.modifiers ?? []).join(', ')}
            onInput={(e) =>
              set({
                modifiers: e.currentTarget.value
                  .split(',')
                  .map((part) => part.trim())
                  .filter(Boolean),
              })
            }
            placeholder="Point, 4326"
          />
        </Field>
      )}
      <Field
        label="Name"
        id={`${prefix}-name`}
        required
        hint="The column's name. Lower case and underscores read best in SQL."
      >
        <Input
          id={`${prefix}-name`}
          mono
          value={field.name}
          onInput={(e) => set({ name: e.currentTarget.value })}
          placeholder="published_at"
        />
      </Field>
      <Field
        label="Default"
        id={`${prefix}-default`}
        hint="Used when a record leaves the field out."
      >
        <Input
          id={`${prefix}-default`}
          mono
          value={field.default}
          onInput={(e) => set({ default: e.currentTarget.value })}
        />
      </Field>
      {field.type === 'relation' && (
        <FieldRelation field={field} prefix={prefix} collections={collections} set={set} />
      )}
      {field.type === 'text' && <FieldChoices field={field} prefix={prefix} set={set} />}
      {numeric && <FieldBounds field={field} prefix={prefix} set={set} />}
      <div class="field field-wide checks">
        <Checkbox
          checked={field.required}
          onChange={(required) => set({ required })}
          label="Required"
          hint="NOT NULL"
        />
        <Checkbox
          checked={field.unique}
          onChange={(unique) => set({ unique })}
          label="Unique"
          hint="UNIQUE"
        />
        <Checkbox
          checked={field.indexed}
          disabled={field.unique}
          onChange={(indexed) => set({ indexed })}
          label="Indexed"
          hint="CREATE INDEX"
        />
      </div>
      <Field
        label="Note"
        id={`${prefix}-note`}
        wide
        hint="Saved as the column's comment: psql and every client show it."
      >
        <Input
          id={`${prefix}-note`}
          value={field.note}
          onInput={(e) => set({ note: e.currentTarget.value })}
        />
      </Field>
    </div>
  )
}
