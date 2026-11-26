import type {
  ColumnInfo,
  ColumnRenderers,
  ColumnViews,
  Kind,
  Operator,
  RelationInfo,
  RelationPath,
} from '@platform/core'
import type { ReactNode } from 'react'

/**
 * A column PostgreSQL holds, met in three situations: a cell in the grid,
 * a value or an input in the row form, a condition in the filters. A column type owns all
 * of it; a renderer may take over the drawing of one situation. Both draw and read —
 * PostgreSQL has already decided who may read a value and who may write it.
 */
export interface Column {
  name: string
  label: string
  /** The column PostgreSQL holds. A virtual column has none: it is a relation read as rows. */
  column: ColumnInfo | null
  kind: Kind
  relation?: RelationInfo
  /** The rows a row is linked to: through a join table, or the rows that point at it. */
  link?: { kind: 'links' | 'children'; path: RelationPath }
  virtual: boolean
  choices: string[] | null
  /** A column every table is made with. */
  system: boolean
  /** A column PostgreSQL writes itself: shown, never offered as an input. */
  computed: boolean
  views: ColumnViews
  renderers: ColumnRenderers
  type: ColumnType
}
export type Situation = 'list' | 'row'
export interface DrawProps {
  value: unknown
  column: Column
  situation: Situation
  options: Record<string, unknown>
}
/** An input of the row form or of a condition: a react-admin input, bound by its source. */
export interface InputProps {
  column: Column
  source: string
  label: string | false
  /** The condition the input gives a value to, when it is in a filter. */
  op?: Operator
}
export interface ColumnType {
  name: string
  label: string
  /** How strongly the type claims a column; the greatest wins, the last added breaks a tie. */
  claims(column: Omit<Column, 'type'>): number
  draw(props: DrawProps): ReactNode
  numeric?: boolean
  Input(props: InputProps): ReactNode
  /** The value a column receives from what the form holds. */
  toColumn?(held: unknown): unknown
  operators: Operator[]
}
