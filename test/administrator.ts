import type pg from 'pg'
import { TokenClient } from '../packages/cli/src/database/db.ts'

/**
 * The administrator the tests act as: the role the server under test was started with in
 * PLATFORM_ADMIN. Like everybody else it has no password: it signs in with a token the
 * tests' own issuer minted for it. TEST_ADMIN_URL names it, the server and a database.
 */
export const adminUrl =
  process.env.TEST_ADMIN_URL ?? 'postgres://installer%40example.com@127.0.0.1:54329/postgres'
const url = new URL(adminUrl)
if (url.password) throw new Error('TEST_ADMIN_URL carries a password: no login has one')

/** The role the administrator signs in as. */
export const adminRole = decodeURIComponent(url.username)

/** The server's own superuser, which is no login over the network. */
export const serverSuperuser = process.env.TEST_SERVER_SUPERUSER ?? 'postgres'

/** A connection as the administrator, to the database the URL names or to another. */
export function administrator(
  issuer: { mint(email: string): string },
  database = decodeURIComponent(url.pathname.slice(1)) || 'postgres'
): pg.Client {
  return new TokenClient(
    {
      host: url.hostname,
      port: Number(url.port || 5432),
      database,
      user: adminRole,
      ssl: process.env.TEST_DATABASE_SSL === 'require' ? { rejectUnauthorized: true } : false,
    },
    issuer.mint(adminRole)
  )
}
