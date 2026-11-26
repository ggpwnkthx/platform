import { Client, neonConfig, Pool, types } from '@neondatabase/serverless'
import { broken, type Db, transaction } from '@platform/core'
import { fromPg, typeParsers, withToken } from '@platform/core/token-client'

export interface Login {
  relay: string
  database: string
  role: string
  token: string
  statementTimeoutMs?: number
}
/** The reader's sign-in, as the pages use it. */
export interface Session extends Db {
  /** Work that must not interleave with anything else: a transaction. */
  exclusive<T>(work: (db: Db) => Promise<T>): Promise<T>
  /**
   * The reader's own statements, on a login of their own that is closed afterwards: in one
   * transaction where `atomic`, and rolled back at the end where `undo` (EXPLAIN ANALYZE).
   */
  own<T>(work: (db: Db) => Promise<T>, how?: Own): Promise<T>
  close(): Promise<void>
}

export interface Own {
  atomic?: boolean
  undo?: boolean
}
const TokenClient = withToken(Client)

/**
 * PostgreSQL logins for the reader, from the page: node-postgres's protocol (Neon's
 * serverless build of it) over a WebSocket to the relay, signed in with the reader's own
 * token. TLS is the WebSocket's (`wss:`), so none is negotiated inside it.
 */
function settings(login: Login) {
  const url = new URL(login.relay)
  neonConfig.wsProxy = () => `${url.host}${url.pathname}${url.search}`
  neonConfig.useSecureWebSocket = url.protocol === 'wss:'
  neonConfig.forceDisablePgSSL = true
  // Nothing is sent ahead of PostgreSQL's own question: there is no password to pipeline.
  neonConfig.pipelineConnect = false
  return {
    host: url.hostname,
    user: login.role,
    database: login.database,
    token: login.token,
    ssl: false,
    application_name: 'platform-ui',
    statement_timeout: login.statementTimeoutMs ?? 15000,
    idle_in_transaction_session_timeout: 15000,
    connectionTimeoutMillis: 10000,
    types: typeParsers(types),
  }
}

/** One login, for as long as the caller keeps it. */
export async function connect(login: Login): Promise<Db & { close(): void }> {
  const client = new TokenClient(settings(login))
  // A login the server closes later must not be an unhandled error: the next query says so.
  client.on('error', () => undefined)
  await client.connect()
  return { ...fromPg(client), close: () => void client.end().catch(() => undefined) }
}

/**
 * The logins a sign-in keeps: opened when they are needed, a second one when two things
 * happen at once, thrown away when the server closes them or a session is left in limbo.
 */
export function openSession(login: Login): Session {
  const pool = new Pool({ ...settings(login), max: 2, idleTimeoutMillis: 60000 })
  pool.Client = TokenClient
  pool.on('error', () => undefined)
  const withClient = async <T>(work: (db: Db) => Promise<T>): Promise<T> => {
    const client = await pool.connect()
    let spoiled = false
    try {
      return await work(fromPg(client))
    } catch (error) {
      spoiled = broken(error)
      throw error
    } finally {
      client.release(spoiled)
    }
  }
  return {
    query: (text, params) => withClient((db) => db.query(text, params)),
    exclusive: withClient,
    async own(work, how = {}) {
      const db = await connect(login)
      try {
        return how.atomic || how.undo
          ? await transaction(db, () => work(db), how.undo)
          : await work(db)
      } finally {
        db.close()
      }
    },
    close: () => pool.end().catch(() => undefined),
  }
}
