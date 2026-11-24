/** Public package/database version. Keep aligned with package.json and the installation SQL. */
export const VERSION = '3.0.0'

export interface Field {
  name: string
  dataTypeID: number
}
/** What PostgreSQL said beside a statement that it ran: a WARNING, a NOTICE, an INFO. */
export interface Notice {
  severity?: string
  message?: string
  code?: string
}
export interface Result<Row = Record<string, unknown>> {
  rows: Row[]
  fields: Field[]
  command: string
  rowCount: number | null
  /** What PostgreSQL said while the statement ran. */
  notices?: Notice[]
}
/**
 * A GRANT or REVOKE that changed nothing — the caller holds no GRANT OPTION, or another role
 * made the grant — is only warned of (01007, 01006). The warning is PostgreSQL's answer that
 * the change was not made, so it is raised as the refusal it is.
 */
export function unchanged(result: Result): void {
  const warned = result.notices?.find((n) => /^0100[67]$/.test(n.code ?? ''))
  if (warned) throw Object.assign(new Error(warned.message), { code: warned.code })
}

/**
 * The one seam to PostgreSQL. `query` runs exactly one statement with bound parameters (the
 * extended protocol, so a second statement smuggled into the text is refused by the server);
 * `exec` runs a script. Drivers are adapted to it in `token-client.ts` and `pglite.ts`.
 */
export interface Db {
  query<Row = Record<string, unknown>>(text: string, params?: unknown[]): Promise<Result<Row>>
  exec?(script: string): Promise<unknown>
}

/**
 * The connections that are inside a transaction of the platform's own making. A statement
 * that writes more than one row needs one: without it, the read and the write that follow
 * each other are two transactions, and another writer may come between them.
 */
const inside = new WeakSet<object>()

/** Whether this connection is inside a transaction: the one `transaction()` opens. */
export const inTransaction = (db: Db): boolean => inside.has(db as object)

export async function transaction<T>(db: Db, work: () => Promise<T>, dryRun = false): Promise<T> {
  await db.query('BEGIN')
  inside.add(db as object)
  try {
    const result = await work()
    await db.query(dryRun ? 'ROLLBACK' : 'COMMIT')
    return result
  } catch (error) {
    await db.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    inside.delete(db as object)
  }
}

/** A script goes through `exec` where the driver has one. */
export const script = (db: Db, text: string) => (db.exec ? db.exec(text) : db.query(text))

type PgError = Error & { code?: string; detail?: string; hint?: string }
export const sqlState = (error: unknown): string | undefined =>
  typeof (error as PgError)?.code === 'string' ? (error as PgError).code : undefined

/** An error as the interface and the CLI say it: PostgreSQL's message with its SQLSTATE. */
export function describe(error: unknown): { title: string; detail?: string } {
  const e = error as PgError
  const code = sqlState(error)
  if (code && /^[0-9A-Z]{5}$/.test(code)) {
    const detail = [e.detail, e.hint && `Hint: ${e.hint}`].filter(Boolean).join(' ')
    return { title: `${e.message} (${code})`, detail: detail || undefined }
  }
  return { title: error instanceof Error ? error.message : String(error) }
}

/** A session that cannot be used again: the login was refused, lost, or left in limbo. */
export function broken(error: unknown): boolean {
  const code = sqlState(error)
  if (!code) return /connection|socket|closed|terminated/i.test(String((error as Error)?.message))
  return /^(25P02|25001|08...|28...|57P0[123])$/.test(code)
}

/** What a token says, unverified: PostgreSQL verifies it. Read only to name the role to ask for. */
export function claims(token: string): Record<string, unknown> {
  try {
    const payload = token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')
    const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(bytes)) ?? {}
  } catch {
    return {}
  }
}
/** The PostgreSQL role a token names: its claim, when it could be a role name at all. */
export function roleOf(token: string, claim: string): string | null {
  const value = claims(token)[claim]
  if (typeof value !== 'string' || !value || value.includes('\0')) return null
  return new TextEncoder().encode(value).length > 63 ? null : value
}
export function expiresAt(token: string): number | null {
  const exp = claims(token).exp
  return typeof exp === 'number' ? exp * 1000 : null
}

/** The interface is built for one version of the database, and says which way another differs. */
export type VersionMismatch = 'older' | 'newer'
export function versionMismatch(installation?: string | null, built: string = VERSION) {
  const parts = (v: string) => v.split('.').map(Number)
  if (!installation || [installation, built].some((v) => !/^\d+\.\d+\.\d+$/.test(v))) return null
  const [a, b] = [parts(installation), parts(built)]
  const at = [0, 1, 2].find((i) => a[i] !== b[i])
  return at === undefined ? null : ((a[at]! < b[at]! ? 'older' : 'newer') as VersionMismatch)
}
