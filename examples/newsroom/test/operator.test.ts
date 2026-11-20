import { beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import type pg from 'pg'
import { applyManifest } from '../../../packages/cli/src/apply.ts'

/**
 * The operator's own questions and switches, asked of the real thing: PostgreSQL, installed
 * with the platform's own script and seeded with the example. The limit a manifest puts on a
 * role's sessions, which is PostgreSQL's own count, across every relay together.
 */
const text = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

let lite: PGlite
/** The operator's tools speak to a pg client; this PostgreSQL answers the same statements. */
const q = {
  query: async (statement: string, values?: unknown[]) => {
    const result = await lite.query(statement, values as never)
    return { rows: result.rows, rowCount: result.affectedRows }
  },
} as unknown as pg.Client

const attributes = async (role: string) =>
  (
    await lite.query<{ login: boolean; connection_limit: number }>(
      'SELECT login, connection_limit FROM platform.role_attributes($1)',
      [role]
    )
  ).rows[0]

beforeAll(async () => {
  lite = await PGlite.create()
  await lite.exec(text('../../../migrations/0001_platform.sql'))
  await lite.exec(text('../seed.sql'))
})

describe('the sessions a role may hold', () => {
  const manifest = (connections?: number) => ({
    users: [{ name: 'carol@example.com', ...(connections === undefined ? {} : { connections }) }],
  })

  test('a manifest sets PostgreSQL’s own limit, and repeats as a no-op', async () => {
    const made = await applyManifest(q, manifest(4))
    expect(made.changes).toContain('limit carol@example.com to 4 connections')
    expect((await attributes('carol@example.com'))?.connection_limit).toBe(4)
    expect((await applyManifest(q, manifest(4))).changes).toEqual([])
  })

  test('a manifest that does not name it leaves it as it is, and -1 lifts it', async () => {
    expect((await applyManifest(q, manifest())).changes).toEqual([])
    expect((await attributes('carol@example.com'))?.connection_limit).toBe(4)
    expect((await applyManifest(q, manifest(-1))).changes).toEqual([
      'lift the connection limit of carol@example.com',
    ])
    expect((await attributes('carol@example.com'))?.connection_limit).toBe(-1)
  })
})
