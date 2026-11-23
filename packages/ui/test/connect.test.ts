import { afterAll, beforeAll, expect, test } from 'bun:test'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { transaction } from '@platform/core'
import { connect, openSession } from '../src/connect.ts'
import { relayTo, stopRelays, tokenServer } from './fake.ts'

let fake: Awaited<ReturnType<typeof tokenServer>>
let pglite: PGLiteSocketServer
beforeAll(async () => {
  fake = await tokenServer('the.right.token')
  pglite = new PGLiteSocketServer({ db: await PGlite.create(), port: 54399, host: '127.0.0.1' })
  await pglite.start()
})
afterAll(async () => {
  stopRelays()
  fake.server.close()
  await pglite.stop()
})

test('the page logs in with its token, through the relay, as the role it names', async () => {
  const login = { relay: relayTo(fake.port), database: 'platform', role: 'alice@example.com' }
  const db = await connect({ ...login, token: 'the.right.token' })
  db.close()
  expect(fake.seen[0]).toContain('user alice@example.com database platform')
  expect(fake.seen[0]).toContain('application_name platform-ui')
  expect(fake.seen[1]).toBe('n,,\x01auth=Bearer the.right.token\x01\x01')
  const refused = await connect({ ...login, token: 'another.token' }).catch((error) => error)
  expect(refused).toMatchObject({ code: '28000' })
})

test('statements travel through the relay to a real PostgreSQL and back', async () => {
  const db = await connect({
    relay: relayTo(54399),
    database: 'postgres',
    role: 'postgres',
    token: '',
  })
  const found = await db.query(
    `SELECT $1::int + 1 AS n, now() AS at, '{"a":[1]}'::jsonb AS j, 7::int8 AS big`,
    [41]
  )
  expect(found.rows[0]).toMatchObject({ n: 42, j: { a: [1] }, big: 7 })
  expect(typeof found.rows[0]!.at).toBe('string')
  expect(found.fields.map((f) => f.name)).toEqual(['n', 'at', 'j', 'big'])
  // One statement per query: a second one in the same text is PostgreSQL's to refuse.
  expect(await db.query('SELECT 1; SELECT 2').catch((e) => e.code)).toBe('42601')
  db.close()
})

test('a sign-in keeps its logins: two things at once, a transaction to itself, a login of its own', async () => {
  const own = new PGLiteSocketServer({
    db: await PGlite.create(),
    port: 54400,
    host: '127.0.0.1',
    maxConnections: 5,
  })
  await own.start()
  const session = openSession({
    relay: relayTo(54400),
    database: 'postgres',
    role: 'postgres',
    token: '',
  })
  await session.query('CREATE TABLE IF NOT EXISTS kept (n int)')
  const [one, two] = await Promise.all([
    session.query('SELECT 1 AS n'),
    session.query('SELECT 2 AS n'),
  ])
  expect([one.rows[0], two.rows[0]]).toEqual([{ n: 1 }, { n: 2 }])
  const failed = session.exclusive((db) =>
    transaction(db, async () => {
      await db.query('INSERT INTO kept VALUES (1)')
      await db.query('SELECT 1/0')
    })
  )
  expect(await failed.catch((e) => e.code)).toBe('22012')
  expect((await session.query('SELECT count(*)::int AS n FROM kept')).rows[0]).toEqual({ n: 0 })
  expect((await session.own((db) => db.query('SELECT 3 AS n'))).rows[0]).toEqual({ n: 3 })
  await session.close()
  void own.stop()
})
