import type pg from 'pg'
import { z } from 'zod'
import {
  addFieldStatement,
  commentCollectionStatement,
  collectionTarget,
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
  type MetadataTarget,
  qualified,
  renderersKey,
  relationStatement,
  systemFields,
  transaction,
  viewsKey,
} from '@platform/vocabulary'
// Not the database's own module: a manifest is applied in a page too, where there is no client.
import { InputError } from './input.ts'
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
/**
 * What an item says of itself: the keys of its own metadata and their values, as they are
 * kept in `platform.item_metadata`. `display_name`, `icon` and `color` are the ones the
 * platform reads; any other key is kept and handed back.
 */
export const metadataSchema = z.record(z.string().min(1), z.unknown()).default({})
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
  /** What the field says of itself, beside where it appears and how it is drawn. */
  metadata: metadataSchema.refine(
    (metadata) => !(viewsKey in metadata) && !(renderersKey in metadata),
    { message: 'A field says where it appears in `views` and how it is drawn in `renderers`.' }
  ),
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
  /** What the collection is for: the comment PostgreSQL keeps on the table. */
  note: z.string().optional(),
  /**
   * Whether the collection asks for row policies. A collection is made asking for them;
   * false is one everybody who may read it reads whole. Omitted leaves it as it is.
   */
  row_security: z.boolean().optional(),
  /** What the collection says of itself. */
  metadata: metadataSchema,
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
async function addField(q: pg.Client, schema: string, table: string, f: Field, relations = true) {
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

/**
 * Gives an item the metadata it does not have yet. A key that is already there is left
 * alone: its owner may have changed it since, and a manifest is applied again and again.
 */
export async function describeItem(
  q: pg.Client,
  target: MetadataTarget,
  metadata: Record<string, unknown>,
  report: Report = silent
) {
  const said: string[] = []
  for (const [key, value] of Object.entries(metadata)) {
    const written = await q.query(
      `INSERT INTO platform.item_metadata (scope, schema_name, table_name, column_name, key, value)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb)
      ON CONFLICT (scope, schema_name, coalesce(table_name, ''), coalesce(column_name, ''), key)
      DO NOTHING`,
      [target.scope, target.schema, target.table, target.column, key, JSON.stringify(value ?? null)]
    )
    if (written.rowCount) said.push(key)
    else report.same()
  }
  if (!said.length) return
  const item = [target.schema, target.table, target.column].filter(Boolean).join('.')
  report.changed(`describe ${target.scope} ${item}: ${said.join(', ')}`)
}

/** What a collection says beside its fields: its comment, its row security, its metadata. */
async function applyCollectionSettings(
  q: pg.Client,
  schema: string,
  c: z.infer<typeof collectionSchema>,
  report: Report
) {
  const table = qualified(schema, c.name)
  const held = (
    await q.query(
      `SELECT obj_description(oid, 'pg_class') AS note, relrowsecurity AS secured
        FROM pg_class WHERE oid = to_regclass($1)`,
      [table]
    )
  ).rows[0]
  if (c.note !== undefined) {
    if ((held.note ?? '') === c.note.trim()) report.same()
    else {
      await q.query(commentCollectionStatement(schema, c.name, c.note))
      report.changed(`say what ${schema}.${c.name} is for`)
    }
  }
  if (c.row_security !== undefined) {
    if (held.secured === c.row_security) report.same()
    else {
      await q.query(
        `ALTER TABLE ${table} ${c.row_security ? 'ENABLE' : 'DISABLE'} ROW LEVEL SECURITY`
      )
      report.changed(
        `${c.row_security ? 'ask' : 'stop asking'} ${schema}.${c.name} for row policies`
      )
    }
  }
  await describeItem(q, collectionTarget(schema, c.name), c.metadata, report)
  for (const f of c.fields)
    await describeItem(q, fieldTarget(schema, c.name, f.name), f.metadata, report)
}
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
    await applyCollectionSettings(q, schema, c, report)
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
