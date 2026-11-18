import { readFileSync } from 'node:fs'
import { z } from 'zod'

const integer = (value: number, max = 65535) =>
  z.coerce.number().int().min(1).max(max).default(value)
/**
 * Where the operator's commands find the database and the issuer. The interface needs none of
 * this: its pages read /config.json, and it holds no connection settings of its own.
 */
const schema = z.object({
  databaseHost: z.string().default('127.0.0.1'),
  databasePort: integer(5432),
  databaseName: z.string().default('platform'),
  databaseSsl: z.enum(['require', 'disable']).default('require'),
  databaseCa: z.string().optional(),
  statementTimeoutMs: integer(15000, 600000),
  /** The one OpenID Connect issuer PostgreSQL accepts tokens from: your Dex. */
  oidcIssuer: z.url().optional(),
  /** The token claim PostgreSQL matches against the role name. */
  oidcClaim: z.string().min(1).default('email'),
})
export type Config = z.infer<typeof schema>
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  for (const name of ['DATABASE_URL', 'DATABASE_SCHEMA_URL'])
    if (env[name]) throw new Error(`${name} is obsolete: name the host, port and database instead`)
  return schema.parse({
    databaseHost: env.DATABASE_HOST,
    databasePort: env.DATABASE_PORT,
    databaseName: env.DATABASE_NAME,
    databaseSsl: env.DATABASE_SSL,
    databaseCa: env.DATABASE_CA_FILE ? readFileSync(env.DATABASE_CA_FILE, 'utf8') : undefined,
    statementTimeoutMs: env.STATEMENT_TIMEOUT_MS,
    oidcIssuer: env.OIDC_ISSUER?.replace(/\/+$/, '') || undefined,
    oidcClaim: env.OIDC_CLAIM,
  })
}
