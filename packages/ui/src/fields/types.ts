import type { ReactNode } from 'react'
import type {
  Catalog,
  ColumnInfo,
  FieldRenderers,
  FieldViews,
  Kind,
  MetadataRow,
  Operator,
  RelationInfo,
} from '@platform/core'

/**
 * A field is a column PostgreSQL holds, met in three situations: a cell in the records grid,
 * a value or an input in the record form, a condition in the filter builder. A field type owns
 * all of it; a renderer may take over the drawing of one situation. Both draw and read —
 * PostgreSQL has already decided who may read a value and who may write it.
 */
export interface Field {
  name: string
  label: string
  column: ColumnInfo
  kind: Kind
  relation?: RelationInfo
  choices: string[] | null
  /** A column every collection is made with. */
  system: boolean
  /** A column PostgreSQL writes itself: shown, never offered as an input. */
  computed: boolean
  views: FieldViews
  /** Whether the field carries its own saying of where it appears, or the default is assumed. */
  hasViews: boolean
  renderers: FieldRenderers
  type: FieldType
}
export interface DrawProps {
  value: unknown
  field: Field
  situation: string
  options: Record<string, unknown>
  /** The name of the row a relation points at, where the reader may read it. */
  label?: string
}
export interface InputProps {
  field: Field
  value: unknown
  onChange(value: unknown): void
  error?: ReactNode
  label?: ReactNode
}
export interface FieldType {
  name: string
  label: string
  /** How strongly the type claims a column; the greatest wins, the last added breaks a tie. */
  claims(field: Omit<Field, 'type'>): number
  draw: { list(props: DrawProps): ReactNode; record(props: DrawProps): ReactNode }
  numeric?: boolean
  Input(props: InputProps): ReactNode
  /** What the form holds for a stored value. */
  toForm?(value: unknown): unknown
  /** The value a column receives from what the form holds; throwing refuses it. */
  fromForm?(held: unknown, field: Field): unknown
  operators: Operator[]
  /** The value a condition carries, from what was typed. */
  parseFilter?(text: string): unknown
}
export type { Catalog, MetadataRow }
