import { useId } from 'preact/hooks'
import { columnOf, kindOf } from '../../catalog/catalog.ts'
import { type Renderer, rendererNamed, renderersFor } from '../../fields/renderers.tsx'
import { useSession } from '../../session.tsx'
import { Field, Input, Select } from '../../ui/form.tsx'
import { type MetadataChange, type MetadataTarget, metadataStatements } from '../query.ts'
import {
  type FieldRenderers,
  parseRenderers,
  renderersEqual,
  renderersKey,
  renderersValue,
} from '../renderers.ts'
import type { MetadataEntry } from '../types.ts'
import {
  customViews,
  parseViews,
  type Situation,
  situations,
  situationTitles,
  viewsKey,
} from '../views.ts'
import { SaveStatements, useDraft } from './draft.tsx'

/** What each situation is, where a field is told how its values are drawn in it. */
const hints: Record<Situation, string> = {
  list: 'The field’s column in the records grid.',
  record:
    'The field’s value in the record form: a field you may change is an input, and a field you may not is drawn here.',
  filter: 'The field’s value in the filter builder.',
}

/** The options one renderer takes, and how they are written. */
function RendererOptions({
  renderer,
  values,
  disabled,
  group,
  onChange,
}: {
  renderer: Renderer
  values: Record<string, unknown>
  disabled: boolean
  group: string
  onChange: (options: Record<string, unknown>) => void
}) {
  if (!renderer.options?.length) return null
  return (
    <fieldset class="field field-wide renderer-options">
      <legend class="field-label">{renderer.label}</legend>
      {renderer.options.map((option) => (
        <Field
          key={option.name}
          label={option.label}
          id={`${group}-${option.name}`}
          hint={option.placeholder ? `For example: ${option.placeholder}` : undefined}
        >
          <Input
            id={`${group}-${option.name}`}
            mono={option.type === 'number'}
            value={values[option.name] === undefined ? '' : String(values[option.name])}
            disabled={disabled}
            placeholder={option.placeholder}
            onInput={(e) => {
              const raw = e.currentTarget.value
              const next = { ...values }
              if (raw === '') delete next[option.name]
              else if (option.type === 'number') next[option.name] = Number(raw)
              else next[option.name] = raw
              onChange(next)
            }}
          />
        </Field>
      ))}
    </fieldset>
  )
}

/**
 * How a field's values are drawn.
 *
 * A value is not one thing drawn one way: the same field is a cell in the records grid, a
 * value in the record form and a value in the filter builder, and each of those may want a
 * different drawing — a uuid is eight characters in a cell and thirty-six in a record, a
 * JSON document is a clipped line in a cell and a document in a record.
 *
 * The saying is the field's own metadata, under the reserved key `renderers`, one entry per
 * situation, and PostgreSQL's row security decides who reads it and who changes it, as it
 * does for every other key. A renderer draws a value: it never decides who may read one,
 * never changes one, and never reaches for the database.
 *
 * A renderer the field names that does not exist, or that does not fit its kind of value,
 * draws nothing: the platform draws the value as it always does. A field is never lost by a
 * saying that cannot be read.
 */
export function RenderersEditor({
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
  const column = columnOf(catalog, target.schema, target.table ?? '', target.column ?? '')
  const kind = column ? kindOf(column.type) : 'other'
  const stored = parseRenderers(entries.find((one) => one.key === renderersKey)?.value)
  const [renderers, setRenderers] = useDraft<FieldRenderers>(stored, renderersEqual)
  const changes: MetadataChange[] = []
  if (!renderersEqual(renderers, stored))
    changes.push({ key: renderersKey, value: renderersValue(renderers) })
  const statements = metadataStatements(target, changes)
  // The views of the owner's own are drawn too, where the field appears in them.
  const own = Object.keys(
    customViews(parseViews(entries.find((one) => one.key === viewsKey)?.value))
  )
  const places = [
    ...situations.map((name) => ({ name, label: situationTitles[name], hint: hints[name] })),
    ...own.map((name) => ({ name, label: `In ${name}`, hint: 'A view of your own.' })),
  ]
  const choice = (name: string, label: string, hint: string) => {
    const said = renderers[name]
    const options = renderersFor(kind, name as Situation).filter((one) => one.name !== 'default')
    const renderer = said ? rendererNamed(said.renderer) : null
    return (
      <div key={name} class="renderer-choice">
        <Field label={label} id={`${group}-${name}`} hint={hint}>
          <Select
            id={`${group}-${name}`}
            value={said?.renderer ?? 'default'}
            disabled={!owner}
            onChange={(e) => {
              const picked = e.currentTarget.value
              const next = { ...renderers }
              if (picked === 'default') delete next[name]
              else next[name] = { renderer: picked, options: {} }
              setRenderers(next)
            }}
          >
            <option value="default">As the platform draws it</option>
            {options.map((one) => (
              <option key={one.name} value={one.name}>
                {one.label}
              </option>
            ))}
          </Select>
        </Field>
        {renderer?.options?.length && (
          <RendererOptions
            renderer={renderer}
            values={said?.options ?? {}}
            disabled={!owner}
            group={`${group}-${name}`}
            onChange={(options) =>
              setRenderers({ ...renderers, [name]: { renderer: renderer.name, options } })
            }
          />
        )}
      </div>
    )
  }
  return (
    <div class="renderers">
      {places.map((one) => choice(one.name, one.label, one.hint))}
      {owner && (
        <SaveStatements
          statements={statements}
          label="Save renderers"
          saved="Renderers saved"
          onSaved={onSaved}
        />
      )}
    </div>
  )
}
