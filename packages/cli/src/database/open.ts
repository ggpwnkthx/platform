import { readFileSync } from 'node:fs'
import pg from 'pg'
import { type Db, roleOf } from '@platform/core'
import { fromPg, typeParsers, withToken } from '@platform/core/token-client'

const TokenClient = withToken(pg.Client)
const secret = (name: string, env = process.env) => {
  const path = env[`${name}_FILE`]
  return path ? readFileSync(path, 'utf8').trimEnd() : env[name]
}

/**
 * The login a database command acts as. There is no password to give it: a person signs in
 * with a token (`platform token`), like everyone else. A DATABASE_HOST that is a directory is
 * the server's own socket, for a command that runs beside the server.
 */
export async function open(
  overrides: Record<string, string> = {}
): Promise<Db & { end(): Promise<void> }> {
  const env = { ...process.env, ...overrides }
  for (const name of ['DATABASE_URL', 'PGPASSWORD', 'PGPASSWORD_FILE'])
    if (env[name])
      throw new Error(
        `${name} is not used: name the host, port and database, and sign in with a token.`
      )
  const host = env.DATABASE_HOST ?? '127.0.0.1'
  const beside = host.startsWith('/')
  const token = secret('PGTOKEN', env)
  const role = token ? roleOf(token, env.OIDC_CLAIM ?? 'email') : null
  if (token && !role)
    throw new Error(`The token names no PostgreSQL role in its ${env.OIDC_CLAIM ?? 'email'} claim`)
  if (!token && !beside)
    throw new Error(
      'PGTOKEN or PGTOKEN_FILE is required: sign in with `bun run cli token` and pass what it prints. The local stack itself is administered with `bun run cli deploy local admin <command>`.'
    )
  const config = {
    host,
    port: Number(env.DATABASE_PORT ?? 5432),
    database: env.DATABASE_NAME ?? 'platform',
    user: role ?? env.PGUSER ?? 'postgres',
    ssl:
      beside || env.DATABASE_SSL === 'disable'
        ? false
        : {
            rejectUnauthorized: true,
            ca: env.DATABASE_CA_FILE ? readFileSync(env.DATABASE_CA_FILE, 'utf8') : undefined,
          },
    application_name: 'platform-cli',
    connectionTimeoutMillis: 5000,
    statement_timeout: Number(env.STATEMENT_TIMEOUT_MS ?? 15000),
    types: typeParsers(pg.types),
  }
  const client = token
    ? new TokenClient({ ...config, token } as pg.ClientConfig)
    : new pg.Client(config)
  await client.connect()
  return { ...fromPg(client), end: () => client.end() }
}
