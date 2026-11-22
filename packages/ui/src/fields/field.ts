import type { ComponentChildren, FunctionComponent } from 'preact'
import type { ColumnInfo, Kind, Operator, RelationInfo } from '@platform/data'
import type { FieldRenderers, FieldViews, Situation } from '@platform/vocabulary'

/**
 * What a field is, and everything the interface does with one.
 *
 * A field is a column the database holds, and it is met in three situations: as a cell in the
 * records grid, as a value or an input in the record form, and as a condition in the filter
 * builder. Keystone gives every field type a view for each of those, and a controller that
 * turns what was typed into what is stored; the platform keeps the same shape. A field type
 * owns all of it — how a value is drawn in each situation, the input that changes it, the
 * text the form holds for it and the operators a filter may use — so the pages that show
 * fields ask the field and never ask what kind of column it is.
 *
 * A field type draws and reads; it does not decide. The database still says who may read a
 * value and who may write it, and a type is never told otherwise.
 */

/** What the database says of a column: enough to tell what type of field it is. */
export interface FieldFacts {
  /** The column, as the catalog holds it. */
  column: ColumnInfo
  /** What kind of value the column holds. */
  kind: Kind
  /** The row the column points at, when it is a foreign key. */
  relation: RelationInfo | null
  /** The values a CHECK allows, when the column is chosen from a list. */
  choices: string[] | null
}

/** One field of a collection: the column, what it says of itself, and its type. */
export interface Field extends FieldFacts {
  /** The column's own name, as it is in SQL. */
  name: string
  /** The name people read: the one its owner gave it, or the column's own. */
  label: string
  /** Did the owner give it a name of its own? */
  named: boolean
  /** One of the columns every collection is made with: who changed a row, and when. */
  system: boolean
  /** The database writes the column itself: a generated or an identity column. */
  computed: boolean
  /** Where the field says it appears. */
  views: FieldViews
  /** Does the field carry a saying of where it appears, or is this the default? */
  hasViews: boolean
  /** How the field says its values are drawn, in each of the situations. */
  renderers: FieldRenderers
  /** What type of field it is: the one that draws it, edits it and filters it. */
  type: FieldType
}

/** What a drawing is given: the value, and everything needed to draw it. */
export interface RenderValue extends FieldFacts {
  /** The value, as the database wrote it. */
  value: unknown
  /** The field the value belongs to. */
  field: Field
  /** Where it is being drawn. */
  situation: Situation
  /** The name of the row a relation points at, when the reader may read it. */
  label?: string | null
  /** The options the owner gave the renderer. */
  options: Record<string, unknown>
}

/** One way of drawing a value. */
export type Draw = (value: RenderValue) => ComponentChildren

/** What was typed, as the value a column receives — or the reason it cannot be one. */
export type Parsed = { value: unknown } | { error: string }

/** What an input is given: the text the form holds, and how to change it. */
export interface InputProps {
  field: Field
  /** The id the field's label points at. */
  id: string
  /** What the form holds for the field: text, as typed. */
  text: string
  onChange: (text: string) => void
  /** The database would refuse the write: the input is shown and cannot be changed. */
  disabled: boolean
  /** The record is being made, so a default is still the database's to write. */
  creating: boolean
  /** The field takes the whole width of the form. */
  wide: boolean
}

/** What the value input of a condition is given. */
export interface FilterInputProps {
  field: Field
  /** The operator the condition names. */
  op: Operator
  text: string
  onChange: (text: string) => void
}

/** How a field is filtered: the operators that make sense, and the value they take. */
export interface FieldFilter {
  /** The operators the filter builder offers, in the order it offers them. */
  operators: Operator[]
  /** The value a new condition starts with. Without one, it starts empty. */
  initial?: (field: Field) => string
  /** The value a condition carries, from what was typed. Without one, the text itself. */
  parse?: (text: string, field: Field) => unknown
  /** The input a value is typed in. Without one, a line of text. */
  Input?: FunctionComponent<FilterInputProps>
}

/** One type of field. */
export interface FieldType {
  /** The name the type is known by. */
  name: string
  /** What the type is, in a word or two. */
  label: string
  /**
   * How strongly the type claims a column: nothing at all, or a weight. The type with the
   * greatest weight is the field's. The platform's own claim by kind of value at 10, a list
   * of choices at 20 and a relation at 30, so a type of the installation's own may claim a
   * column above or below any of them.
   */
  claims: (facts: FieldFacts) => number
  /**
   * How a value is drawn where nothing else is said: narrow in the grid, in full in the
   * record. A filter is drawn as the record is, unless the type says otherwise.
   */
  draw: { list: Draw; record: Draw; filter?: Draw }
  /** Its values are set to the right in the grid, as numbers are. */
  numeric?: boolean
  /** The text the form holds for a value. Without one, the value as the screen shows it. */
  toText?: (value: unknown, field: Field) => string
  /** The value a column receives from what was typed. Without one, the text, trimmed. */
  fromText?: (text: string, field: Field) => Parsed
  /** Does the field take the whole width of the form? Without one, its name decides. */
  wide?: (field: Field, text: string) => boolean
  /** The input that changes the field in the record form. */
  Input: FunctionComponent<InputProps>
  /** How the field is filtered. */
  filter: FieldFilter
}
