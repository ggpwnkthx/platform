/**
 * The wire the platform speaks to PostgreSQL: the messages, and what they carry.
 */
import type { PgError } from './errors.ts'

export interface Transport {
  send(bytes: Uint8Array): void
  close(): void
  /** Called with each chunk the server sends; a chunk may hold part of a message or many. */
  ondata: ((bytes: Uint8Array) => void) | null
  /** Called once, when the stream ends for any reason. */
  onclose: ((reason: Error | null) => void) | null
}

export interface LoginOptions {
  /** The PostgreSQL role to log in as: the role the token names. */
  user: string
  database: string
  /** The bearer token PostgreSQL validates during the login. */
  token: string
  applicationName?: string
  /** Server settings sent with the startup message: statement_timeout and the like. */
  settings?: Record<string, string>
}

/** One column of a result, as RowDescription names it. */
export interface Field {
  name: string
  /** The type's OID. */
  type: number
  /** The table the column comes from, or 0. */
  table: number
  /** Its attribute number in that table, or 0. */
  column: number
}

export interface Result<Row = Record<string, unknown>> {
  fields: Field[]
  rows: Row[]
  /** The command tag's verb: SELECT, INSERT, GRANT, CREATE TABLE … */
  command: string
  /** The row count the command tag reports, when it reports one. */
  affected: number | null
}

/**
 * A login to PostgreSQL: it runs statements, and it may be closed.
 *
 * A login is what a client holds while it works: the page keeps a few of them open, and a
 * script opens one, runs what it has to say and closes it again. What a login answers is
 * PostgreSQL's own.
 */
export interface Login {
  query<Row = Record<string, unknown>>(text: string, params?: unknown[]): Promise<Result<Row>>
  close(): void
  /** Whether the login is over: the stream ended, or the login was closed. */
  readonly isClosed: boolean
}

/** A statement that is running, and what the server will say about it. */
export interface Pending {
  resolve: (result: Result) => void
  reject: (error: Error) => void
  fields: Field[]
  rows: Record<string, unknown>[]
  command: string
  affected: number | null
  error: PgError | null
}

/** What the handlers of the server's messages work on: one session. */
export interface Session {
  readonly transport: Transport
  readonly options: LoginOptions
  /** The settings the server reported at login: server_version, TimeZone … */
  readonly parameters: Map<string, string>
  /** The statements that are running, in the order they were asked for. */
  readonly queue: Pending[]
  /** The error the session ended with, when it has ended. */
  closed: Error | null
  /** What is told that the login is ready, and what is told that it failed. */
  ready: (() => void) | null
  failed: ((error: Error) => void) | null
  /** Ends the session: the stream is closed and everything waiting is refused. */
  end(reason: Error | null): void
}
