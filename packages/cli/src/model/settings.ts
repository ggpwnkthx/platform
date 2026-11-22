import type pg from 'pg'
import type { z } from 'zod'
import {
  collectionTarget,
  commentCollectionStatement,
  fieldTarget,
  qualified,
} from '@platform/vocabulary'
import { describeItem } from './describe.ts'
import type { Report } from './describe.ts'
import type { collectionSchema } from './schema.ts'

/** What a collection says beside its fields: its comment, its row security, its metadata. */
export async function applyCollectionSettings(
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
      // fallow-ignore-next-line security-sink -- the table name is quoted with ident(); the statement takes no value
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
