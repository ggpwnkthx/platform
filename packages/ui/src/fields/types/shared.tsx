import type { Kind, Operator } from '@platform/data'
import { lineInput } from '../inputs.tsx'
import { textOf } from '../text.ts'
import type { Draw, FieldFacts, Parsed } from '../field.ts'

/**
 * The pieces the platform's own field types are made of: what they claim of a column, the
 * operators a value of that kind is filtered by, and how a value is drawn.
 */

/** The weights the platform's own types claim a column with. */
const byKind = 10
export const byChoices = 20
export const byRelation = 30

/** Claims the columns that hold one of these kinds of value. */
export const ofKind =
  (...kinds: Kind[]) =>
  (facts: FieldFacts): number =>
    kinds.includes(facts.kind) ? byKind : 0

/** The operators of a value that is compared: before and after, more and less. */
export const ordered: Operator[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_null', 'not_null']

/** The operators of a value that is only ever itself. */
export const plain: Operator[] = ['eq', 'neq', 'contains', 'is_null', 'not_null']

/** A line of text in the mono face, as the database wrote it. */
export const mono: Draw = ({ value }) => <span class="mono">{textOf(value)}</span>

/** Text clipped to the width of its column, with the whole of it in a hint. */
export const clipped: Draw = ({ value }) => (
  <span class="clip" title={textOf(value)}>
    {textOf(value)}
  </span>
)

/** Text in full, wrapped where it falls. */
export const wrapped: Draw = ({ value }) => <span class="value-text">{textOf(value)}</span>

/** What was typed, as a number the database will read — or why it is not one. */
export const numberFrom =
  (shape: RegExp, error: string) =>
  (text: string): Parsed =>
    shape.test(text.trim()) ? { value: text.trim() } : { error }

/** A line of prose: the one input that is not set in the mono face. */
export const ProseLine = lineInput({ mono: false })
