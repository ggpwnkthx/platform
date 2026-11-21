import type pg from 'pg'
import { TokenClient, transaction } from '../packages/cli/src/database/db.ts'
import { ident } from '../packages/vocabulary/src/index.ts'
import type { Connection } from '../packages/pg-client/src/wire.ts'
import { administrator } from './administrator.ts'
import { startIssuer } from './issuer.ts'
import { openPage } from './page.ts'

/**
 * The world a test file works in: a database of its own, the roles that work in it, and
 * the issuer whose tokens they sign in with.
 *
 * Every test file that talks to PostgreSQL needs the same of this, and each of them was
 * writing it out again: the same names, the same cluster, the same teardown. The names
 * carry a prefix, so two test files that run at once never meet over a database or a role.
 */
export interface World {
  /** The name of the database this world owns. */
  dbName: string
  /** The name of a role in this world: one person among the others. */
  role(name: string): string
  /** The issuer whose tokens the roles sign in with. */
  issuer: ReturnType<typeof startIssuer>
  /** Where the server under test is, as a connection names it. */
  endpoint: {
    host: string
    port: number
    database: string
    ssl: boolean | { rejectUnauthorized: boolean }
  }
  /** A direct connection, as psql would make it: the role, and a token that names it. */
  connect(name: string, token?: string): Promise<pg.Client>
  /** The page's own client, signed in as this person with a token the issuer minted. */
  signIn(name: string, token?: string): Promise<Connection>
  /** Runs some work in the page's client as this person, then signs them out. */
  as<T>(name: string, work: (db: Connection) => Promise<T>): Promise<T>
  /** The server's own superuser, which signs in as the administrator. */
  root: pg.Client
  /** The administrator of this database. */
  admin: pg.Client
  /** Creates the roles named, each of them a member of platform_users. */
  makeRoles(names: string[], login?: (name: string) => boolean): Promise<void>
  /** Creates a role of this name, in the database of this world. */
  makeRole(name: string, options?: { login?: boolean; member?: boolean }): Promise<void>
  /** Drops the database and the roles, and stops the issuer. */
  drop(roles: string[]): Promise<void>
}

/**
 * A world of its own: a database, an issuer, and the roles that work in it. The prefix
 * keeps it apart from the other test files that run beside it.
 *
 * The platform's own installation is made in the database unless the world is asked not
 * to: a test that only needs a PostgreSQL to talk to does not want the platform in it.
 */
export async function world(
  prefix: string,
  adminUrl: string,
  options: { migrate?: boolean } = {}
): Promise<World> {
  const url = new URL(adminUrl)
  const dbName = `${prefix}_db`
  const role = (name: string) => `${prefix}_${name}`
  // The test server is started trusting this issuer: see docs/operations.md.
  const issuerUrl = process.env.TEST_OIDC_ISSUER ?? 'http://127.0.0.1:54330'
  const issuer = startIssuer(issuerUrl)
  const endpoint = {
    host: url.hostname,
    port: Number(url.port || 5432),
    database: dbName,
    ssl: (process.env.TEST_DATABASE_SSL === 'require' ? { rejectUnauthorized: true } : false) as
      | boolean
      | { rejectUnauthorized: boolean },
  }
  const root = administrator(issuer)
  await root.connect()
  await root.query(`CREATE DATABASE ${ident(dbName)}`)
  const admin = administrator(issuer, dbName)
  await admin.connect()
  await transaction(admin, async () => {
    if (options.migrate === false) return
    await admin.query(
      await Bun.file(new URL('../migrations/0001_platform.sql', import.meta.url)).text()
    )
  })
  const connect = async (name: string, token = issuer.mint(role(name))) => {
    const q = new TokenClient({ ...endpoint, user: role(name) }, token)
    q.on('error', () => undefined)
    await q.connect()
    return q
  }
  const signIn = (name: string, token = issuer.mint(role(name))) =>
    openPage(url, role(name), dbName, token)
  const as = async <T>(name: string, work: (db: Connection) => Promise<T>): Promise<T> => {
    const db = await signIn(name)
    try {
      return await work(db)
    } finally {
      db.close()
    }
  }
  /** Creates a role of this name, in the database of this world. */
  const makeRole = async (
    name: string,
    { login = true, member = true }: { login?: boolean; member?: boolean } = {}
  ) => {
    await admin.query(
      `CREATE ROLE ${ident(name)} ${login ? 'LOGIN' : 'NOLOGIN'} NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`
    )
    if (member) await admin.query(`GRANT platform_users TO ${ident(name)}`)
  }
  /** Creates the roles named, each of them a member of platform_users. */
  const makeRoles = async (names: string[], login: (name: string) => boolean = () => true) => {
    for (const name of names) await makeRole(role(name), { login: login(name) })
  }
  return {
    dbName,
    role,
    issuer,
    endpoint,
    connect,
    signIn,
    as,
    root,
    admin,
    makeRole,
    makeRoles,
    /** Drops the database and the roles, and stops the issuer. */
    async drop(roles) {
      // The administrator is connected to the database being dropped, and is ended
      // before it goes: PostgreSQL refuses to drop a database that is still in use.
      await admin.end().catch(() => undefined)
      await root.query(`DROP DATABASE ${ident(dbName)} WITH(FORCE)`)
      for (const name of roles) await root.query(`DROP ROLE IF EXISTS ${ident(name)}`)
      await root.end()
      issuer.stop()
    },
  }
}

/**
 * A name that belongs to this world alone: two test files that run at once never meet
 * over a database or a role.
 */
export function prefix(mark: string): string {
  return `${mark}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}
