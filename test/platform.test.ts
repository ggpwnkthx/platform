import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  alice,
  aliceId,
  as,
  connect,
  issuer,
  role,
  setup,
  signIn,
  teardown,
  w,
} from './platform-world.ts'
import pg from 'pg'
import { TokenClient } from '../packages/cli/src/database/db.ts'
import { authenticationProblems } from '../packages/cli/src/database/requirements.ts'
import { ident } from '../packages/vocabulary/src/index.ts'
import { literal } from '../packages/vocabulary/src/index.ts'
import * as pageIdentity from '../packages/data/src/identity/query.ts'
import * as pageSql from '../packages/ui/src/sql/query.ts'
import { refusal } from './page.ts'
import { requirePostgres18 } from '../packages/cli/src/database/requirements.ts'
import { serverSuperuser } from './administrator.ts'

/**
 * The platform, as the database answers it: who a reader is, and what it may reach.
 */
beforeAll(async () => {
  await setup()
}, 30000)
afterAll(async () => {
  await teardown()
}, 30000)

describe('native identity', () => {
  test('in the page’s client, session_user and current_user are the authenticated login', async () => {
    const me = await as('alice', pageIdentity.identity)
    expect(me).toMatchObject({
      username: role('alice'),
      effective_role: role('alice'),
      database: w.dbName,
      platform_version: '2.2.0',
    })
  })
  test('forged, expired, foreign and NOLOGIN sign-ins are refused at login', async () => {
    const tokenFor = (claims: Record<string, unknown> = {}) => issuer().mint(role('alice'), claims)
    const me = await as('alice', pageIdentity.identity)
    expect(me.username).toBe(role('alice'))
    for (const token of [
      issuer().mint(role('alice'), {}, issuer().strangerKey()),
      tokenFor({ exp: Math.floor(Date.now() / 1000) - 60 }),
      tokenFor({ iss: 'https://elsewhere.example' }),
      tokenFor({ email: undefined }),
      'not-a-token',
    ])
      expect(await refusal(signIn('alice', token))).toBe('28000')
    // A token for a role that does not exist, and one for a role that may not log in.
    expect(await refusal(signIn('nobody'))).toBe('28000')
    expect(await refusal(signIn('writer'))).toBe('28000')
  })
  test('a token logs in only the role it names', async () => {
    await expect(connect('bob', issuer().mint(role('alice')))).rejects.toMatchObject({
      code: '28000',
    })
    expect(await refusal(signIn('bob', issuer().mint(role('alice'))))).toBe('28000')
    // The server's own superuser is no login over the network: a token that names it is
    // refused like any other way in.
    await expect(
      new TokenClient(
        { ...w.endpoint, user: serverSuperuser },
        issuer().mint(serverSuperuser)
      ).connect()
    ).rejects.toMatchObject({ code: '28000' })
  })
  test('SET ROLE, session authorization and application identity cannot impersonate another user', async () => {
    await as('alice', async (db) => {
      expect(await refusal(pageSql.run(db, `SET ROLE ${ident(role('owner'))}`))).toBe('42501')
      expect(
        await refusal(pageSql.run(db, `SET SESSION AUTHORIZATION ${ident(role('owner'))}`))
      ).toBe('42501')
    })
    await alice.query(`SET app.user_id=${literal(role('bob'))}`)
    expect((await alice.query('SELECT id FROM newsroom.articles')).rows.map((r) => r.id)).toEqual([
      aliceId,
    ])
    await alice.query('RESET app.user_id')
  })
  test('NOLOGIN immediately prevents the next sign-in of the page’s client', async () => {
    await w.admin.query(`ALTER ROLE ${ident(role('alice'))} NOLOGIN`)
    try {
      expect(await refusal(signIn('alice'))).toBe('28000')
    } finally {
      await w.admin.query(`ALTER ROLE ${ident(role('alice'))} LOGIN`)
    }
  })
  test('a role password is not a login', async () => {
    await w.admin.query(`ALTER ROLE ${ident(role('alice'))} PASSWORD 'a-real-password'`)
    try {
      const q = new pg.Client({ ...w.endpoint, user: role('alice'), password: 'a-real-password' })
      q.on('error', () => undefined)
      await expect(q.connect()).rejects.toThrow()
      await q.end().catch(() => undefined)
    } finally {
      await w.admin.query(`ALTER ROLE ${ident(role('alice'))} PASSWORD NULL`)
    }
  })
  test('the server is PostgreSQL 18 and lets people in over the network by token only', async () => {
    await requirePostgres18(w.admin)
    expect(await authenticationProblems(w.admin)).toEqual([])
    expect(await authenticationProblems(alice)).toBe('unchecked')
  })
})
