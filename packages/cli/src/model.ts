import type pg from 'pg'
import { z } from 'zod'
import {
  addFieldStatement,
  commentFieldStatement,
  constraintName,
  fieldColumnSql,
  fieldRenderersStatement,
  fieldTarget,
  fieldViewsStatement,
  fieldsViewsStatement,
  type FieldSpec,
  ident,
  indexFieldStatement,
  qualified,
  relationStatement,
  systemFields,
} from '@platform/sql'
import { InputError, transaction } from './database/db.ts'
import { requireInstalledVersion } from './version.ts'

/**
 * The types a manifest may name. The platform's own are here; any other name is a type of
 * the database — `geometry` and `geography` where PostGIS is installed, an enum or a domain
 * of the installation's own — and is written as it is, qualified with the schema it lives in.
 * Two names are the platform's own under another name: `string` is a text and `m2o` is a
 * relation, which is a uuid. The storage type is written once, for the manifests and the
 * interface alike.
 */
/** A type name: one of the platform's own, or a name of the database's, qualified or not. */
const typeName = z
  .string()
  .min(1)
  .refine((name) => /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/.test(name), {
    message: 'A type is a name, or a name qualified with the schema it lives in.',
  })
export const fieldSchema = z.object({
  name: z.string().min(1),
  type: typeName,
  /** The type's own modifiers: `Point, 4326` for a geometry. */
  modifiers: z.array(z.string().min(1)).default([]),
  required: z.boolean().default(false),
  unique: z.boolean().default(false),
  indexed: z.boolean().default(false),
  default: z.unknown().optional(),
  label: z.string().optional(),
  note: z.string().optional(),
  /**
   * Where the field appears: `list`, `record` and `filter`, and any view of the owner's own.
   * A field that says nothing gets the platform's default views.
   */
  views: z
    .record(z.string(), z.enum(['show', 'hide', 'readonly']))
    .optional()
    .default({}),
  /**
   * How the field's values are drawn, in each of the situations: the name of a renderer, or
   * the name of one and the options it takes. A field that says nothing is drawn as the
   * platform draws it.
   */
  renderers: z.record(z.string(), z.unknown()).optional().default({}),
  relation: z
    .object({
      collection: z.string(),
      on_delete: z.enum(['restrict', 'cascade', 'set_null']).default('restrict'),
    })
    .optional(),
  options: z
    .object({
      max_length: z.number().int().positive().optional(),
      choices: z.array(z.string()).optional(),
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .default({}),
})
export const collectionSchema = z.object({
  name: z.string().min(1),
  fields: z.array(fieldSchema).default([]),
  label: z.string().optional(),
  note: z.string().optional(),
})
export type Field = z.infer<typeof fieldSchema>
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
const onDelete = z.enum(['restrict', 'cascade', 'set_null'])
export const relationSchema = z.object({
  collection: z.string(),
  field: z.string(),
  related: z.string(),
  on_delete: onDelete.optional(),
  onDelete: onDelete.optional(),
})
/** Told what an additive apply did, and what it found already in place. */
export type Report = { changed(what: string): void; same(): void }
const silent: Report = { changed: () => undefined, same: () => undefined }
/** Additive JSON model import. Existing columns are not silently retyped. */
export async function applyModel(q: pg.Client, raw: unknown) {
  const model = z
    .object({
      workspace: z.object({ slug: z.string() }),
      collections: z.array(collectionSchema),
      relations: z.array(relationSchema).default([]),
    })
    .parse(raw)
  const schema = model.workspace.slug
  ident(schema)
  // Every field carries its own views, and a field's metadata is what holds them: an
  // installation older than that has no place to write them.
  await requireInstalledVersion(q)
  return transaction(q, async () => {
    await q.query(`CREATE SCHEMA IF NOT EXISTS ${ident(schema)}`)
    await applyCollections(q, schema, model.collections, model.relations)
    return { schema, collections: model.collections.length }
  })
}
/** Creates the missing collections, fields and foreign keys of a schema, in the caller's transaction. */
export async function applyCollections(
  q: pg.Client,
  schema: string,
  collections: z.infer<typeof collectionSchema>[],
  relations: z.infer<typeof relationSchema>[] = [],
  report: Report = silent
) {
  for (const c of collections) {
    const exists = await q.query('SELECT to_regclass($1) AS t', [qualified(schema, c.name)])
    if (exists.rows[0].t) report.same()
    else {
      await q.query('SELECT platform.create_collection($1,$2)', [schema, c.name])
      // Every field carries its own views: the ones the platform made, and the ones below.
      await q.query(
        fieldsViewsStatement(systemFields.map((column) => fieldTarget(schema, c.name, column)))
      )
      report.changed(`create collection ${schema}.${c.name}`)
    }
    for (const f of c.fields) {
      const column = await q.query(
        `SELECT 1 FROM information_schema.columns
        WHERE table_schema=$1 AND table_name=$2 AND column_name=$3`,
        [schema, c.name, f.name]
      )
      if (column.rowCount) report.same()
      else {
        await addField(q, schema, c.name, f, false)
        if (exists.rows[0].t) report.changed(`add field ${schema}.${c.name}.${f.name}`)
      }
    }
  }
  const all = [
    ...relations,
    ...collections.flatMap((c) =>
      c.fields.flatMap((f) =>
        f.relation
          ? [
              {
                collection: c.name,
                field: f.name,
                related: f.relation.collection,
                on_delete: f.relation.on_delete,
              },
            ]
          : []
      )
    ),
  ]
  for (const r of all) {
    const added = await addRelation(
      q,
      schema,
      r.collection,
      r.field,
      r.related,
      r.on_delete ?? r.onDelete ?? 'restrict'
    )
    if (added) report.changed(`relate ${schema}.${r.collection}.${r.field} to ${r.related}`)
    else report.same()
  }
}

async function addRelation(
  q: pg.Client,
  schema: string,
  table: string,
  field: string,
  related: string,
  onDelete: 'restrict' | 'cascade' | 'set_null'
) {
  const name = await constraintName(table, field)
  const found = await q.query(
    `SELECT 1 FROM pg_constraint
    WHERE conrelid=to_regclass($1) AND conname=$2`,
    [qualified(schema, table), name]
  )
  if (found.rowCount) return false
  await q.query(await relationStatement(schema, table, field, related, onDelete))
  return true
}
