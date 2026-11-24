import type { Collection, Relation } from './schema.ts'
import { fieldSpec } from './schema.ts'
import type { Run } from './run.ts'
import {
  commentCollectionStatement,
  coveredFields,
  createCollectionStatements,
  deleteCodes,
  fieldStatements,
  relationIndexStatement,
  relationStatement,
  uniqueIndexStatement,
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
    await applyUniqueGroups(run, schema, c, named)
    await run.describe(collectionTarget(schema, c.name), c.metadata)
    for (const f of c.fields) await run.describe(fieldTarget(schema, c.name, f.name), f.metadata)
  }
  const covered = coveredFields(collections)
  for (const r of relationsOf(collections, relations)) {
    const found = await run.one<{
      name: string
      on_delete: string
      target_schema: string
      target_table: string
    }>(
      `SELECT con.conname::text AS name, con.confdeltype::text AS on_delete,
              rn.nspname::text AS target_schema, rc.relname::text AS target_table
         FROM pg_constraint con
         JOIN pg_class c ON c.oid = con.conrelid
         JOIN pg_class rc ON rc.oid = con.confrelid
         JOIN pg_namespace rn ON rn.oid = rc.relnamespace
         JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
        WHERE con.contype = 'f' AND con.conrelid = to_regclass($1) AND a.attname = $2`,
      [ident(schema, r.collection), r.field]
    )
    if (r.state === 'absent') {
      // The relation is gone: the key is dropped, and the two collections are apart.
      if (!found) {
        run.unchanged++
        continue
      }
      await run.db.query(
        `ALTER TABLE ${ident(schema, r.collection)} DROP CONSTRAINT ${ident(found.name)}`
      )
      run.changed(`unrelate ${schema}.${r.collection}.${r.field} from ${r.related}`)
      continue
    }
    const onDelete = r.on_delete ?? r.onDelete ?? 'restrict'
    if (found) {
      // The key is there. It is the key the manifest says only when it points at the same
      // collection and goes the same way: a key made by hand, or one left over from a
      // different manifest, is brought to what is said, and the change is named.
      const same =
        found.target_schema === schema &&
        found.target_table === r.related &&
        found.on_delete === deleteCodes[onDelete]
      if (same) run.unchanged++
      else {
        await run.db.query(
          `ALTER TABLE ${ident(schema, r.collection)} DROP CONSTRAINT ${ident(found.name)}`
        )
        await run.db.query(
          relationStatement(schema, r.collection, r.field, r.related, onDelete, found.name)
        )
        run.changed(`repoint ${schema}.${r.collection}.${r.field} to ${r.related} (${onDelete})`)
      }
    } else {
      await run.db.query(relationStatement(schema, r.collection, r.field, r.related, onDelete))
      run.changed(`relate ${schema}.${r.collection}.${r.field} to ${r.related}`)
    }
    // The key is indexed: PostgreSQL makes no index for the key it does not make, and a
    // row that points at another is found by a scan without one.
    if (!covered.has(`${r.collection}.${r.field}`))
      await applyRelationIndex(run, schema, r.collection, r.field)
  }
}

/** The index a foreign key needs, made once and left alone afterwards. */
async function applyRelationIndex(run: Run, schema: string, table: string, field: string) {
  const found = await run.one(
    `SELECT 1 FROM pg_index x
       JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = x.indkey[0]
      WHERE x.indrelid = to_regclass($1) AND a.attname = $2 AND x.indisvalid`,
    [ident(schema, table), field]
  )
  if (found) {
    run.unchanged++
    return
  }
  await run.db.query(relationIndexStatement(schema, table, field))
  run.changed(`index ${schema}.${table}.${field}`)
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

/**
 * The pairs of columns that are unique together. An index PostgreSQL already holds over the
 * same columns is left alone, so a second apply changes nothing.
 */
async function applyUniqueGroups(run: Run, schema: string, c: Collection, named: string) {
  for (const group of c.unique) {
    if (group.length < 2) continue
    const found = await run.one(
      `SELECT 1 FROM pg_index x JOIN pg_class c ON c.oid = x.indrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relname = $2 AND x.indisunique
          AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
                 FROM unnest(x.indkey::int2[]) AS k(attnum)
                 JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum)
              = (SELECT array_agg(x::text ORDER BY x::text) FROM unnest($3::text[]) AS x)`,
      [schema, c.name, [...group]]
    )
    if (found) run.unchanged++
    else {
      await run.db.query(uniqueIndexStatement(schema, c.name, [...group]))
      run.changed(`make ${named} hold one ${group.join(' and ')}`)
    }
  }
}

/**
 * The relations the manifest names, and those its fields carry. A relation named at the
 * top of the workspace is said once there, and wins over the field that carries it: a
 * workspace may say that a field is no longer related at all.
 */
const relationsOf = (collections: Collection[], relations: Relation[]): Relation[] => {
  const byKey = new Map<string, Relation>()
  for (const relation of relations) byKey.set(`${relation.collection}.${relation.field}`, relation)
  for (const c of collections)
    for (const f of c.fields) {
      if (!f.relation) continue
      const key = `${c.name}.${f.name}`
      if (byKey.has(key)) continue
      byKey.set(key, {
        collection: c.name,
        field: f.name,
        related: f.relation.collection,
        on_delete: f.relation.on_delete,
        state: 'present',
      })
    }
  return [...byKey.values()]
}
