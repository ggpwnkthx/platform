import type pg from 'pg'
import { z } from 'zod'
import {
  fieldsViewsStatement,
  ident,
  systemFields,
  fieldTarget,
  transaction,
  qualified,
} from '@platform/vocabulary'
import { requireInstalledVersion } from '../version.ts'
import { addField } from './field.ts'
import { silent, type Report } from './describe.ts'
import { addRelation } from './relation.ts'
import { applyCollectionSettings } from './settings.ts'
import { collectionSchema } from './schema.ts'
import { relationSchema } from './relation.ts'

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
    // fallow-ignore-next-line security-sink -- the schema name is quoted with ident()
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
