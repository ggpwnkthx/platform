import type { PGlite } from '@electric-sql/pglite'
import { type Field, parseValue, type Result, serialize } from '@platform/pg-client/wire.ts'
import type { RuntimeConfig } from '@platform/ui/config.ts'
import type { Credentials, Db, WithoutIssuer } from '@platform/ui/pg/connect.ts'
import { type Applied, manifestOf } from '../folder.ts'
import { asPgError, commandOf } from './errors.ts'
import { fingerprintFor } from './fingerprint.ts'
import { peopleOf } from './people.ts'
import { start, storagePrefix } from './storage.ts'

/**
 * The database a development build puts in the interface's seam, made of what a folder
 * applies.
 *
 * Where it is kept says what it was installed from: a build whose installation scripts or
 * files have changed looks under another name, finds nothing, and installs again.
 * Nobody has to remember to say the files changed.
 *
 * Signing in is without an issuer: the manifest's people choose themselves in the page. The
 * choice is kept in the page's own storage, so that a reload is the same person.
 */
export function inPage(applied: Applied): {
  connect: (config: RuntimeConfig, who: Credentials) => Promise<Db>
  withoutIssuer: WithoutIssuer
} {
  const storageKey = `${storagePrefix}${fingerprintFor(applied)}`
  const withoutIssuer: WithoutIssuer = {
    people: peopleOf(manifestOf(applied)),
    notice: 'PostgreSQL runs inside this page, with the site installed. Choose who to be.',
    starting: 'Starting PostgreSQL in the page',
    chosen: () => sessionStorage.getItem('platform.dev.as'),
    choose: (role) => sessionStorage.setItem('platform.dev.as', role),
    forget: () => sessionStorage.removeItem('platform.dev.as'),
  }
  let booted: { role: string; db: Promise<PGlite> } | null = null

  async function connect(_config: RuntimeConfig, who: Credentials): Promise<Db> {
    if (booted && booted.role !== who.role) {
      // One person per page: becoming somebody else is a new page.
      withoutIssuer.choose(who.role)
      location.reload()
      await new Promise(() => undefined)
    }
    booted ??= { role: who.role, db: start(applied, storageKey, who.role) }
    const db = await booted.db
    return {
      async query<Row>(text: string, params: unknown[] = []): Promise<Result<Row>> {
        try {
          const result = await db.query<Record<string, unknown>>(text, params.map(serialize))
          const fields: Field[] = result.fields.map((f) => ({
            name: f.name,
            type: f.dataTypeID,
            table: 0,
            column: 0,
          }))
          const rows = result.rows.map((row) => {
            const out: Record<string, unknown> = {}
            for (const field of fields) {
              const value = row[field.name]
              out[field.name] =
                typeof value === 'string' ? parseValue(field.type, value) : (value ?? null)
            }
            return out
          })
          const command = commandOf(text)
          return {
            fields,
            rows: rows as Row[],
            command,
            affected: command === 'SELECT' ? rows.length : (result.affectedRows ?? null),
          }
        } catch (error) {
          throw asPgError(error)
        }
      },
      close() {
        // The in-page database outlives a request; the next one logs in as the same person.
      },
      isClosed: false,
    }
  }

  return { connect, withoutIssuer }
}
