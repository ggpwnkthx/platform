import { useId, useState } from 'preact/hooks'
import { columnOf } from '@platform/data'
import { useSession } from '../../session.tsx'
import { Notice } from '../../ui/bits.tsx'
import { Button } from '../../ui/button.tsx'
import { Field, Input, Select } from '../../ui/form.tsx'
import { PlusIcon, TrashIcon } from '../../ui/icons.tsx'
import { type MetadataChange, metadataStatements } from '@platform/data'
import {
  customModes,
  customViews,
  type FieldViews,
  isCustomView,
  type MetadataEntry,
  type MetadataTarget,
  type Mode,
  parseViews,
  type Situation,
  situationModes,
  situations,
  validViewName,
  viewsEqual,
  viewsKey,
  viewsValue,
} from '@platform/vocabulary'
import { modeLabels, situationTitles } from '../labels.ts'
import { SaveStatements, useDraft } from './draft.tsx'

/** What each situation is, where a field is told whether it appears in it. */
const hints: Record<Situation, string> = {
  list: 'The field’s column in the records grid.',
  record: 'The field in the record form: an input, a locked value, or nothing.',
  filter: 'The field in the filter builder.',
}

/**
 * Where a field appears: in the records grid, in the record form, in the filter builder, and
 * in any view of the owner's own. A field may be shown, hidden, or — in the form — shown and
 * locked. The saying is the field's own metadata, under the reserved key `views`, so
 * The database keeps its rules: whoever holds a right on the column reads it, and only the
 * owner of the collection changes it.
 *
 * Every field carries its own saying: the platform writes one when it makes a field, so
 * where a field appears is said of the field and not left to be inferred.
 *
 * The saying narrows the interface and grants nothing: a field that is hidden is still
 * The database's to read and to write, and the reader may still reach it in psql.
 */
export function ViewsEditor({
  target,
  owner,
  entries,
  onSaved,
}: {
  target: MetadataTarget
  owner: boolean
  /** The field's own metadata, as its owner and its readers may see it. */
  entries: MetadataEntry[]
  /** Told once a saying is saved, so the field's metadata may be read again. */
  onSaved?: () => void
}) {
  const { catalog } = useSession()
  const group = useId()
  const stored = parseViews(entries.find((one) => one.key === viewsKey)?.value)
  const [views, setViews] = useDraft<FieldViews>(stored, viewsEqual)
  const [named, setNamed] = useState('')
  const column = columnOf(catalog, target.schema, target.table ?? '', target.column ?? '')
  const computed = Boolean(column?.generated || column?.identity)
  const changes: MetadataChange[] = []
  if (!viewsEqual(views, stored)) changes.push({ key: viewsKey, value: viewsValue(views) })
  const statements = metadataStatements(target, changes)
  const custom = customViews(views)
  // A view of the owner's own may not take the name of one the interface draws.
  const addable = (name: string): boolean =>
    validViewName(name) && isCustomView(name) && !custom[name]
  const addCustom = () => {
    const name = named.trim()
    if (!addable(name)) return
    setViews({ ...views, [name]: 'show' })
    setNamed('')
  }
  return (
    <div class="views">
      {situations.map((situation) => (
        <Field
          key={situation}
          label={situationTitles[situation]}
          id={`${group}-${situation}`}
          hint={hints[situation]}
        >
          <Select
            id={`${group}-${situation}`}
            value={views[situation]}
            disabled={!owner}
            onChange={(e) => setViews({ ...views, [situation]: e.currentTarget.value as Mode })}
          >
            {situationModes[situation].map((mode) => (
              <option key={mode} value={mode}>
                {modeLabels[mode]}
              </option>
            ))}
          </Select>
        </Field>
      ))}
      {Object.keys(custom).length > 0 && (
        <fieldset class="field field-wide">
          <legend class="field-label">Other views</legend>
          {Object.entries(custom).map(([name, mode]) => (
            <Field
              key={name}
              label={name}
              id={`${group}-${name}`}
              hint="A view of your own."
              aside={
                owner ? (
                  <Button
                    tone="ghost"
                    icon={<TrashIcon size={16} />}
                    onClick={() => {
                      const { [name]: _gone, ...rest } = views
                      setViews(rest as FieldViews)
                    }}
                  >
                    Remove
                  </Button>
                ) : undefined
              }
            >
              <Select
                id={`${group}-${name}`}
                value={mode}
                disabled={!owner}
                onChange={(e) => setViews({ ...views, [name]: e.currentTarget.value as Mode })}
              >
                {customModes.map((one) => (
                  <option key={one} value={one}>
                    {modeLabels[one]}
                  </option>
                ))}
              </Select>
            </Field>
          ))}
        </fieldset>
      )}
      {owner && (
        <Field
          label="Name a view of your own"
          id={`${group}-custom`}
          hint="Letters, digits, underscores and dashes. The field's saying keeps it."
        >
          <Input
            id={`${group}-custom`}
            mono
            value={named}
            onInput={(e) => setNamed(e.currentTarget.value)}
            placeholder="export"
          />
          <div class="row-actions">
            <Button
              tone="ghost"
              icon={<PlusIcon size={16} />}
              disabled={!addable(named.trim())}
              onClick={addCustom}
            >
              Add
            </Button>
          </div>
        </Field>
      )}
      {computed && (
        <Notice tone="info" title="The database computes this column">
          A generated or an identity column is written by the database itself, so the record shows
          it and never offers it as an input.
        </Notice>
      )}
      {column?.required && views.record === 'hide' && (
        <Notice tone="warning" title="A required field out of the record">
          The database refuses a record that does not set {target.column}, and the form no longer
          offers it.
        </Notice>
      )}
      {owner && (
        <SaveStatements
          statements={statements}
          label="Save views"
          saved="Views saved"
          onSaved={onSaved}
        />
      )}
    </div>
  )
}
