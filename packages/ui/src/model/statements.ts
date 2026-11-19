import {
  collectionStatements as buildCollectionStatements,
  commentCollectionStatement,
  dropCollectionStatement,
  dropFieldStatement,
  fieldStatements as buildFieldStatements,
  type FieldSpec,
  type OnDelete,
} from '@platform/sql'

export type { OnDelete }

/**
 * The model, as the interface drafts it.
 *
 * A builder in the interface produces a draft; the draft becomes the statements PostgreSQL
 * runs, which are shown before they run and are run, as the reader, exactly as shown.
 * PostgreSQL decides whether the reader may.
 *
 * The statements themselves are the platform's own, written once for the operator's tools
 * and the interface alike: what is left here is the shape the interface's form holds, and
 * the words it offers.
 */

/**
 * A field's type: one of the platform's own, `relation` — which is a foreign key, not a
 * column type — or any type the database holds, named with the schema it lives in.
 */
export type FieldType = string

/** The types the platform offers itself, and what they are called. */
export const fieldTypeLabels: Record<string, string> = {
  text: 'Text',
  integer: 'Whole number',
  bigint: 'Large whole number',
  decimal: 'Exact decimal',
  float: 'Floating point',
  boolean: 'Yes / no',
  date: 'Date',
  time: 'Time of day',
  timestamp: 'Moment (with time zone)',
  uuid: 'UUID',
  json: 'JSON document',
  relation: 'Relation to another collection',
}

/** The types the platform offers itself, in the order they are offered. */
export const builtInTypes = Object.keys(fieldTypeLabels)

/** The name a type is shown under: the platform's own label, or the type's own name. */
export const typeLabel = (type: string): string => fieldTypeLabels[type] ?? type

/** The types a number may be written in. */
export const numericTypes = ['integer', 'bigint', 'decimal', 'float']

/**
 * A field as the interface drafts it: the platform's own field, with every answer filled
 * in, because a form holds a value for every one of them.
 */
export interface FieldDraft extends FieldSpec {
  required: boolean
  unique: boolean
  indexed: boolean
  /** A default value, as typed; empty for none. */
  default: string
  /** What the column is called, in a comment. */
  note: string
}

export function emptyField(): FieldDraft {
  return {
    name: '',
    type: 'text',
    required: false,
    unique: false,
    indexed: false,
    default: '',
    note: '',
  }
}

/**
 * The draft as the platform's own field: the same field, with the default value as it was
 * typed and the note as it was written.
 */
function spec(draft: FieldDraft): FieldSpec {
  return { ...draft, default: draft.default.trim(), note: draft.note.trim() }
}

/** The statements that add one field to a collection. */
export async function fieldStatements(
  schema: string,
  table: string,
  draft: FieldDraft
): Promise<string[]> {
  return buildFieldStatements(schema, table, spec(draft))
}

/** The statements that make a collection: the platform's table, then each field. */
export async function collectionStatements(
  schema: string,
  name: string,
  note: string,
  drafts: readonly FieldDraft[]
): Promise<string[]> {
  return buildCollectionStatements(schema, name, note, drafts.map(spec))
}

export {
  commentCollectionStatement as commentStatement,
  dropCollectionStatement,
  dropFieldStatement,
}
