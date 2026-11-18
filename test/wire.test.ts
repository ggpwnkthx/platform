import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { connect as tcp } from 'node:net'
import pg from 'pg'
import {
  Connection,
  PgError,
  parseArray,
  serialize,
  type Transport,
} from '../packages/ui/src/pg/wire.ts'
import { startIssuer } from './issuer.ts'

/**
 * The page's own PostgreSQL client, logging in with a token over a plain socket: the same
 * bytes the relay forwards from a browser.
 */
const adminUrl =
  process.env.TEST_ADMIN_URL ?? 'postgres://postgres:test-admin-password@127.0.0.1:54329/postgres'
const url = new URL(adminUrl)
const prefix = `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const database = `${prefix}_db`
const person = `${prefix}_person@example.com`
const issuer = startIssuer(process.env.TEST_OIDC_ISSUER ?? 'http://127.0.0.1:54330')
let root: pg.Client

function socket(): Promise<Transport> {
  return new Promise((resolve, reject) => {
    const s = tcp({ host: url.hostname, port: Number(url.port || 5432) })
    const transport: Transport = {
      send: (bytes) => void s.write(Buffer.from(bytes)),
      close: () => void s.end(),
      ondata: null,
      onclose: null,
    }
    s.on('data', (chunk) => transport.ondata?.(new Uint8Array(chunk as Buffer)))
    s.on('close', () => transport.onclose?.(null))
    s.on('error', (error) => transport.onclose?.(error))
    s.once('connect', () => resolve(transport))
    s.once('error', reject)
  })
}
const login = async (token = issuer.mint(person), user = person) =>
  Connection.open(await socket(), { user, database, token })

beforeAll(async () => {
  root = new pg.Client(adminUrl)
  await root.connect()
  await root.query(`CREATE DATABASE "${database}"`)
  await root.query(`CREATE ROLE "${person}" LOGIN`)
  await root.query(`GRANT CONNECT ON DATABASE "${database}" TO "${person}"`)
})
afterAll(async () => {
  await root.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`)
  await root.query(`DROP ROLE IF EXISTS "${person}"`)
  await root.end()
  issuer.stop()
})

describe('wire client', () => {
  test('logs in as the role the token names and reads typed values', async () => {
    const q = await login()
    const result = await q.query(
      `SELECT session_user AS who, 1::int AS one, 2::bigint AS two, true AS yes,
              '{"a":[1]}'::jsonb AS doc, ARRAY['x','y,z',NULL]::text[] AS list, NULL::text AS nothing,
              1.50::numeric AS exact, $1::text AS echo`,
      ['é ü 😀']
    )
    expect(result.command).toBe('SELECT')
    expect(result.affected).toBe(1)
    expect(result.rows[0]).toEqual({
      who: person,
      one: 1,
      two: 2,
      yes: true,
      doc: { a: [1] },
      list: ['x', 'y,z', null],
      nothing: null,
      exact: '1.50',
      echo: 'é ü 😀',
    })
    q.close()
  })

  test('a refused statement rejects with the SQLSTATE and leaves the session usable', async () => {
    const q = await login()
    const refused = await q.query('SELECT * FROM no_such_table').catch((e) => e)
    expect(refused).toBeInstanceOf(PgError)
    expect(refused.code).toBe('42P01')
    expect((await q.query('SELECT 2 AS n')).rows).toEqual([{ n: 2 }])
    q.close()
  })

  test('runs one statement only, like the SQL page promises', async () => {
    const q = await login()
    const refused = await q.query('SELECT 1; SELECT 2').catch((e) => e)
    expect(refused.code).toBe('42601')
    q.close()
  })

  test('statements queue in order', async () => {
    const q = await login()
    const results = await Promise.all([1, 2, 3].map((n) => q.query('SELECT $1::int AS n', [n])))
    expect(results.map((r) => r.rows[0]?.n)).toEqual([1, 2, 3])
    q.close()
  })

  test('a token for someone else is refused by PostgreSQL', async () => {
    const error = await login(issuer.mint('stranger@example.com')).catch((e) => e)
    expect(error).toBeInstanceOf(PgError)
    expect(error.code).toBe('28000')
  })

  test('a token from a key the issuer never published is refused', async () => {
    const error = await login(issuer.mint(person, {}, issuer.strangerKey())).catch((e) => e)
    expect(error).toBeInstanceOf(PgError)
  })

  test('parameters travel as text and arrays as literals', () => {
    expect(serialize(['a', 'b"c', null])).toBe('{"a","b\\"c",NULL}')
    expect(serialize({ a: 1 })).toBe('{"a":1}')
    expect(serialize(false)).toBe('false')
    expect(parseArray('{a,"b c",NULL}')).toEqual(['a', 'b c', null])
    expect(parseArray('{}')).toEqual([])
  })
})

describe('through the relay', () => {
  // A stock WebSocket-to-TCP relay in front of the test server: docs/operations.md.
  const relay = process.env.TEST_RELAY_URL ?? 'ws://127.0.0.1:54331'
  test('the browser transport logs in and runs a statement', async () => {
    const { openSocket } = await import('../packages/ui/src/pg/socket.ts')
    const q = await Connection.open(await openSocket(relay), {
      user: person,
      database,
      token: issuer.mint(person),
    })
    const big = 'x'.repeat(200000)
    const result = await q.query('SELECT session_user AS who, length($1::text) AS n', [big])
    expect(result.rows[0]).toEqual({ who: person, n: 200000 })
    q.close()
  })
})
