import { afterAll, beforeAll, expect, test } from 'bun:test'
import { createServer, type Server } from 'node:net'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { transaction } from '@platform/core'
import { connect, openSession } from '../src/connect.ts'
import { relayOptionsFromEnv, startRelay } from '@platform/relay'

/**
 * A stand-in for PostgreSQL 18's token login, enough of the protocol to prove what the page
 * sends: it asks for OAUTHBEARER, and lets in the one token it knows, as the role it names.
 */
function tokenServer(accept: string): Promise<{ server: Server; port: number; seen: string[] }> {
  const message = (type: string, body: Buffer) => {
    const head = Buffer.alloc(5)
    head.write(type)
    head.writeInt32BE(body.length + 4, 1)
    return Buffer.concat([head, body])
  }
  const int = (n: number) => {
    const b = Buffer.alloc(4)
    b.writeInt32BE(n)
    return b
  }
  const seen: string[] = []
  const server = createServer((socket) => {
    let started = false
    socket.on('data', (data: Buffer) => {
      if (!started) {
        started = true
        seen.push(data.subarray(8).toString().split('\0').join(' '))
        return socket.write(message('R', Buffer.concat([int(10), Buffer.from('OAUTHBEARER\0\0')])))
      }
      if (data.toString('latin1', 0, 1) !== 'p') return
      const said = data.toString()
      seen.push(said.slice(said.indexOf('n,,')))
      if (said.includes(`auth=Bearer ${accept}\x01\x01`))
        socket.write(Buffer.concat([message('R', int(0)), message('Z', Buffer.from('I'))]))
      else
        socket.end(
          message('E', Buffer.from('SFATAL\0C28000\0MOAuth bearer authentication failed\0\0'))
        )
    })
  })
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, port: (server.address() as { port: number }).port, seen })
    )
  )
}

let fake: Awaited<ReturnType<typeof tokenServer>>
let pglite: PGLiteSocketServer
const relays: { stop(): void }[] = []
const relayTo = (port: number, allowedOrigins: string[] = []) => {
  const relay = startRelay({ upstream: { host: '127.0.0.1', port }, port: 0, allowedOrigins })
  relays.push(relay)
  return `ws://127.0.0.1:${relay.port}/`
}
beforeAll(async () => {
  fake = await tokenServer('the.right.token')
  pglite = new PGLiteSocketServer({ db: await PGlite.create(), port: 54399, host: '127.0.0.1' })
  await pglite.start()
})
afterAll(async () => {
  for (const relay of relays) relay.stop()
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

test('only the site may open a session, and only with a startup packet', async () => {
  const url = relayTo(54399, ['https://platform.example.com'])
  expect((await fetch(url.replace('ws:', 'http:'))).status).toBe(403)
  expect((await fetch(`${url.replace('ws:', 'http:')}health`)).status).toBe(200)
  const closed = await new Promise<CloseEvent>((resolve) => {
    const ws = new WebSocket(relayTo(54399))
    ws.onopen = () => ws.send(new Uint8Array([0, 0, 0, 8, 4, 210, 22, 47])) // an SSLRequest
    ws.onclose = resolve
  })
  expect(closed.code).toBe(1008)
})

test('a token never crosses a network in the clear by accident', () => {
  expect(() => relayOptionsFromEnv({ RELAY_UPSTREAM: 'db.example.com:5432' })).toThrow(
    'RELAY_UPSTREAM_TLS'
  )
  expect(
    relayOptionsFromEnv({
      RELAY_UPSTREAM: 'db.example.com:5432',
      RELAY_UPSTREAM_TLS: 'verify',
      RELAY_ORIGINS: 'https://a.example/, *',
    })
  ).toMatchObject({
    upstream: { host: 'db.example.com', port: 5432, tls: {} },
    allowedOrigins: ['https://a.example'],
  })
})
