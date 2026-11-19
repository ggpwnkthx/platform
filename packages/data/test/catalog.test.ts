import { describe, expect, test } from 'bun:test'
import type { DataSource, RowSet } from '@platform/vocabulary'
import { catalog } from '../src/catalog/query.ts'
import { records } from '../src/content/query.ts'

/**
 * The questions the platform asks PostgreSQL, asked of a source that answers for itself.
 *
 * A source is anything that runs a statement and hands back the rows: the page's own
 * connection in the browser, a client in Node, or the stub below. The question is the same
 * either way, so a stub is enough to hold it to account.
 */

/** A source that answers with what it is told, and remembers what it was asked. */
function source(answers: Record<string, unknown[]>): DataSource & { asked: string[] } {
  const asked: string[] = []
  return {
    asked,
    async query<Row = Record<string, unknown>>(text: string): Promise<RowSet<Row>> {
      asked.push(text)
      const rows = Object.entries(answers).find(([part]) => text.includes(part))?.[1] ?? []
      return { rows: rows as Row[] }
    },
  }
}

describe('The catalog', () => {
  test('it is asked of PostgreSQL, with the privilege functions', async () => {
    const db = source({
      'FROM pg_namespace': [
        { name: 'newsroom', owner: 'owner', kind: 'user', can_create: true, can_alter: true },
      ],
      'FROM pg_class': [
        {
          schema: 'newsroom',
          name: 'articles',
          kind: 'r',
          rls: true,
          force_rls: false,
          owner: 'owner',
          comment: null,
          system: false,
          can_select: true,
          can_insert: true,
          can_update: true,
          can_delete: true,
          can_truncate: true,
          can_alter: true,
        },
      ],
      'FROM pg_attribute': [],
      'FROM pg_constraint': [],
      'FROM pg_type': [],
    })
    const read = await catalog(db)
    expect(read.schemas.map((one) => one.name)).toEqual(['newsroom'])
    expect(read.tables.map((one) => one.name)).toEqual(['articles'])
    // Every answer is the reader's own: PostgreSQL says what the reader may reach.
    expect(db.asked.join('\n')).toContain('has_table_privilege')
    expect(db.asked.join('\n')).toContain('pg_has_role(current_user')
  })

  test('the platform’s own schema is asked for, as a system workspace nobody alters', async () => {
    const db = source({})
    await catalog(db)
    const asked = db.asked.join('\n')
    // PostgreSQL's own schemas and public stay out; the platform's is in, and marked.
    expect(asked).toContain("NOT IN ('information_schema','public')")
    expect(asked).toContain(
      "CASE WHEN n.nspname = 'platform' THEN 'system' ELSE 'user' END AS kind"
    )
    // A system collection is one of the platform's own, or a workspace's metadata collection.
    expect(asked).toContain("(n.nspname = 'platform' OR (c.relname = 'item_metadata' AND EXISTS (")
    expect(asked).toContain("p.polname = 'metadata_read'))) AS system")
    // Its model is the platform's: the interface is never told the reader may change it.
    expect(asked).toContain("has_schema_privilege(n.oid, 'CREATE') AND NOT n.nspname = 'platform'")
    expect(asked).toContain("pg_has_role(current_user, c.relowner, 'USAGE') AND NOT (n.nspname")
    expect(asked).toContain("p.polname = 'metadata_read'))) AS can_alter")
    // The installation's workspaces come first, so the one a reader lands on is theirs.
    expect(asked).toContain("ORDER BY n.nspname = 'platform', 1")
  })

  test('a column of a table the reader may not reach is not in the answer', async () => {
    const db = source({
      'FROM pg_namespace': [],
      'FROM pg_class': [],
      'FROM pg_attribute': [
        {
          schema: 'newsroom',
          table: 'articles',
          name: 'title',
          position: 1,
          type: 'text',
          required: true,
          default: null,
          comment: null,
          generated: null,
          identity: null,
          can_select: true,
          can_insert: true,
          can_update: true,
        },
      ],
      'FROM pg_constraint': [],
      'FROM pg_type': [],
    })
    const read = await catalog(db)
    expect(read.columns).toEqual([])
  })
})

describe('The records of a collection', () => {
  test('every value is bound and every column is quoted', async () => {
    const db = source({ 'count(*)': [{ total: 0 }] })
    await records(db, {
      schema: 'newsroom',
      table: 'articles',
      columns: ['title'],
      searchable: ['title'],
      filter: { status: { op: 'eq', value: 'draft' } },
      search: '',
      sort: ['-created_at'],
      limit: 10,
      offset: 0,
    })
    const asked = db.asked.join('\n')
    expect(asked).toContain('"newsroom"."articles"')
    expect(asked).toContain('"title"')
    expect(asked).toContain('"status" IS NOT DISTINCT FROM $1')
    expect(asked).toContain('ORDER BY "created_at" DESC NULLS LAST')
    expect(asked).toContain('LIMIT $2 OFFSET $3')
  })

  test('a search is a bound pattern, never a statement of its own', async () => {
    const db = source({ 'count(*)': [{ total: 0 }] })
    await records(db, {
      schema: 'newsroom',
      table: 'articles',
      columns: ['title'],
      searchable: ['title'],
      filter: {},
      search: "100%' or 1=1 --",
      sort: [],
      limit: 10,
      offset: 0,
    })
    const asked = db.asked.join('\n')
    expect(asked).toContain('ILIKE $1')
    expect(asked).not.toContain('or 1=1')
  })
})
