/**
 * The PostgreSQL frontend/backend protocol, version 3, spoken from the page itself.
 *
 * There is no server of ours between the reader and the database. The page opens a byte
 * stream to PostgreSQL (in a browser, a WebSocket to a relay that forwards bytes to the
 * server's port and understands none of them), logs in with the reader's own token through
 * OAUTHBEARER (RFC 7628), and runs parameterized statements with the extended query protocol.
 * PostgreSQL checks the token, names the role and decides every statement.
 *
 * The extended protocol accepts exactly one statement per query, which is the contract the
 * SQL page keeps: one statement, run as you.
 */

/** A duplex byte stream to the server: a WebSocket in the browser, a socket in a test. */
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

/** What PostgreSQL said when it refused. The fields are the ErrorResponse's own. */
export class PgError extends Error {
  readonly code: string
  readonly severity: string
  readonly detail?: string
  readonly hint?: string
  readonly position?: number
  readonly schema?: string
  readonly table?: string
  readonly column?: string
  readonly constraint?: string
  constructor(fields: Map<string, string>) {
    super(fields.get('M') ?? 'PostgreSQL refused the request')
    this.name = 'PgError'
    this.code = fields.get('C') ?? ''
    this.severity = fields.get('V') ?? fields.get('S') ?? 'ERROR'
    this.detail = fields.get('D')
    this.hint = fields.get('H')
    const position = fields.get('P')
    this.position = position ? Number(position) : undefined
    this.schema = fields.get('s')
    this.table = fields.get('t')
    this.column = fields.get('c')
    this.constraint = fields.get('n')
  }
}

/** The stream failed before PostgreSQL could answer: the relay or the server is unreachable. */
export class ConnectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConnectionError'
  }
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const kvsep = '\x01'

/** Builds one message: a type byte, then a length that counts itself and the body. */
class Writer {
  private parts: Uint8Array[] = []
  private size = 0
  private push(bytes: Uint8Array) {
    this.parts.push(bytes)
    this.size += bytes.length
  }
  int32(value: number) {
    const bytes = new Uint8Array(4)
    new DataView(bytes.buffer).setInt32(0, value)
    this.push(bytes)
    return this
  }
  int16(value: number) {
    const bytes = new Uint8Array(2)
    new DataView(bytes.buffer).setInt16(0, value)
    this.push(bytes)
    return this
  }
  /** A NUL-terminated string. A NUL inside it would end it early, so it is refused. */
  cstring(value: string) {
    if (value.includes('\0')) throw new TypeError('A protocol string cannot contain NUL')
    this.push(encoder.encode(value))
    this.push(new Uint8Array(1))
    return this
  }
  bytes(value: Uint8Array) {
    this.push(value)
    return this
  }
  /** The message, framed. With no type it is the startup message, which has none. */
  frame(type?: string): Uint8Array {
    const header = type ? 5 : 4
    const out = new Uint8Array(header + this.size)
    const view = new DataView(out.buffer)
    if (type) out[0] = type.charCodeAt(0)
    view.setInt32(type ? 1 : 0, this.size + 4)
    let at = header
    for (const part of this.parts) {
      out.set(part, at)
      at += part.length
    }
    return out
  }
}

/** Reads the body of one message. */
class Reader {
  private at = 0
  private view: DataView
  constructor(private bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }
  int32() {
    const value = this.view.getInt32(this.at)
    this.at += 4
    return value
  }
  int16() {
    const value = this.view.getInt16(this.at)
    this.at += 2
    return value
  }
  byte() {
    return this.bytes[this.at++] ?? 0
  }
  cstring() {
    const end = this.bytes.indexOf(0, this.at)
    const value = decoder.decode(this.bytes.subarray(this.at, end))
    this.at = end + 1
    return value
  }
  take(length: number) {
    const value = this.bytes.subarray(this.at, this.at + length)
    this.at += length
    return value
  }
  get done() {
    return this.at >= this.bytes.length
  }
}

/** A value bound to a parameter, in text form; null is SQL NULL. */
export function serialize(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return arrayLiteral(value)
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/** A one-dimensional PostgreSQL array literal, every element quoted. */
function arrayLiteral(values: unknown[]): string {
  const items = values.map((value) => {
    const text = serialize(value)
    if (text === null) return 'NULL'
    return `"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
  })
  return `{${items.join(',')}}`
}

/** Parses a one-dimensional array in text form into strings and nulls. */
export function parseArray(text: string): (string | null)[] {
  if (text.length < 2 || text[0] !== '{') return [text]
  const out: (string | null)[] = []
  let i = 1
  while (i < text.length - 1) {
    if (text[i] === ',') {
      i++
      continue
    }
    if (text[i] === '"') {
      let value = ''
      i++
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\') i++
        value += text[i]
        i++
      }
      i++
      out.push(value)
    } else {
      let end = text.indexOf(',', i)
      if (end === -1) end = text.length - 1
      const value = text.slice(i, end)
      out.push(value === 'NULL' ? null : value)
      i = end
    }
  }
  return out
}

const arrayElement: Record<number, number> = {
  1000: 16, // bool[]
  1005: 21, // int2[]
  1007: 23, // int4[]
  1016: 20, // int8[]
  1021: 700, // float4[]
  1022: 701, // float8[]
  1028: 26, // oid[]
  1003: 19, // name[]
  1009: 25, // text[]
  1015: 1043, // varchar[]
  1231: 1700, // numeric[]
  2951: 2950, // uuid[]
}

/**
 * A value in text form, read as the type it is. Integers that fit a JavaScript number become
 * numbers; numeric, dates and times stay as PostgreSQL wrote them, so nothing is rounded or
 * moved to another time zone on the way to the screen.
 */
export function parseValue(type: number, text: string): unknown {
  switch (type) {
    case 16:
      return text === 't'
    case 21:
    case 23:
    case 26:
      return Number(text)
    case 20: {
      const value = Number(text)
      return Number.isSafeInteger(value) ? value : text
    }
    case 700:
    case 701:
      return Number(text)
    case 114:
    case 3802:
      return JSON.parse(text)
  }
  const element = arrayElement[type]
  if (element !== undefined)
    return parseArray(text).map((item) => (item === null ? null : parseValue(element, item)))
  return text
}

interface Pending {
  resolve: (result: Result) => void
  reject: (error: Error) => void
  fields: Field[]
  rows: Record<string, unknown>[]
  command: string
  affected: number | null
  error: PgError | null
}

/**
 * One logged-in session. Statements run one after another, in the order they were asked
 * for; a refused statement rejects its own promise and leaves the session usable.
 */
export class Connection {
  private buffer = new Uint8Array(0)
  private queue: Pending[] = []
  private chain: Promise<unknown> = Promise.resolve()
  private closed: Error | null = null
  /** The settings the server reported at login: server_version, TimeZone … */
  readonly parameters = new Map<string, string>()
  private ready: (() => void) | null = null
  private failed: ((error: Error) => void) | null = null
  private login: Promise<void>

  private constructor(
    private transport: Transport,
    private options: LoginOptions
  ) {
    this.login = new Promise<void>((resolve, reject) => {
      this.ready = resolve
      this.failed = reject
    })
    transport.ondata = (bytes) => this.receive(bytes)
    transport.onclose = (reason) => this.end(reason)
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
        return this.authentication(body)
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
        return this.readyForQuery()
      case 'E':
        return this.errorResponse(new PgError(fields(body)))
      case 'T':
        return this.rowDescription(body)
      case 'D':
        return this.dataRow(body)
      case 'C':
        return this.commandComplete(body.cstring())
      case 'I':
        return
      default:
        throw new ConnectionError(`Unexpected message from the server: ${type}`)
    }
  }

  private authentication(body: Reader) {
    const code = body.int32()
    if (code === 0) return
    if (code === 10) {
      const mechanisms: string[] = []
      for (let name = body.cstring(); name; name = body.cstring()) mechanisms.push(name)
      if (!mechanisms.includes('OAUTHBEARER'))
        throw new ConnectionError('PostgreSQL does not accept a sign-in token for this role')
      const response = encoder.encode(
        `n,,${kvsep}auth=Bearer ${this.options.token}${kvsep}${kvsep}`
      )
      this.transport.send(
        new Writer().cstring('OAUTHBEARER').int32(response.length).bytes(response).frame('p')
      )
      return
    }
    if (code === 11) {
      // The server describes why it refused the token; acknowledging lets it send the error.
      this.transport.send(new Writer().bytes(encoder.encode(kvsep)).frame('p'))
      return
    }
    if (code === 12) return
    // A password, in any form, is never sent: the page holds none.
    throw new ConnectionError('PostgreSQL asked for a password. Only a sign-in token is sent.')
  }

  private readyForQuery() {
    if (this.closed) return
    if (this.ready) {
      const ready = this.ready
      this.ready = null
      this.failed = null
      ready()
      return
    }
    const pending = this.queue.shift()
    if (!pending) return
    if (pending.error) pending.reject(pending.error)
    else
      pending.resolve({
        fields: pending.fields,
        rows: pending.rows,
        command: pending.command,
        affected: pending.affected,
      })
  }

  private errorResponse(error: PgError) {
    const pending = this.queue[0]
    if (this.ready || !pending) {
      // An error during the login, or outside any statement: the server ends the session.
      this.end(error)
      return
    }
    pending.error = error
  }

  private rowDescription(body: Reader) {
    const pending = this.queue[0]
    if (!pending) return
    const count = body.int16()
    pending.fields = []
    for (let i = 0; i < count; i++) {
      const name = body.cstring()
      const table = body.int32()
      const column = body.int16()
      const type = body.int32()
      body.int16()
      body.int32()
      body.int16()
      pending.fields.push({ name, type, table, column })
    }
  }

  private dataRow(body: Reader) {
    const pending = this.queue[0]
    if (!pending) return
    const count = body.int16()
    const row: Record<string, unknown> = {}
    for (let i = 0; i < count; i++) {
      const length = body.int32()
      const field = pending.fields[i]
      const name = field?.name ?? `?column${i}?`
      row[name] =
        length === -1 ? null : parseValue(field?.type ?? 25, decoder.decode(body.take(length)))
    }
    pending.rows.push(row)
  }

  private commandComplete(tag: string) {
    const pending = this.queue[0]
    if (!pending) return
    const parts = tag.split(' ')
    const last = parts[parts.length - 1]
    const numeric = last !== undefined && /^\d+$/.test(last)
    pending.command = (numeric ? parts.slice(0, parts[0] === 'INSERT' ? -2 : -1) : parts).join(' ')
    pending.affected = numeric ? Number(last) : null
  }

  private end(reason: Error | null) {
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
        let messages: Uint8Array[]
        try {
          const bind = new Writer().cstring('').cstring('').int16(0).int16(params.length)
          for (const param of params) {
            const value = serialize(param)
            if (value === null) bind.int32(-1)
            else {
              const bytes = encoder.encode(value)
              bind.int32(bytes.length).bytes(bytes)
            }
          }
          bind.int16(0)
          messages = [
            new Writer().cstring('').cstring(text).int16(0).frame('P'),
            bind.frame('B'),
            new Writer().bytes(encoder.encode('P')).cstring('').frame('D'),
            new Writer().cstring('').int32(0).frame('E'),
            new Writer().frame('S'),
          ]
        } catch (error) {
          return reject(error)
        }
        this.queue.push(pending)
        const total = messages.reduce((sum, m) => sum + m.length, 0)
        const out = new Uint8Array(total)
        let at = 0
        for (const m of messages) {
          out.set(m, at)
          at += m.length
        }
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
