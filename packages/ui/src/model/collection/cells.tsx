import clsx from 'clsx'
import type { Catalog } from '@platform/data'
import { choicesOf } from '@platform/data'
import { customViews, situations } from '@platform/vocabulary'
import { rendererNamed } from '../../fields/renderers/renderers.tsx'
import type { Field } from '../../fields/field.ts'
import { situationLabels } from '../../metadata/labels.ts'

/** A constraint as a person reads it; the definition stays in the tooltip. */
export function describeConstraint(
  catalog: Catalog,
  ws: string,
  table: string,
  column: string,
  k: { type: string; definition: string }
): string {
  if (k.type === 'u') return 'unique'
  if (k.type === 'f') return 'relation'
  const choices = choicesOf(catalog, ws, table, column)
  if (choices && k.definition.includes('ANY')) return `one of ${choices.join(', ')}`
  const length = k.definition.match(/char_length\(.*\) <= (\d+)/)
  if (length) return `at most ${length[1]} characters`
  const bound = k.definition.match(/ (>=|<=|>|<) \(?'?(-?[\d.]+)/)
  if (bound) {
    const words = { '>=': 'at least', '<=': 'at most', '>': 'more than', '<': 'less than' }
    return `${words[bound[1] as keyof typeof words]} ${bound[2]}`
  }
  return k.definition.replace(/^CHECK /, '')
}

/** The views of a field: where it appears. */
export function FieldViews({ field }: { field: Field }) {
  const { views } = field
  return (
    <span class="field-views">
      {situations.map((situation) => (
        <span
          key={situation}
          class={clsx('view-mark', views[situation] === 'hide' && 'is-off')}
          title={
            views[situation] === 'hide'
              ? `Hidden from ${situationLabels[situation]}`
              : `Shown in ${situationLabels[situation]}`
          }
        >
          {situation}
        </span>
      ))}
      {Object.entries(customViews(views)).map(([name, mode]) => (
        <span
          key={name}
          class={clsx('view-mark', mode === 'hide' && 'is-off')}
          title={mode === 'hide' ? `Hidden from ${name}` : `Shown in ${name}`}
        >
          {name}
        </span>
      ))}
    </span>
  )
}

/** How each view draws the field. */
export function FieldRenderers({ field }: { field: Field }) {
  const drawn = situations
    .map((situation) => {
      const choice = field.renderers[situation]
      if (!choice) return null
      const renderer = rendererNamed(choice.renderer)
      return (
        <span key={situation} class="view-mark" title={renderer?.label}>
          {situation}: {choice.renderer}
        </span>
      )
    })
    .filter(Boolean)
  if (!drawn.length) return <span class="cell-muted">as the platform draws it</span>
  return <span class="field-views">{drawn}</span>
}

/** What the reader lacks on a field: only that is worth a word. */
export function FieldLacks({ field }: { field: Field }) {
  const c = field.column
  const missing = [
    !c.can_select && 'SELECT',
    !c.can_insert && 'INSERT',
    !c.can_update && 'UPDATE',
  ].filter(Boolean)
  return missing.length ? (
    <span class="col-missing mono">no {missing.join(', ')}</span>
  ) : (
    <span class="cell-muted">nothing</span>
  )
}
