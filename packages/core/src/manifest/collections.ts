import type { Collection, Relation } from './schema.ts'
import { fieldSpec } from './schema.ts'
import type { Run } from './run.ts'
import {
  commentCollectionStatement,
  createCollectionStatements,
  fieldStatements,
  relationStatement,
} from '../sql/columns.ts'
import { ident } from '../sql/kit.ts'
import { collectionTarget, fieldTarget } from '../sql/metadata.ts'
import { rowSecurityStatement } from '../sql/policies.ts'
/** Additive: collections and fields that are missing are made; nothing is altered or dropped. */
export async function applyCollections(
  run: Run,
  schema: string,
  collections: Collection[],
  relations: Relation[] = []
) {
  for (const c of collections) {
    const named = `${schema}.${c.name}`
    const exists = (
      await run.one<{ t: unknown }>('SELECT to_regclass($1) AS t', [ident(schema, c.name)])
    )?.t
    if (exists) run.unchanged++
    else {
      await run.all(createCollectionStatements(schema, c.name))
      run.changed(`create collection ${named}`)
    }
    for (const f of c.fields) {
      const column = await run.one(
        `SELECT 1 FROM information_schema.columns
          WHERE table_schema=$1 AND table_name=$2 AND column_name=$3`,
        [schema, c.name, f.name]
      )
      if (column) run.unchanged++
      else {
        await run.all(fieldStatements(schema, c.name, fieldSpec(f), false))
        if (exists) run.changed(`add field ${named}.${f.name}`)
      }
    }
    await applyCollectionSettings(run, schema, c, named)
    await run.describe(collectionTarget(schema, c.name), c.metadata)
    for (const f of c.fields) await run.describe(fieldTarget(schema, c.name, f.name), f.metadata)
  }
  for (const r of relationsOf(collections, relations)) {
    const found = await run.one(
      `SELECT 1 FROM pg_constraint con
         JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
        WHERE con.contype = 'f' AND con.conrelid = to_regclass($1) AND a.attname = $2`,
      [ident(schema, r.collection), r.field]
    )
    if (found) run.unchanged++
    else {
      await run.db.query(
        relationStatement(schema, r.collection, r.field, r.related, r.on_delete ?? r.onDelete)
      )
      run.changed(`relate ${schema}.${r.collection}.${r.field} to ${r.related}`)
    }
  }
}

/** What the manifest says of a collection itself: what it is for, and whether it asks for policies. */
async function applyCollectionSettings(run: Run, schema: string, c: Collection, named: string) {
  const held = await run.one<{ note: string | null; secured: boolean }>(
    `SELECT obj_description(oid, 'pg_class') AS note, relrowsecurity AS secured
         FROM pg_class WHERE oid = to_regclass($1)`,
    [ident(schema, c.name)]
  )
  if (c.note !== undefined && (held?.note ?? '') !== c.note.trim()) {
    await run.db.query(commentCollectionStatement(schema, c.name, c.note))
    run.changed(`say what ${named} is for`)
  }
  if (c.row_security !== undefined && held?.secured !== c.row_security) {
    await run.db.query(rowSecurityStatement(schema, c.name, c.row_security))
    run.changed(`${c.row_security ? 'ask' : 'stop asking'} ${named} for row policies`)
  }
}

/** The relations the manifest names, and those its fields carry. */
const relationsOf = (collections: Collection[], relations: Relation[]): Relation[] => [
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
