import type {
  ColumnInfo,
  FieldRenderers,
  FieldViews,
  Kind,
  Operator,
  RelationInfo,
  RelationPath,
} from '@platform/core'
import type { ReactNode } from 'react'

/**
 * A field is a column PostgreSQL holds, met in three situations: a cell in the records grid,
 * a value or an input in the record form, a condition in the filters. A field type owns all
 * of it; a renderer may take over the drawing of one situation. Both draw and read —
 * PostgreSQL has already decided who may read a value and who may write it.
 */
export interface Field {
  name: string
  label: string
  /** The column PostgreSQL holds. A virtual field has none: it is a relation read as rows. */
  column: ColumnInfo | null
  kind: Kind
  relation?: RelationInfo
  /** The rows a record is linked to: through a join table, or the rows that point at it. */
  link?: { kind: 'links' | 'children'; path: RelationPath }
  virtual: boolean
  choices: string[] | null
  /** A column every collection is made with. */
  system: boolean
  /** A column PostgreSQL writes itself: shown, never offered as an input. */
  computed: boolean
  views: FieldViews
  renderers: FieldRenderers
  type: FieldType
}
export type Situation = 'list' | 'record'
export interface DrawProps {
  value: unknown
  field: Field
  situation: Situation
  options: Record<string, unknown>
}
/** An input of the record form or of a condition: a react-admin input, bound by its source. */
export interface InputProps {
  field: Field
  source: string
  label: string | false
  /** The condition the input gives a value to, when it is in a filter. */
  op?: Operator
}
export interface FieldType {
  name: string
  label: string
  /** How strongly the type claims a field; the greatest wins, the last added breaks a tie. */
  claims(field: Omit<Field, 'type'>): number
  draw(props: DrawProps): ReactNode
  numeric?: boolean
  Input(props: InputProps): ReactNode
  /** The value a column receives from what the form holds. */
  toColumn?(held: unknown): unknown
  operators: Operator[]
}
