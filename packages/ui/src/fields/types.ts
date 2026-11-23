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
  RelationPath,
} from '@platform/core'

/**
 * A relation read as rows rather than as one column: the rows a record is linked to, and
 * how it reaches them. A field with no column of its own is a virtual field.
 */
export interface FieldLink {
  kind: 'links' | 'children'
  /** How a record reaches the rows. */
  path: RelationPath
}

/**
 * A field is a column PostgreSQL holds, met in three situations: a cell in the records grid,
 * a value or an input in the record form, a condition in the filter builder. A field type owns
 * all of it; a renderer may take over the drawing of one situation. Both draw and read —
 * PostgreSQL has already decided who may read a value and who may write it.
 */
export interface Field {
  name: string
  label: string
  /** The column PostgreSQL holds. A virtual field has none: it is a relation, not a column. */
  column: ColumnInfo | null
  kind: Kind
  relation?: RelationInfo
  /** The rows a record is linked to, when the field is a relation read as rows. */
  link?: FieldLink
  /** A field with no column of its own: the interface reads and writes it as rows. */
  virtual: boolean
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
/** What a condition of a filter holds, and how it is changed. */
export interface FilterInputProps {
  field: Field
  op: Operator
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
  /** The input a condition is given, when text is not enough to say it. */
  FilterInput?(props: FilterInputProps): ReactNode
}
export type { Catalog, MetadataRow }
