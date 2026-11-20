import { beforeAll, describe, expect, test } from 'bun:test'
import { PGlite } from '@electric-sql/pglite'
import type pg from 'pg'
import { applyManifest } from '../../../packages/cli/src/apply.ts'
import { postureNotes } from '../../../packages/cli/src/database/requirements.ts'
import { hardenSql } from '../../../packages/cli/src/harden.ts'
import { setLogin } from '../../../packages/cli/src/login.ts'
import { install } from '../install.ts'

/**
 * The operator's own questions and switches, asked of the real thing: PostgreSQL, installed
 * with the platform's own script and the example installed in it. What doctor says the deployment
 * has left open, the limit a manifest puts on a role's sessions, and the login a role loses
 * and is given back.
 */

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
  await install(lite)
})

describe('what doctor says a deployment has left open', () => {
  const said = async (about: string) => (await postureNotes(q)).filter((n) => n.includes(about))

  test('the role catalogs, until they are hardened', async () => {
    expect(await said('role catalogs')).toHaveLength(1)
    await lite.exec(hardenSql('strict'))
    expect(await said('role catalogs')).toEqual([])
    await lite.exec(hardenSql('restore'))
  })

  test('the collections a person owns, and not those a group owns', async () => {
    const [owned] = await said('Owned by a person')
    expect(owned).toContain('newsroom.articles (admin@example.com)')
    expect(owned).not.toContain('crm.accounts')
  })

  test('a table that writes no revisions, made by hand or switched off', async () => {
    expect(await said('no revision')).toEqual([])
    await lite.exec(`CREATE TABLE crm.by_hand (id integer);
      ALTER TABLE crm.deals DISABLE TRIGGER platform_audit`)
    try {
      expect((await said('No audit trigger'))[0]).toContain('crm.by_hand')
      expect((await said('audit trigger is disabled'))[0]).toContain('crm.deals')
    } finally {
      await lite.exec(`DROP TABLE crm.by_hand;
        ALTER TABLE crm.deals ENABLE TRIGGER platform_audit`)
    }
    expect(await said('no revision')).toEqual([])
  })
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

describe('a role’s login', () => {
  test('is taken away and given back', async () => {
    expect((await setLogin(q, 'lock', 'alice@example.com'))[0]).toContain('can no longer log in')
    expect((await attributes('alice@example.com'))?.login).toBe(false)
    expect((await setLogin(q, 'lock', 'alice@example.com'))[0]).toContain('already had no login')
    expect((await setLogin(q, 'unlock', 'alice@example.com'))[0]).toContain('may log in again')
    expect((await attributes('alice@example.com'))?.login).toBe(true)
  })

  test('is not taken from the server’s own superuser, from oneself, or from nobody', async () => {
    await expect(setLogin(q, 'lock', 'postgres')).rejects.toThrow()
    await expect(setLogin(q, 'lock', 'nobody@example.com')).rejects.toThrow('no role')
    await expect(setLogin(q, 'lock', undefined)).rejects.toThrow('needs a role')
    expect((await attributes('postgres'))?.login).toBe(true)
  })
})
