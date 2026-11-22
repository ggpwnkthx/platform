import { serialize as protocol } from 'pg-protocol'
import { Parser } from 'pg-protocol/dist/parser'
import { ConnectionError } from './errors.ts'
import { queryMessages } from './query.ts'
import { handle } from './messages.ts'
import type { LoginOptions, Pending, Result, Session, Transport } from './types.ts'

/**
 * One logged-in session. Statements run one after another, in the order they were asked
 * for; a refused statement rejects its own promise and leaves the session usable.
 *
 * The messages are the protocol's own: `pg-protocol` writes them and reads them, and this
 * session decides what they mean — what a statement is answered with, and what a refusal is.
 */
export class Connection implements Session {
  private readonly parser = new Parser()
  readonly queue: Pending[] = []
  private chain: Promise<unknown> = Promise.resolve()
  closed: Error | null = null
  /** The settings the server reported at login: server_version, TimeZone … */
  readonly parameters = new Map<string, string>()
  ready: (() => void) | null = null
  failed: ((error: Error) => void) | null = null
  private login: Promise<void>

  private constructor(
    readonly transport: Transport,
    readonly options: LoginOptions
  ) {
    this.login = new Promise<void>((resolve, reject) => {
      this.ready = resolve
      this.failed = reject
    })
    transport.ondata = (bytes) => this.receive(bytes)
    transport.onclose = (reason) => this.end(reason)
  }

  /** Whether the session is over: the stream ended, or the session was closed. */
  // fallow-ignore-next-line unused-class-member -- the Login interface says it, and what holds one reads it
  get isClosed(): boolean {
    return this.closed !== null
  }

  /** Opens a session on a transport that is already connected, and logs in. */
  static async open(transport: Transport, options: LoginOptions): Promise<Connection> {
    const connection = new Connection(transport, options)
    connection.startup()
    await connection.login
    return connection
  }

  private startup() {
    const message = protocol.startup({
      user: this.options.user,
      database: this.options.database,
      application_name: this.options.applicationName ?? 'platform-ui',
      DateStyle: 'ISO, MDY',
      ...this.options.settings,
    })
    this.transport.send(message)
  }

  private receive(chunk: Uint8Array) {
    // The parser keeps what it cannot read yet, and reads the rest as it comes.
    this.parser.parse(
      Buffer.from(chunk.buffer as ArrayBuffer, chunk.byteOffset, chunk.length),
      (message) => {
        try {
          handle(this, message)
        } catch (error) {
          this.end(error instanceof Error ? error : new Error(String(error)))
        }
      }
    )
  }

  end(reason: Error | null) {
    if (this.closed) return
    this.closed =
      reason ?? new ConnectionError('The connection to PostgreSQL closed before it answered')
    if (this.failed) this.failed(this.closed)
    for (const pending of this.queue.splice(0)) pending.reject(this.closed)
    try {
      this.transport.close()
    } catch {
      // Already closed.
    }
  }

  /**
   * Runs one statement with bound parameters. The statement is never interpolated: every
   * value travels separately, so a value can never change what the statement does.
   */
  query<Row = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<Result<Row>> {
    const run = () =>
      new Promise<Result>((resolve, reject) => {
        if (this.closed) return reject(this.closed)
        const pending: Pending = {
          resolve,
          reject,
          fields: [],
          rows: [],
          command: '',
          affected: null,
          error: null,
        }
        let out: Uint8Array
        try {
          out = queryMessages(text, params)
        } catch (error) {
          return reject(error)
        }
        this.queue.push(pending)
        this.transport.send(out)
      })
    const result = this.chain.then(run, run)
    this.chain = result.catch(() => undefined)
    return result as Promise<Result<Row>>
  }

  /** Ends the session politely: Terminate, then the stream closes. */
  close() {
    if (this.closed) return
    try {
      this.transport.send(protocol.end())
    } catch {
      // The stream is already gone.
    }
    this.end(new ConnectionError('The connection is closed'))
  }
}
