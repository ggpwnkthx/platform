import { beforeAll, describe, expect, test } from 'bun:test'
import { PGlite } from '@electric-sql/pglite'
import { defaultViews, viewsKey } from '@platform/vocabulary'
import { applyManifest } from '../../../packages/cli/src/apply.ts'
import { applyExample, namedFor } from '../../../packages/cli/src/example.ts'
import {
  client,
  example,
  fingerprint,
  fingerprintOf,
  install,
  installPlatform,
} from '../install.ts'

/**
 * The example is three files, applied in order by the operator's own tools: models.json for
 * the schema, migration.sql for what a manifest cannot say, demo.sql for the records and
 * their history. They are applied here to the real thing, as a deployment applies them.
 */
let db: PGlite
const one = async <T>(sql: string, values: unknown[] = []) =>
  (await db.query<T>(sql, values)).rows[0] as T
const count = async (table: string) =>
  (await one<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).n

/** Applies the example again, as a deployment that is brought up a second time does. */
const again = async (admin?: string) => {
  const q = client(db)
  await q.query('BEGIN')
  const result = await applyExample(q, example, admin)
  await q.query('COMMIT')
  return result
}

beforeAll(async () => {
  db = await PGlite.create()
  await install(db)
})

describe('the schema, from models.json', () => {
  test('both workspaces are made, each owned by who the manifest names', async () => {
    const owners = await db.query<{ workspace: string; owner: string }>(
      `SELECT nspname AS workspace, pg_get_userbyid(nspowner) AS owner FROM pg_namespace
        WHERE nspname IN ('newsroom', 'crm') ORDER BY 1`
    )
    expect(owners.rows).toEqual([
      { workspace: 'crm', owner: 'sales' },
      { workspace: 'newsroom', owner: 'admin@example.com' },
    ])
    // A group owns the CRM's collections too: every member administers them.
    const tables = await db.query<{ owner: string }>(
      `SELECT DISTINCT tableowner AS owner FROM pg_tables WHERE schemaname = 'crm'`
    )
    expect(tables.rows).toEqual([{ owner: 'sales' }])
  })

  test('every field of every collection says where it appears, as the platform does by default', async () => {
    const unsaid = await db.query(
      `SELECT c.table_schema, c.table_name, c.column_name FROM information_schema.columns c
        WHERE c.table_schema IN ('newsroom', 'crm') AND NOT EXISTS (
          SELECT FROM platform.item_metadata m
           WHERE m.scope = 'field' AND m.schema_name = c.table_schema
             AND m.table_name = c.table_name AND m.column_name = c.column_name
             AND m.key = $1 AND m.value = $2::jsonb)`,
      [viewsKey, JSON.stringify(defaultViews)]
    )
    expect(unsaid.rows).toEqual([])
  })

  test('the desks ask for no row policy, and the collections say what they are for', async () => {
    const sections = await one<{ secured: boolean; note: string }>(
      `SELECT relrowsecurity AS secured, obj_description(oid) AS note FROM pg_class
        WHERE oid = 'newsroom.sections'::regclass`
    )
    expect(sections).toEqual({ secured: false, note: 'The desks an article is filed under.' })
  })

  test('the administrator may admit people to the groups', async () => {
    const held = await db.query<{ group: string }>(
      `SELECT r.rolname AS group FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid
        WHERE pg_get_userbyid(m.member) = 'admin@example.com' AND m.admin_option
          AND r.rolname IN ('newsroom_reader', 'newsroom_writer', 'sales') ORDER BY 1`
    )
    expect(held.rows.map((row) => row.group)).toEqual([
      'newsroom_reader',
      'newsroom_writer',
      'sales',
    ])
  })

  test('the items say what they are called, and a field says so beside where it appears', async () => {
    const said = await db.query<{ scope: string; key: string; value: unknown }>(
      `SELECT scope, key, value FROM platform.item_metadata
        WHERE schema_name = 'newsroom' AND coalesce(table_name, 'articles') = 'articles'
          AND coalesce(column_name, 'title') = 'title'
          AND key IN ('display_name', 'retention') ORDER BY scope, key`
    )
    expect(said.rows).toEqual([
      { scope: 'collection', key: 'display_name', value: 'Articles' },
      { scope: 'collection', key: 'retention', value: { drafts_days: 90, published: 'forever' } },
      { scope: 'field', key: 'display_name', value: 'Headline' },
      { scope: 'workspace', key: 'display_name', value: 'Newsroom' },
    ])
  })
})

describe('the edge cases, from migration.sql', () => {
  test('what a workspace says of itself is its owner’s, and none of it is the installer’s', async () => {
    const name = await one<{ value: string; created_by: string }>(
      `SELECT value, created_by FROM platform.item_metadata
        WHERE scope = 'workspace' AND schema_name = 'crm' AND key = 'display_name'`
    )
    expect(name).toEqual({ value: 'CRM', created_by: 'bob@example.com' })
    expect(
      await count(
        `platform.item_metadata WHERE schema_name IN ('newsroom', 'crm') AND created_by = 'postgres'`
      )
    ).toBe(0)
  })
})

describe('the records and their history, from demo.sql', () => {
  test('the collections hold their records, written by the people who would have written them', async () => {
    expect(await count('newsroom.sections')).toBe(8)
    expect(await count('newsroom.articles')).toBe(60)
    expect(await count('crm.accounts')).toBe(20)
    const authors = await db.query<{ created_by: string }>(
      'SELECT DISTINCT created_by FROM newsroom.articles ORDER BY 1'
    )
    expect(authors.rows.map((row) => row.created_by)).toEqual([
      'alice@example.com',
      'bob@example.com',
    ])
  })

  test('every record has the revision a trigger would have written, at the time it says', async () => {
    expect(
      await count(
        `newsroom.articles a WHERE NOT EXISTS (SELECT FROM platform.activity r
          WHERE r.schema_name = 'newsroom' AND r.table_name = 'articles' AND r.operation = 'INSERT'
            AND r.after_row ->> 'id' = a.id::text AND r.at = a.created_at)`
      )
    ).toBe(0)
  })

  test('the triggers are back on: a record written afterwards is stamped and recorded', async () => {
    const before = await count('platform.activity')
    await db.exec(`INSERT INTO newsroom.sections (name) VALUES ('Obituaries')`)
    expect(await count('platform.activity')).toBe(before + 1)
    await db.exec(`DELETE FROM newsroom.sections WHERE name = 'Obituaries'`)
  })
})

describe('an example that is applied again', () => {
  test('changes nothing, and writes no record twice', async () => {
    const activity = await count('platform.activity')
    const result = await again()
    expect(result.changes).toEqual([])
    expect(result.notes.join('\n')).toContain('demo.sql was not run')
    expect(await count('newsroom.articles')).toBe(60)
    expect(await count('platform.activity')).toBe(activity)
  })

  test('leaves alone what an owner has said since', async () => {
    await db.exec(
      `UPDATE platform.item_metadata SET value = '"Desk"' WHERE schema_name = 'newsroom'
        AND scope = 'workspace' AND key = 'display_name'`
    )
    await again()
    const name = await one<{ value: string }>(
      `SELECT value FROM platform.item_metadata WHERE schema_name = 'newsroom'
        AND scope = 'workspace' AND key = 'display_name'`
    )
    expect(name.value).toBe('Desk')
  })
})

describe('a manifest that says otherwise of what is already there', () => {
  test('changes the comment and the row security, says what is unsaid, and reports each', async () => {
    const other = await PGlite.create()
    await install(other)
    const q = client(other)
    const manifest = {
      users: [{ name: 'alice@example.com', admits: ['newsroom_writer'] }],
      workspaces: [
        {
          slug: 'newsroom',
          owner: 'admin@example.com',
          metadata: { display_name: 'Desk', motto: 'First, and right.' },
          collections: [{ name: 'sections', note: 'The desks.', row_security: true }],
        },
      ],
    }
    await q.query('BEGIN')
    const result = await applyManifest(q, manifest)
    await q.query('COMMIT')
    expect(result.changes).toEqual([
      'let alice@example.com admit others to newsroom_writer',
      'describe workspace newsroom: motto',
      'say what newsroom.sections is for',
      'ask newsroom.sections for row policies',
    ])
    await q.query('BEGIN')
    expect((await applyManifest(q, manifest)).changes).toEqual([])
    await q.query('COMMIT')
    await other.close()
  })
})

describe('a deployment’s own administrator', () => {
  test('is named wherever the example names its own, in all three files', () => {
    const named = namedFor(example, 'root@corp.example')
    for (const text of [JSON.stringify(named.models), named.migration, named.demo]) {
      expect(text).toContain('root@corp.example')
      expect(text).not.toContain('admin@example.com')
    }
    // The other people of the example keep their names.
    expect(named.demo).toContain('alice@example.com')
  })

  test('must be an address: it is written into SQL', () => {
    expect(() => namedFor(example, `x"; DROP ROLE postgres; --`)).toThrow('is an address')
  })

  test('owns the newsroom, and the example’s own administrator is nobody', async () => {
    const other = await PGlite.create()
    const q = client(other)
    await installPlatform(other)
    await q.query('BEGIN')
    await applyExample(q, example, 'root@corp.example')
    await q.query('COMMIT')
    const found = await other.query<{ owner: string; example: number }>(
      `SELECT pg_get_userbyid(nspowner) AS owner,
              (SELECT count(*)::int FROM pg_roles WHERE rolname = 'admin@example.com') AS example
         FROM pg_namespace WHERE nspname = 'newsroom'`
    )
    expect(found.rows).toEqual([{ owner: 'root@corp.example', example: 0 }])
    await other.close()
  })
})

describe('what the installation is made from, as a name', () => {
  test('is the same for the same texts, and short enough to be part of a name', () => {
    expect(fingerprintOf(['a', 'b'])).toBe(fingerprintOf(['a', 'b']))
    expect(fingerprint).toMatch(/^[0-9a-z]{1,11}$/)
  })

  test('is another when any text changes, or moves from one file to the next', () => {
    expect(fingerprintOf(['a', 'b'])).not.toBe(fingerprintOf(['a', 'c']))
    expect(fingerprintOf(['ab', ''])).not.toBe(fingerprintOf(['a', 'b']))
    expect(fingerprintOf([example.demo ?? ''])).not.toBe(fingerprintOf([`${example.demo} `]))
  })
})
