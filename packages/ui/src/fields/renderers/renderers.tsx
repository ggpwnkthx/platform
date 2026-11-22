import type { Field } from '../field.ts'
import type { Situation } from '@platform/vocabulary'
import { resolveRenderer } from './registry.ts'

// The renderers the platform holds are registered as this module is read.
import './builtin.tsx'

/**
 * How a value is drawn.
 *
 * A value is not one thing drawn one way. The same field is a cell in the records grid, a
 * value in the record form and a value in the filter builder, and each of those wants a
 * different drawing: a uuid is eight characters in a cell and thirty-six in a record, a JSON
 * document is a clipped line in a cell and a document in a record, a number is a column of
 * digits in a cell and a number with separators in a record.
 *
 * A field's own type says how its values are drawn where nothing else is said: that is the
 * `default` renderer, and it is why a field that says nothing is already drawn differently in
 * each place. A renderer is one more way of drawing a value, which an owner may choose
 * instead — the platform holds a handful, and an installation may add its own with
 * `registerRenderer`. Which of them draws a value is said by the field itself, in its own
 * metadata, one situation at a time; a value whose saying names a renderer that does not
 * exist, or one that does not fit its kind of value, is drawn as the platform draws it.
 *
 * A renderer draws; it does not decide. It never says who may read a value, never changes
 * one, and never reaches for the database: the database's own rights decided that before the
 * renderer was called.
 */

/** One option a renderer takes, and how it is written. */
export function Value({
  value,
  field,
  situation,
  label,
}: {
  value: unknown
  /** The field the value belongs to: its type, and what it says of its values. */
  field: Field
  /** Where it is drawn: the records grid, the record form or the filter builder. */
  situation: Situation
  /** The name of the row a relation points at, when the reader may read it. */
  label?: string | null
}) {
  if (value === null || value === undefined) return <span class="null">null</span>
  const renderer = resolveRenderer(field.kind, situation, field.renderers)
  return (
    <>
      {renderer.render({
        value,
        field,
        column: field.column,
        kind: field.kind,
        relation: field.relation,
        choices: field.choices,
        situation,
        label,
        options: field.renderers[situation]?.options ?? {},
      })}
    </>
  )
}

export {
  appliesTo,
  knownRenderers,
  registerRenderer,
  rendererNamed,
  renderersFor,
  resolveRenderer,
  type Renderer,
  type RendererOption,
} from './registry.ts'
