import pg from 'pg'
import type { Config } from './config.ts'

pg.types.setTypeParser(1082, (v) => v)
pg.types.setTypeParser(1114, (v) => v)
/** Input the command refuses before PostgreSQL sees it: a malformed token, name or value. */
export class InputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InputError'
  }
}
/** Who a request says it is, and the token PostgreSQL will check that claim against. */
export type Login = { username: string; token: string }
/**
 * Reads the role a bearer token names. Nothing is verified here, on purpose: PostgreSQL
 * verifies the signature, issuer and expiry, and that the claim equals the role it is asked to
 * log in. This only finds the name to ask for.
 */
export function bearer(header: string | undefined, claim: string): Login {
  if (!header?.startsWith('Bearer ')) throw new InputError('Sign-in token required')
  const token = header.slice(7)
  const parts = token.split('.')
  if (token.length > 16384 || parts.length !== 3 || !parts.every((p) => /^[A-Za-z0-9_-]+$/.test(p)))
    throw new InputError('Invalid token')
  let payload: unknown
  try {
    payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'))
  } catch {
    throw new InputError('Invalid token')
  }
  const username = (payload as Record<string, unknown> | null)?.[claim]
  if (
    typeof username !== 'string' ||
    !username ||
    username.includes('\0') ||
    Buffer.byteLength(username) > 63
  )
    throw new InputError(`Token names no PostgreSQL role in its ${claim} claim`)
  return { username, token }
}
type Wire = {
  sendSASLInitialResponseMessage(mechanism: string, response: string): void
  sendSCRAMClientFinalMessage(data: string): void
  emit(event: 'error', error: Error): boolean
}
const kvsep = '\x01'
/**
 * A connection that logs in with a bearer token: PostgreSQL 18's OAUTHBEARER (RFC 7628).
 * node-postgres speaks only SCRAM, so this replaces its two SASL steps. It never sends a
 * password, and refuses a server that asks for one.
 */
export class TokenClient extends pg.Client {
  readonly #token: string
  constructor(config: pg.ClientConfig, token: string) {
    super({ ...config, password: undefined })
    this.#token = token
  }
  get #wire() {
    return (this as unknown as { connection: Wire }).connection
  }
  _handleAuthSASL(msg: { mechanisms: string[] }) {
    if (msg.mechanisms.includes('OAUTHBEARER'))
      return this.#wire.sendSASLInitialResponseMessage(
        'OAUTHBEARER',
        `n,,${kvsep}auth=Bearer ${this.#token}${kvsep}${kvsep}`
      )
    this.#wire.emit(
      'error',
      Object.assign(new Error('PostgreSQL does not accept a token for this login'), {
        code: '28000',
      })
    )
    // Not left half-open: a backend waiting for an answer holds up the server's own work.
    void this.end().catch(() => undefined)
  }
  /** A refused token is described first; acknowledging it lets the server send its error. */
  _handleAuthSASLContinue() {
    this.#wire.sendSCRAMClientFinalMessage(kvsep)
  }
}
// The two methods above override node-postgres internals. Fail loudly if an upgrade moves them.
for (const hook of ['_handleAuthSASL', '_handleAuthSASLContinue'])
  if (typeof (pg.Client.prototype as unknown as Record<string, unknown>)[hook] !== 'function')
    throw new Error(`node-postgres no longer has ${hook}: token logins need porting`)
export function clientConfig(
  config: Config,
  who: { username: string; password?: string }
): pg.ClientConfig {
  return {
    host: config.databaseHost,
    port: config.databasePort,
    database: config.databaseName,
    user: who.username,
    password: who.password,
    ssl:
      config.databaseSsl === 'require'
        ? { rejectUnauthorized: true, ca: config.databaseCa }
        : false,
    application_name: 'platform-cli',
    connectionTimeoutMillis: 5000,
    statement_timeout: config.statementTimeoutMs,
    idle_in_transaction_session_timeout: 15000,
  }
}
export async function transaction<T>(q: pg.Client, fn: () => Promise<T>): Promise<T> {
  await q.query('BEGIN')
  try {
    const result = await fn()
    await q.query('COMMIT')
    return result
  } catch (error) {
    await q.query('ROLLBACK').catch(() => undefined)
    throw error
  }
}
/** Identifiers may be quoted PostgreSQL names; values are always bound separately. */
export function ident(name: string): string {
  if (!name || name.includes('\0') || Buffer.byteLength(name) > 63)
    throw new InputError('Invalid PostgreSQL identifier')
  return `"${name.replaceAll('"', '""')}"`
}
export const qualified = (schema: string, table: string) => `${ident(schema)}.${ident(table)}`
export function literal(value: unknown): string {
  if (value === null) return 'NULL'
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  const s = typeof value === 'object' ? JSON.stringify(value) : String(value)
  if (s.includes('\0')) throw new InputError('Invalid literal')
  return `E'${s.replaceAll('\\', '\\\\').replaceAll("'", "''")}'`
}
