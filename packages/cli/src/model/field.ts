import type pg from 'pg'
import {
  type FieldSpec,
  addFieldStatement,
  commentFieldStatement,
  fieldColumnSql,
  fieldRenderersStatement,
  fieldTarget,
  fieldViewsStatement,
  indexFieldStatement,
  systemFields,
} from '@platform/vocabulary'
import { InputError } from '../input.ts'
import { addRelation } from './relation.ts'
import type { Field } from './schema.ts'

export function fieldSql(field: Field): string {
  if (systemFields.includes(field.name)) throw new InputError(`Reserved field ${field.name}`)
  return fieldColumnSql(fieldSpec(field))
}

/**
 * A field of a manifest, as the platform's own field: the same shape the interface's
 * drafts take, so that both make the same column.
 */
function fieldSpec(field: Field): FieldSpec {
  return {
    name: field.name,
    type: field.type,
    modifiers: field.modifiers,
    required: field.required,
    unique: field.unique,
    indexed: field.indexed,
    default: field.default,
    maxLength: field.options.max_length,
    choices: field.options.choices,
    min: field.options.min,
    max: field.options.max,
    note: field.note ?? field.label,
    relation: field.relation?.collection ?? null,
    onDelete: field.relation?.on_delete,
    views: field.views,
    renderers: field.renderers,
  }
}
export async function addField(
  q: pg.Client,
  schema: string,
  table: string,
  f: Field,
  relations = true
) {
  const spec = fieldSpec(f)
  await q.query(addFieldStatement(schema, table, spec))
  const index = indexFieldStatement(schema, table, spec)
  if (index) await q.query(index)
  if (spec.relation && relations)
    await addRelation(q, schema, table, spec.name, spec.relation, spec.onDelete ?? 'restrict')
  const comment = commentFieldStatement(schema, table, spec)
  if (comment) await q.query(comment)
  // Every field carries its own views: what it says, or the platform's default.
  await q.query(fieldViewsStatement(fieldTarget(schema, table, spec.name), spec.views))
  // And its own saying of how its values are drawn.
  if (Object.keys(spec.renderers ?? {}).length)
    await q.query(fieldRenderersStatement(fieldTarget(schema, table, spec.name), spec.renderers))
}
