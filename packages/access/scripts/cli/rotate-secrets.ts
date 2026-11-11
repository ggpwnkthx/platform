#!/usr/bin/env bun
/**
 * The rotation of the key of the client secrets (spec §4.3).
 *
 * The two client secrets of every tenant are re-encrypted in one
 * transaction: the operator runs this script with the key that is in use
 * and the new one, and the deployment is then restarted with the new key.
 *
 *   ACCESS_DATABASE_URL=postgres://… \
 *   ACCESS_SECRET_ENCRYPTION_KEY=the-old-key \
 *   ACCESS_NEW_SECRET_ENCRYPTION_KEY=the-new-key \
 *   bun run scripts/rotate-secrets.ts
 *
 * The secret of the provider of a tenant is stored twice: in the row of
 * the tenant and in the row of its provider (spec §3.11). Both are
 * re-encrypted, or the logins of the tenant stop working after the
 * rotation.
 *
 * The script reads the environment of the process: it is an operator tool
 * and not part of the service. It never writes a secret and never prints
 * one.
 */
import {
  createDatabase,
  createSecretCipher,
  MIGRATIONS_DIRECTORY,
  runMigrations,
} from '../../src/platform/postgres'
import { createLogger } from '../../src/observability'
import { failure } from '../support/report'

/** The columns that hold an encrypted secret. */
const COLUMNS = ['idp_client_secret', 'client_secret'] as const

async function main(): Promise<void> {
  const logger = createLogger({
    level: 'info',
    bindings: { service: 'access', tool: 'rotate-secrets' },
  })
  const url = process.env.ACCESS_DATABASE_URL
  const oldKey = process.env.ACCESS_SECRET_ENCRYPTION_KEY
  const newKey = process.env.ACCESS_NEW_SECRET_ENCRYPTION_KEY
  if (!url) throw new Error('ACCESS_DATABASE_URL must be set: it names the database of the tenants')
  if (!oldKey) throw new Error('ACCESS_SECRET_ENCRYPTION_KEY must be set: it is the key in use')
  if (!newKey) throw new Error('ACCESS_NEW_SECRET_ENCRYPTION_KEY must be set: it is the new key')

  const database = await createDatabase({
    driver: url.startsWith('pglite://') ? 'pglite' : 'postgres',
    url: url.startsWith('pglite://') ? undefined : url,
    path: url.startsWith('pglite://') ? url.slice('pglite://'.length) : undefined,
  })
  try {
    await runMigrations({ database, directory: MIGRATIONS_DIRECTORY, logger })

    const reader = createSecretCipher(oldKey)
    const writer = createSecretCipher(newKey)

    // The whole rotation is one transaction: a failure leaves the stored
    // secrets exactly as they were.
    const rotated = await database.transaction(async (client) => {
      const tenants = await client.query<{
        id: string
        idp_client_secret: Uint8Array
        client_secret: Uint8Array
      }>('select id, idp_client_secret, client_secret from tenants')

      let count = 0
      for (const tenant of tenants) {
        for (const column of COLUMNS) {
          const clear = reader.decrypt(tenant[column])
          const encrypted = writer.encrypt(clear)
          await client.query(`update tenants set ${column} = $1 where id = $2`, [
            encrypted,
            tenant.id,
          ])
        }
        count += 1
      }

      // The secret of a provider is stored in the row of its provider as
      // well: it is re-encrypted with the rest, or the provider of the
      // tenant cannot be read any more (spec §3.11).
      const providers = await client.query<{ id: string; idp_client_secret: Uint8Array | null }>(
        'select id, idp_client_secret from tenant_providers where idp_client_secret is not null'
      )
      for (const provider of providers) {
        const clear = reader.decrypt(provider.idp_client_secret!)
        const encrypted = writer.encrypt(clear)
        await client.query(`update tenant_providers set idp_client_secret = $1 where id = $2`, [
          encrypted,
          provider.id,
        ])
      }

      return { tenants: count, providers: providers.length }
    })

    logger.info('the client secrets were re-encrypted', {
      tenants: rotated.tenants,
      providers: rotated.providers,
      columns: COLUMNS.length,
    })
    logger.info('the deployment has to be restarted with the new key')
  } finally {
    await database.close()
  }
}

main().catch(failure('the rotation failed'))
