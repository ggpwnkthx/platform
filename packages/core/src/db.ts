import { compareVersions, validate } from 'compare-versions'
import { jwtDecode } from 'jwt-decode'

/** Public package/database version. Keep aligned with package.json and the installation SQL. */
export const VERSION = '2.3.0'

export interface Field {
  name: string
  dataTypeID: number
}
export interface Result<Row = Record<string, unknown>> {
  rows: Row[]
  fields: Field[]
  command: string
  rowCount: number | null
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

export async function transaction<T>(db: Db, work: () => Promise<T>, dryRun = false): Promise<T> {
  await db.query('BEGIN')
  try {
    const result = await work()
    await db.query(dryRun ? 'ROLLBACK' : 'COMMIT')
    return result
  } catch (error) {
    await db.query('ROLLBACK').catch(() => undefined)
    throw error
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

export function claims(token: string): Record<string, unknown> {
  try {
    return jwtDecode<Record<string, unknown>>(token) ?? {}
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

export type VersionMismatch = 'older' | 'newer'
export function versionMismatch(installation?: string | null, built: string = VERSION) {
  if (!installation || !validate(installation) || !validate(built)) return null
  const compared = compareVersions(installation, built)
  return compared === 0 ? null : ((compared < 0 ? 'older' : 'newer') as VersionMismatch)
}
export async function requireInstalledVersion(db: Db): Promise<void> {
  const found = await db.query<{ version: string }>('SELECT version FROM platform.installation')
  const version = found.rows[0]?.version
  if (version !== VERSION)
    throw new Error(
      `This installation is at version ${version ?? 'none'}. Run \`bun run cli migrate\` first.`
    )
}
