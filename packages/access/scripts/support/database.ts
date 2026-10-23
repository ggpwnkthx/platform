/**
 * The database of a script of the operator.
 *
 * A script of the operator measures or explains the service: it opens
 * the database of the deployment, it applies the migrations of the
 * production and it fills it with the rows that the measurement or the
 * plan needs.
 */

import { createDatabase, MIGRATIONS_DIRECTORY, runMigrations } from '../../src/platform/postgres'
import { createLogger } from '../../src/observability'
import type { Database } from '../../src/platform/postgres'

/**
 * The database of a script, with the schema of the access service applied.
 *
 * The url is the one of the environment: a deployment that has a
 * PostgreSQL server measures that server, and a machine that has none
 * runs the embedded PostgreSQL of the process.
 */
export async function openToolDatabase(
  url: string = process.env.ACCESS_DATABASE_URL ?? 'pglite://memory://'
): Promise<Database> {
  const database = await createDatabase(
    url.startsWith('pglite://')
      ? { driver: 'pglite', path: url.slice('pglite://'.length) }
      : { driver: 'postgres', url }
  )
  await runMigrations({
    database,
    directory: MIGRATIONS_DIRECTORY,
    logger: createLogger({ level: 'info', bindings: { service: 'access' } }),
  })
  return database
}

/** The tenant that a script of the operator fills the database with. */
export interface SeededTenant {
  /** The slug of the tenant. */
  slug: string
  /** The name of the tenant. */
  displayName: string
  /** The issuer of the provider of the tenant. */
  issuer: string
  /** The client id of the access service at the provider of the tenant. */
  clientId: string
}

/**
 * Writes the tenant of a script, with the permission of the measurement.
 *
 * The rows are written by statements of their own: a script that fills
 * a database does not go through the administration of the service, and
 * it writes the rows that the statement of the decision reads.
 */
export async function seedToolTenant(database: Database, tenant: SeededTenant): Promise<void> {
  await database.exec(`
    insert into tenants (slug, display_name, idp_issuer, idp_client_id, idp_client_secret,
      idp_redirect_uri, client_id, client_secret)
    values ('${tenant.slug}', '${tenant.displayName}', '${tenant.issuer}', '${tenant.clientId}',
      '\\x01', 'https://access.example.com/oauth/tenant/callback', 'gateway-${tenant.slug}', '\\x01')
    on conflict (slug) do nothing;
  `)
  await database.exec(`
    insert into permissions (tenant_id, key)
    select (select id from tenants where slug = '${tenant.slug}'), 'workspace.read'
    on conflict do nothing;
  `)
}
