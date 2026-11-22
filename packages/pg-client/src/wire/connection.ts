import { ConnectionError } from './errors.ts'
import { PgError } from './errors.ts'
import { Reader, Writer } from './codec.ts'
import { queryMessages } from './query.ts'
import {
  authentication,
  commandComplete,
  dataRow,
  errorResponse,
  readyForQuery,
  rowDescription,
} from './messages.ts'
import type { LoginOptions, Pending, Result, Session, Transport } from './types.ts'

/**
 * One logged-in session. Statements run one after another, in the order they were asked
 * for; a refused statement rejects its own promise and leaves the session usable.
 */
export class Connection implements Session {
  private buffer = new Uint8Array(0)
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
    const message = new Writer().int32(196608)
    const params: Record<string, string> = {
      user: this.options.user,
      database: this.options.database,
      application_name: this.options.applicationName ?? 'platform-ui',
      client_encoding: 'UTF8',
      DateStyle: 'ISO, MDY',
      ...this.options.settings,
    }
    for (const [key, value] of Object.entries(params)) message.cstring(key).cstring(value)
    message.bytes(new Uint8Array(1))
    this.transport.send(message.frame())
  }

  private receive(chunk: Uint8Array) {
    const joined = new Uint8Array(this.buffer.length + chunk.length)
    joined.set(this.buffer)
    joined.set(chunk, this.buffer.length)
    this.buffer = joined
    let at = 0
    while (this.buffer.length - at >= 5) {
      const type = String.fromCharCode(this.buffer[at]!)
      const length = new DataView(this.buffer.buffer, this.buffer.byteOffset + at + 1, 4).getInt32(
        0
      )
      if (this.buffer.length - at < length + 1) break
      const body = this.buffer.subarray(at + 5, at + 1 + length)
      at += length + 1
      try {
        this.message(type, new Reader(body))
      } catch (error) {
        this.end(error instanceof Error ? error : new Error(String(error)))
        return
      }
    }
    this.buffer = this.buffer.slice(at)
  }

  private message(type: string, body: Reader) {
    switch (type) {
      case 'R':
        return authentication(this, body)
      case 'S':
        this.parameters.set(body.cstring(), body.cstring())
        return
      case 'K':
      case '1':
      case '2':
      case '3':
      case 'n':
      case 't':
      case 's':
      case 'A':
        return
      case 'N':
        return
      case 'Z':
        return readyForQuery(this)
      case 'E':
        return errorResponse(this, new PgError(fields(body)))
      case 'T':
        return rowDescription(this, body)
      case 'D':
        return dataRow(this, body)
      case 'C':
        return commandComplete(this, body.cstring())
      case 'I':
        return
      default:
        throw new ConnectionError(`Unexpected message from the server: ${type}`)
    }
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
      this.transport.send(new Writer().frame('X'))
    } catch {
      // The stream is already gone.
    }
    this.end(new ConnectionError('The connection is closed'))
  }
}

function fields(body: Reader): Map<string, string> {
  const out = new Map<string, string>()
  while (!body.done) {
    const code = body.byte()
    if (!code) break
    out.set(String.fromCharCode(code), body.cstring())
  }
  return out
}
