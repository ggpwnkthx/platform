import { Connection, openSocket, type Login, type Result } from '@platform/pg'
import type { DataSource } from '@platform/sql'
import type { RuntimeConfig } from '../config.ts'

/**
 * A logged-in session with PostgreSQL.
 *
 * A session is a source of statements: it runs them and hands back what PostgreSQL
 * answered. The questions the platform asks are asked of any source, so the same question
 * may be asked here and of a client in Node, and mean the same thing.
 */
export interface Db extends Login, DataSource {
  query<Row = Record<string, unknown>>(text: string, params?: unknown[]): Promise<Result<Row>>
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
 *
 * Everything the interface reads and writes runs through here, as the statements PostgreSQL
 * runs. Each one runs on the reader's own login, so nothing here decides a right: the catalog
 * questions ask PostgreSQL's privilege functions, and every write is judged by PostgreSQL when
 * it runs.
 */

/** A person who may sign in without an issuer. */
export interface Person {
  /** The role PostgreSQL logs them in as. */
  role: string
  /** What the reader is told about them. */
  note: string
  /** The token that proves who they are. */
  token: string
}

/** How a build lets a reader in when there is no issuer to ask. */
export interface WithoutIssuer {
  /** The people who may sign in. Empty when there is an issuer. */
  people: Person[]
  /** What the reader is told about signing in this way. */
  notice: string
  /** What is said while the database starts. */
  starting: string
  /** The person chosen for this page, if any. */
  chosen(): string | null
  /** Keeps the choice, so that the next page is the same person. */
  choose(role: string): void
  /** Forgets the choice. */
  forget(): void
}

/**
 * Signing in without an issuer. A production interface has an issuer, so there is nobody to
 * choose and nothing to remember: the list is empty and the choice is kept nowhere. The
 * development build replaces this module with one that has the example people, so that the
 * interface asks who they are instead of knowing.
 */
export const withoutIssuer: WithoutIssuer = {
  people: [],
  notice: '',
  starting: '',
  chosen: () => null,
  choose: () => {},
  forget: () => {},
}

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
