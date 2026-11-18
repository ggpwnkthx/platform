import { openSocket } from '../pg/socket.ts'
import { Connection, type Result } from '../pg/wire.ts'
import type { RuntimeConfig } from '../config.ts'

/** A logged-in session with PostgreSQL. */
export interface Db {
  query<Row = Record<string, unknown>>(text: string, params?: unknown[]): Promise<Result<Row>>
  close(): void
}

/** Who is signed in: the role PostgreSQL will log in, and the token that proves it. */
export interface Credentials {
  role: string
  token: string
}

/**
 * The seam between the interface and the database. The real build opens a WebSocket to the
 * relay and logs in with the reader's token. The development build replaces this module with
 * a PostgreSQL that runs inside the page, so the interface can be built without a server.
 */
export const inPageDatabase = false

export async function connect(config: RuntimeConfig, who: Credentials): Promise<Db> {
  const transport = await openSocket(config.relay)
  return Connection.open(transport, {
    user: who.role,
    database: config.database,
    token: who.token,
    applicationName: 'platform-ui',
    settings: {
      statement_timeout: String(config.statementTimeoutMs),
      idle_in_transaction_session_timeout: '15000',
    },
  })
}
