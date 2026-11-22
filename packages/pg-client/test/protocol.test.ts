import { describe, expect, test } from 'bun:test'
import { Connection, type PgError } from '../src/wire.ts'
import { startServer, transport } from './server.ts'

/**
 * The client and PostgreSQL's own protocol, checked against a server that speaks it.
 */
describe('the client and the protocol', () => {
  test('a session logs in and answers a statement', async () => {
    const server = startServer({
      columns: [
        { name: 'id', type: 23 },
        { name: 'name', type: 25 },
      ],
      rows: [
        [1, 'alice'],
        [2, null],
      ],
    })
    const db = await Connection.open(await transport(server.port), {
      user: 'alice',
      database: 'platform',
      token: 'a-token',
    })
    const result = await db.query('SELECT id, name FROM people WHERE id = $1', [1])
    expect(result.rows).toEqual([
      { id: 1, name: 'alice' },
      { id: 2, name: null },
    ])
    expect(result.command).toBe('SELECT')
    expect(result.fields.map((field) => field.name)).toEqual(['id', 'name'])
    // The statement is parsed, bound, described, run and closed, in that order.
    expect(server.sent).toEqual(['P', 'B', 'D', 'E', 'S'])
    // The value travels beside the statement, never inside it.
    expect(server.startup().user).toBe('alice')
    db.close()
    server.stop()
  })

  test('a sign-in is offered as the token it is', async () => {
    const server = startServer({ token: true })
    const db = await Connection.open(await transport(server.port), {
      user: 'alice',
      database: 'platform',
      token: 'a-token',
    })
    expect(server.offered()).toContain('auth=Bearer a-token')
    db.close()
    server.stop()
  })

  test('a refused statement is refused with what the server said', async () => {
    const server = startServer({ error: { code: '42501', message: 'permission denied' } })
    const db = await Connection.open(await transport(server.port), {
      user: 'alice',
      database: 'platform',
      token: 'a-token',
    })
    await expect(db.query('SELECT 1')).rejects.toThrow('permission denied')
    await db.query('SELECT 1').catch((error: PgError) => {
      expect(error.code).toBe('42501')
      expect(error.severity).toBe('ERROR')
    })
    db.close()
    server.stop()
  })
})
