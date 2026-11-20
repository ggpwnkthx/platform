import { beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import {
  catalog,
  grants,
  policies,
  reach,
  roles,
  schemaReach,
  tablePolicies,
  tablesIn,
} from '@platform/data'
import type { DataSource } from '@platform/vocabulary'
import { hardenSql } from '../../../packages/cli/src/harden.ts'

/**
 * `cli harden` hides PostgreSQL's role catalogs from ordinary connections, and the interface
 * is said to keep working. This asks the real thing — PostgreSQL, installed with the
 * platform's own script, seeded with the example and hardened — the questions the pages ask,
 * as people who are not operators.
 */
const text = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

let pg: PGlite
const db: DataSource = {
  query: (async (statement: string, values?: unknown[]) => {
    const result = await pg.query(statement, values as never)
    return { rows: result.rows, affected: result.affectedRows }
  }) as DataSource['query'],
}

async function as<T>(role: string, ask: () => Promise<T>): Promise<T> {
  await pg.query(`SET SESSION AUTHORIZATION ${JSON.stringify(role)}`)
  try {
    return await ask()
  } finally {
    await pg.query('SET SESSION AUTHORIZATION postgres')
  }
}

const count = async (statement: string) =>
  Number((await pg.query<{ n: number }>(statement)).rows[0]?.n)

beforeAll(async () => {
  pg = await PGlite.create()
  await pg.exec(text('../../../migrations/0001_platform.sql'))
  await pg.exec(text('../seed.sql'))
  await pg.exec(hardenSql('strict'))
})

describe('a hardened database, asked by someone who is not an operator', () => {
  test('does not show them the role catalogs', async () => {
    for (const hidden of ['pg_roles', 'pg_auth_members', 'pg_user'])
      await expect(
        as('bob@example.com', () => pg.query(`SELECT 1 FROM ${hidden}`))
      ).rejects.toThrow('permission denied')
  })

  test('still says who they are and what they belong to', async () => {
    const found = await as('bob@example.com', () => roles(db))
    expect(found.roles.map((r) => r.name)).toContain('sales')
    expect(found.memberships.every((m) => m.member === 'bob@example.com')).toBe(true)
  })

  test('still answers what roles may do in a workspace', async () => {
    const answers = await as('bob@example.com', () => reach(db, 'crm'))
    expect(answers.some((a) => a.role === 'sales' && a.select === 'all')).toBe(true)
    const schema = await as('bob@example.com', () => schemaReach(db, 'crm'))
    expect(schema.find((a) => a.role === 'sales')?.usage).toBe(true)
    // A role nobody holds is asked about as nobody, not as an error.
    expect(
      await as('bob@example.com', () => reach(db, 'crm', { role: 'nobody@example.com' }))
    ).toEqual([])
  })

  test('still reads the catalog, the grants and the policies', async () => {
    await as('alice@example.com', async () => {
      expect(tablesIn(await catalog(db), 'newsroom').length).toBeGreaterThan(0)
      await grants(db, 'newsroom')
      expect((await policies(db)).length).toBeGreaterThan(0)
      const found = await tablePolicies(db, 'newsroom', 'articles')
      expect(found.some((p) => p.applies)).toBe(true)
    })
  })

  test('still shows a workspace’s revisions to its owners, and to nobody else', async () => {
    const revisions = 'SELECT count(*)::int AS n FROM platform.activity'
    expect(await as('bob@example.com', () => count(revisions))).toBeGreaterThan(0)
    expect(await as('alice@example.com', () => count(revisions))).toBe(0)
  })

  test('a revision whose workspace has lost its owner reaches nobody', async () => {
    await pg.exec(`INSERT INTO platform.activity
      (actor, actor_oid, workspace_owner, relation, schema_name, table_name, operation)
      VALUES ('gone@example.com', 0, 4000000000, 0, 'gone', 'things', 'INSERT')`)
    const orphans = "SELECT count(*)::int AS n FROM platform.activity WHERE schema_name = 'gone'"
    expect(await count(orphans)).toBe(1)
    expect(await as('bob@example.com', () => count(orphans))).toBe(0)
    expect(await as('alice@example.com', () => count(orphans))).toBe(0)
  })
})
