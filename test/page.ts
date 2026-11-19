import { connect as tcp } from 'node:net'
import { Connection, PgError, type Transport } from '../packages/pg-client/src/wire.ts'

/**
 * The page's own PostgreSQL client in a test: the same login and the same statements a
 * browser makes through the relay, over a plain socket to the server's port.
 */
export function socket(host: string, port: number): Promise<Transport> {
  return new Promise((resolve, reject) => {
    const s = tcp({ host, port })
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

/** Opens a session on the server at this URL, as the role the token names. */
export async function openPage(server: URL, user: string, database: string, token: string) {
  const port = Number(server.port || 5432)
  return Connection.open(await socket(server.hostname, port), { user, database, token })
}

/** The SQLSTATE a refused statement or login carries; fails the test if it was not refused. */
export async function refusal(work: Promise<unknown>): Promise<string> {
  try {
    await work
  } catch (error) {
    if (error instanceof PgError) return error.code
    throw error
  }
  throw new Error('Expected PostgreSQL to refuse')
}
