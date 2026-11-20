import platform from '../../../migrations/0001_platform.sql' with { type: 'text' }
import { VERSION } from './version.ts'

/** One installation script: the file it is, the version it leaves, and what it says. */
export type Migration = { file: string; version: string; sql: string }

/**
 * The installation scripts, in order, each one leaving the database at the version it names.
 * There is one: the platform has not been released, so there is no installation of an
 * earlier version to bring forward. The next change to the schema is the next file here.
 *
 * This is the one list. `migrate` runs it beside a server, and a PostgreSQL that runs in a
 * page or in a test is installed from it too, so the three are never at different versions.
 * Nothing here reads a file: the scripts are carried as their text, so that a page may hold
 * them.
 */
export const MIGRATIONS: Migration[] = [
  { file: '0001_platform.sql', version: '2.3.0', sql: platform },
]
if (MIGRATIONS[MIGRATIONS.length - 1]!.version !== VERSION)
  throw new Error(`The last migration must produce version ${VERSION}`)
