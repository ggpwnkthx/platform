import { id, InvalidName, sql, stmt } from './kit.ts'

/** The database as a whole: its extensions, the upkeep of its tables, and its sessions. */
const named = (name: unknown, what: string) => {
  const text = String(name ?? '').trim()
  if (!text) throw new InvalidName(`Name the ${what}.`)
  return text
}
/** An extension, installed into a schema or where it says it belongs. */
export const createExtensionStatement = (name: string, schema?: string | null) =>
  stmt`CREATE EXTENSION ${id(named(name, 'extension'))}${schema ? sql` SCHEMA ${id(schema)}` : sql.raw('')}`
export const updateExtensionStatement = (name: string) => stmt`ALTER EXTENSION ${id(name)} UPDATE`
export const dropExtensionStatement = (name: string) => stmt`DROP EXTENSION ${id(name)}`

/** Upkeep of a table: its dead rows reclaimed, its statistics read again, its indexes rebuilt. */
export const maintenanceWords = ['VACUUM', 'ANALYZE', 'REINDEX'] as const
export function maintenanceStatement(
  work: (typeof maintenanceWords)[number],
  schema: string,
  table: string
) {
  if (!maintenanceWords.includes(work))
    throw new InvalidName(`${work} is not upkeep PostgreSQL knows`)
  return work === 'REINDEX'
    ? stmt`REINDEX TABLE ${id(schema, table)}`
    : stmt`${sql.raw(work)} ${id(schema, table)}`
}
/** A session asked to stop what it is running, or ended. PostgreSQL decides whose it may be. */
export const endSessionStatement = (pid: number, cancel = false) => {
  if (!Number.isInteger(pid)) throw new InvalidName('Not a session')
  return stmt`SELECT ${sql.raw(cancel ? 'pg_cancel_backend' : 'pg_terminate_backend')}(${sql.raw(String(pid))})`
}
