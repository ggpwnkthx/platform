import type { Db, Result } from './db.ts'

/**
 * Token logins for node-postgres and the drivers built on it (`pg` in the CLI, Neon's
 * serverless driver over a WebSocket in the page). Neither speaks OAUTHBEARER (RFC 7628) yet,
 * so the two SASL steps are answered here: the token goes to PostgreSQL 18, which checks it
 * and logs its holder in as their own role. There is no password and no other mechanism.
 */
const kvsep = '\x01'
// biome-ignore lint/suspicious/noExplicitAny: a mixin over either driver's Client
type AnyClient = new (...args: any[]) => any

/** The driver's Client, signing in with `config.token`. A pool takes it as its `Client`. */
export function withToken<C extends AnyClient>(Base: C): C {
  for (const hook of ['_handleAuthSASL', '_handleAuthSASLContinue'])
    if (typeof Base.prototype[hook] !== 'function')
      throw new Error(`The PostgreSQL driver no longer has ${hook}: token logins need porting`)
  return class TokenClient extends Base {
    readonly #token: string
    // biome-ignore lint/suspicious/noExplicitAny: the driver's own configuration, and a token
    constructor(...args: any[]) {
      super({ ...args[0], password: undefined })
      this.#token = String(args[0]?.token ?? '')
    }
    _handleAuthSASL(msg: { mechanisms: string[] }) {
      if (msg.mechanisms.includes('OAUTHBEARER'))
        return this.connection.sendSASLInitialResponseMessage(
          'OAUTHBEARER',
          `n,,${kvsep}auth=Bearer ${this.#token}${kvsep}${kvsep}`
        )
      this.emit(
        'error',
        Object.assign(new Error('PostgreSQL does not accept a sign-in token for this role'), {
          code: '28000',
        })
      )
    }
    // The server's only possible continuation is a failure report; the client acknowledges it.
    _handleAuthSASLContinue() {
      this.connection.sendSCRAMClientFinalMessage(kvsep)
    }
  }
}

/** Dates and times stay as PostgreSQL wrote them; a bigint is a number while it safely can be. */
const asWritten = new Set([1082, 1083, 1114, 1184, 1266, 1700, 1115, 1182, 1185, 1231])
export const typeParsers = (types: { getTypeParser(oid: number, format?: string): unknown }) => ({
  getTypeParser(oid: number, format?: string) {
    if (asWritten.has(oid)) return (value: string) => value
    if (oid === 20)
      return (value: string) => (Number.isSafeInteger(Number(value)) ? Number(value) : value)
    return types.getTypeParser(oid, format)
  },
})

type Callback = (error: Error | null, result: unknown) => void
type PgClient = { query(query: object | string, callback?: Callback): unknown }
type QueryClass = new (config: {
  text: string
  values: unknown[]
}) => { requiresPreparation(): boolean }
/**
 * A node-postgres client as the platform's `Db`: one statement per query, always. A query
 * with no parameters would otherwise go through the simple protocol, which runs every
 * statement in the text; the driver's own Query is told to prepare it like any other.
 */
export function fromPg(client: PgClient): Db {
  const Query = (client.constructor as unknown as { Query: QueryClass }).Query
  return {
    query: <Row>(text: string, params: unknown[] = []) =>
      new Promise<Result<Row>>((resolve, reject) => {
        const query = new Query({ text, values: params })
        query.requiresPreparation = () => true
        client.query(query, (error, result) =>
          error ? reject(error) : resolve(result as Result<Row>)
        )
      }),
    exec: async (text) => client.query(text),
  }
}
