import { createHash } from 'node:crypto'
import type pg from 'pg'
import { z } from 'zod'
import { InputError, ident, literal, qualified, transaction } from './db.ts'

const types = {
  string: 'text',
  text: 'text',
  integer: 'integer',
  bigint: 'bigint',
  decimal: 'numeric',
  float: 'double precision',
  boolean: 'boolean',
  uuid: 'uuid',
  date: 'date',
  time: 'time',
  timestamp: 'timestamptz',
  json: 'jsonb',
  m2o: 'uuid',
} as const
export const fieldSchema = z.object({
  name: z.string().min(1),
  type: z.enum(Object.keys(types) as [keyof typeof types, ...Array<keyof typeof types>]),
  required: z.boolean().default(false),
  unique: z.boolean().default(false),
  indexed: z.boolean().default(false),
  default: z.unknown().optional(),
  label: z.string().optional(),
  note: z.string().optional(),
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
const system = new Set(['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'version'])
export function fieldSql(field: Field): string {
  if (system.has(field.name)) throw new InputError(`Reserved field ${field.name}`)
  const n = ident(field.name)
  let sql = `${n} ${types[field.type]}`
  if (field.default !== undefined) sql += ` DEFAULT ${literal(field.default)}`
  if (field.required) sql += ' NOT NULL'
  if (field.unique) sql += ' UNIQUE'
  const checks: string[] = []
  const o = field.options
  if (o.max_length !== undefined) checks.push(`char_length(${n}) <= ${o.max_length}`)
  if (o.choices)
    checks.push(o.choices.length ? `${n} IN (${o.choices.map(literal).join(',')})` : 'false')
  if (o.min !== undefined) checks.push(`${n} >= ${literal(o.min)}`)
  if (o.max !== undefined) checks.push(`${n} <= ${literal(o.max)}`)
  for (const check of checks) sql += ` CHECK (${check})`
  return sql
}
export async function addField(
  q: pg.Client,
  schema: string,
  table: string,
  f: Field,
  relations = true
) {
  const target = qualified(schema, table)
  await q.query(`ALTER TABLE ${target} ADD COLUMN ${fieldSql(f)}`)
  if (f.indexed && !f.unique) await q.query(`CREATE INDEX ON ${target} (${ident(f.name)})`)
  if (f.relation && relations)
    await addRelation(q, schema, table, f.name, f.relation.collection, f.relation.on_delete)
  if (f.note || f.label)
    await q.query(`COMMENT ON COLUMN ${target}.${ident(f.name)} IS ${literal(f.note ?? f.label)}`)
}
export async function createCollection(q: pg.Client, schema: string, raw: unknown) {
  const model = collectionSchema.parse(raw)
  // Validate identifiers before PostgreSQL can truncate them.
  qualified(schema, model.name)
  return transaction(q, async () => {
    await q.query('SELECT platform.create_collection($1,$2)', [schema, model.name])
    for (const f of model.fields) await addField(q, schema, model.name, f)
    if (model.note || model.label)
      await q.query(
        `COMMENT ON TABLE ${qualified(schema, model.name)} IS ${literal(model.note ?? model.label)}`
      )
    return model
  })
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
  const name =
    'fk_' +
    createHash('sha256')
      .update(table + '\0' + field)
      .digest('hex')
      .slice(0, 24)
  const found = await q.query(
    `SELECT 1 FROM pg_constraint
    WHERE conrelid=to_regclass($1) AND conname=$2`,
    [qualified(schema, table), name]
  )
  if (found.rowCount) return false
  const action = { restrict: 'RESTRICT', cascade: 'CASCADE', set_null: 'SET NULL' }[onDelete]
  await q.query(`ALTER TABLE ${qualified(schema, table)} ADD CONSTRAINT ${ident(name)}
    FOREIGN KEY (${ident(field)}) REFERENCES ${qualified(schema, related)}(id) ON DELETE ${action}`)
  return true
}
