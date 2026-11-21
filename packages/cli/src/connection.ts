import { readFileSync } from 'node:fs'
import pg from 'pg'
import { loadConfig } from './database/config.ts'
import { bearer, clientConfig, TokenClient } from './database/db.ts'
import { localDatabase } from './deployment/index.ts'

const secret = (name: string) => {
  const path = process.env[`${name}_FILE`]
  const value = path ? readFileSync(path, 'utf8').trimEnd() : process.env[name]
  if (!value) throw new Error(`${name} or ${name}_FILE is required`)
  return value
}
const given = (name: string) => !!(process.env[name] || process.env[`${name}_FILE`])

/**
 * The database of a deployment, connected as the operator this command acts as: a person, with
 * the token in PGTOKEN[_FILE]. No login has a password, the operator's included.
 *
 * The one connection without a token is the server's own socket: DATABASE_HOST names the
 * directory it is in, which only something running beside the server can reach. PostgreSQL
 * lets its own superuser in there, and that is how a server is installed before anybody has
 * a role to sign in as.
 */
export function connection(target?: string): pg.Client {
  let config = loadConfig()
  if (target === 'local') {
    const db = localDatabase()
    config = loadConfig({
      OIDC_CLAIM: process.env.OIDC_CLAIM,
      DATABASE_HOST: db.host,
      DATABASE_PORT: db.port,
      DATABASE_NAME: db.name,
      DATABASE_SSL: 'disable',
    })
  } else if (target !== undefined && target !== 'k8s' && target !== 'kubernetes')
    throw new Error(`Unknown deployment: ${target}. Supported deployments: local, k8s.`)
  for (const name of ['PGPASSWORD', 'PGPASSWORD_FILE'])
    if (process.env[name])
      throw new Error(`${name} is not used: no login has a password. Sign in with a token.`)
  if (given('PGTOKEN')) {
    const who = bearer(`Bearer ${secret('PGTOKEN')}`, config.oidcClaim)
    return new TokenClient(clientConfig(config, who), who.token)
  }
  if (config.databaseHost.startsWith('/'))
    return new pg.Client({
      ...clientConfig(config, { username: process.env.PGUSER || 'postgres' }),
      ssl: false,
    })
  throw new Error(
    target === 'local'
      ? 'PGTOKEN or PGTOKEN_FILE is required: sign in with `bun run cli token` and pass what it prints. The local stack itself is administered with `bun run cli deploy local admin <command>`.'
      : 'PGTOKEN or PGTOKEN_FILE is required: sign in with `bun run cli token` and pass what it prints.'
  )
}
