import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { bypassesRowLevelSecurity, type Database } from '../../src/platform/postgres'
import { OTHER_TENANT, seedTenant } from '../fixtures/tenant'
import { againstServer, openTestDatabase, openTestSession } from './database'

/**
 * The isolation of the tenants, enforced by the database.
 *
 * The test does not trust the application: it connects as a role that is
 * subject to the policies of the tables, it opens a scope of a tenant and
 * it reads the rows of the platform. The rows of the other tenant are not
 * there.
 */
let database: Database
let acme: string

/**
 * Drops a role of the test, with the privileges that were granted to it.
 *
 * The role is a role of the database and not of the schema of the test:
 * a database that is used twice has to be able to run the test again.
 */
async function dropRole(name: string): Promise<void> {
  await database.exec(`
    do $$
    begin
      if exists (select 1 from pg_roles where rolname = '${name}') then
        execute 'drop owned by ${name}';
        execute 'drop role ${name}';
      end if;
    end $$;
  `)
}

beforeAll(async () => {
  database = await openTestDatabase()
  const first = await seedTenant(database, { subject: 'the-subject-of-acme' })
  await seedTenant(database, {
    tenant: OTHER_TENANT,
    subject: 'the-subject-of-other',
  })
  acme = first.tenantId
})

afterAll(async () => {
  await database.close()
})

describe('the isolation of the tenants', () => {
  test('the policies of the tables are there', async () => {
    const rows = await database.query<{ table_name: string; enabled: boolean; forced: boolean }>(
      `select c.relname as table_name, c.relrowsecurity as enabled, c.relforcerowsecurity as forced
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = current_schema()
         and c.relname in ('tenants', 'tenant_providers', 'users', 'permissions', 'grants', 'groups')
       order by c.relname`
    )
    expect(rows).toHaveLength(6)
    for (const row of rows) {
      expect(row.enabled).toBe(true)
      expect(row.forced).toBe(true)
    }
  })

  test('a scope of a tenant hides the rows of the other tenants', async () => {
    // The role of the test is not a superuser: the policies are the rules
    // for it. It needs the usage of the schema of the test: a role
    // without it does not see the tables at all.
    const schema = await database.query<{ name: string }>(`select current_schema() as name`)
    const schemaName = schema[0]!.name
    await dropRole('access_isolation_test')
    await database.exec(`create role access_isolation_test`)
    await database.exec(`grant usage on schema "${schemaName}" to access_isolation_test`)
    await database.exec(
      `grant select on tenants, tenant_providers, users, permissions, grants, groups
        to access_isolation_test`
    )

    try {
      // Everything in one transaction: the role and the statements are on
      // the same connection of the pool.
      await database.transaction(async (client) => {
        await client.query(`set role access_isolation_test`)

        // A statement that was not given a scope sees nothing: the
        // scope is never the default, and a statement that forgot its
        // scope does not read the platform (spec §3.10).
        const everyone = await client.query<{ count: number }>(
          `select count(*)::int as count from users`
        )
        expect(everyone[0]?.count).toBe(0)

        await client.query(`select set_config('access.scope', 'tenant', true)`)
        await client.query(`select set_config('access.tenant_id', $1, true)`, [acme])
        const users = await client.query<{ tenant_id: string }>(`select tenant_id from users`)
        const tenants = await client.query<{ slug: string }>(`select slug from tenants`)
        const providers = await client.query<{ tenant_id: string }>(
          `select tenant_id from tenant_providers`
        )
        expect(users).toHaveLength(1)
        expect(users[0]?.tenant_id).toBe(acme)
        expect(tenants.map((row) => row.slug)).toEqual(['acme'])
        // The providers are scoped like the other tables of the model:
        // the provider of the other tenant is not there (spec §3.10).
        expect(providers).toHaveLength(1)
        expect(providers[0]?.tenant_id).toBe(acme)

        // The role is given back before the transaction is committed: a
        // committed `set role` would stay on the connection of the pool.
        await client.query(`reset role`)
      })
    } finally {
      await dropRole('access_isolation_test')
    }
  })

  test('the scope of the platform is explicit on a connection that has run a scoped statement', async () => {
    // The pool of a deployment reuses its connections, and PostgreSQL
    // leaves the placeholder of the scope on a connection that has run a
    // scoped statement: the placeholder is empty, and it is empty for
    // the rest of the life of the connection. The scope of the platform
    // is **asked for by name**: a statement that does not ask for it
    // sees nothing, and the statement of the platform that asks for it
    // sees the platform and may write it.
    //
    // Without the rule, the administration of the platform stops working
    // on the second call, on the connection of the pool that served the
    // first one, and the write of a principal is refused by the policy
    // of the table.
    const schema = await database.query<{ name: string }>(`select current_schema() as name`)
    const schemaName = schema[0]!.name
    await dropRole('access_scope_leak_test')
    await database.exec(`create role access_scope_leak_test`)
    await database.exec(`grant usage on schema "${schemaName}" to access_scope_leak_test`)
    await database.exec(
      `grant select, insert on tenants, tenant_providers, users, permissions, grants, groups,
        admin_audit to access_scope_leak_test`
    )

    // A pool of one connection: the scoped statement and the statement
    // of the platform are on the same session.
    const session = await openTestSession()
    try {
      await session.transaction(async (client) => {
        await client.query(`set role access_scope_leak_test`)
        // The scope of a tenant, for the transaction that asks for it.
        await client.query(`select set_config('access.scope', 'tenant', true)`)
        await client.query(`select set_config('access.tenant_id', $1, true)`, [acme])
        await client.query(`select count(*)::int as count from users`)
        await client.query(`reset role`)
      })

      // A statement that does not ask for a scope, on the same
      // connection: the placeholder of the scope is empty, and the
      // statement sees nothing.
      await session.transaction(async (client) => {
        await client.query(`set role access_scope_leak_test`)
        const nobody = await client.query<{ count: number }>(
          `select count(*)::int as count from users`
        )
        expect(nobody[0]?.count).toBe(0)
        await client.query(`reset role`)
      })

      // The scope of the platform, asked for by name, on the same
      // connection: the rows of the platform are there.
      await session.transaction(async (client) => {
        await client.query(`set role access_scope_leak_test`)
        await client.query(`select set_config('access.scope', 'platform', true)`)
        const everyone = await client.query<{ count: number }>(
          `select count(*)::int as count from users`
        )
        expect(everyone[0]?.count).toBe(2)
        await client.query(`reset role`)
      })

      // And the write of a principal, on the same connection: the policy
      // of the table lets it through.
      await session.transaction(async (client) => {
        await client.query(`set role access_scope_leak_test`)
        await client.query(`select set_config('access.scope', 'platform', true)`)
        await client.query(`insert into users (tenant_id, external_subject) values ($1, $2)`, [
          acme,
          'the-subject-of-the-leak',
        ])
        await client.query(`reset role`)
      })
    } finally {
      if (session !== database) await session.close()
      await dropRole('access_scope_leak_test')
    }
  })

  test('the secret of the provider of a tenant is readable by the login path', async () => {
    // The login of a tenant reads the row of its provider in the scope
    // of the tenant, and the secret of that provider in the scope of the
    // platform: the two statements are two transactions, and they are
    // two connections of the pool.
    //
    // A connection of the pool that has run a scoped statement keeps the
    // placeholder of the scope: the placeholder is empty. A policy that
    // reads the placeholder of the tenant alone hides the row of the
    // platform from the statement that asks for the scope of the
    // platform, and the secret of the provider is not readable. A secret
    // that is not readable is an empty secret, and the provider refuses
    // the client: every login of the tenant is refused at the exchange
    // of the code.
    const schema = await database.query<{ name: string }>(`select current_schema() as name`)
    const schemaName = schema[0]!.name
    await dropRole('access_provider_secret_test')
    await database.exec(`create role access_provider_secret_test`)
    await database.exec(`grant usage on schema "${schemaName}" to access_provider_secret_test`)
    await database.exec(`grant select on tenants, tenant_providers to access_provider_secret_test`)

    // A pool of one connection: the two statements of the login are two
    // transactions of the same session.
    const session = await openTestSession()
    try {
      let providerId = ''
      // The first statement of the login: the row of the provider, in the
      // scope of the tenant.
      await session.transaction(async (client) => {
        await client.query(`set role access_provider_secret_test`)
        await client.query(`select set_config('access.scope', 'tenant', true)`)
        await client.query(`select set_config('access.tenant_id', $1, true)`, [acme])
        const providers = await client.query<{ id: string }>(
          `select id from tenant_providers where tenant_id = $1`,
          [acme]
        )
        expect(providers).toHaveLength(1)
        providerId = providers[0]!.id
        await client.query(`reset role`)
      })

      // The second statement of the login: the secret of the provider,
      // in the scope of the platform, on the connection that ran the
      // statement of the tenant.
      await session.transaction(async (client) => {
        await client.query(`set role access_provider_secret_test`)
        await client.query(`select set_config('access.scope', 'platform', true)`)
        const secrets = await client.query<{ idp_client_secret: Uint8Array | null }>(
          `select idp_client_secret from tenant_providers where id = $1`,
          [providerId]
        )
        // The secret is there: it is the ciphertext of the secret of the
        // provider, and it is never empty.
        expect(secrets).toHaveLength(1)
        expect(secrets[0]!.idp_client_secret).not.toBeNull()
        expect(
          Buffer.from(secrets[0]!.idp_client_secret ?? new Uint8Array()).length
        ).toBeGreaterThan(0)
        await client.query(`reset role`)
      })
    } finally {
      if (session !== database) await session.close()
      await dropRole('access_provider_secret_test')
    }
  })

  test('the role of the deployment is told when it bypasses the isolation', async () => {
    // The role of the test is a superuser: it is not subject to the
    // policies, and a production deployment refuses to start with it.
    expect(await bypassesRowLevelSecurity(database)).toBe(true)

    await dropRole('access_not_super_test')
    await database.exec(`create role access_not_super_test nosuperuser nobypassrls`)
    try {
      // The role and the statement are on the same connection of the
      // pool: the role of the connection is a property of the session.
      await database.transaction(async (client) => {
        await client.query(`set role access_not_super_test`)
        expect(await bypassesRowLevelSecurity(client)).toBe(false)
        await client.query(`reset role`)
      })
    } finally {
      await dropRole('access_not_super_test')
    }
  })
})

describe('the start of a production deployment', () => {
  test.skipIf(!againstServer)(
    'a production deployment refuses a role that bypasses the isolation',
    async () => {
      const { generateKeyPairSync } = await import('node:crypto')
      const { createRuntime } = await import('../../src/runtime/composition')
      const { readEnv } = await import('../../src/runtime/env')
      const { createDatabase } = await import('../../src/platform/postgres')
      const url = process.env.ACCESS_TEST_DATABASE_URL ?? ''
      const schema = 'access_test_production'
      const admin = await createDatabase({ driver: 'postgres', url })
      try {
        await admin.exec(`create schema if not exists "${schema}"`)
      } finally {
        await admin.close()
      }
      const scoped = `${url}${url.includes('?') ? '&' : '?'}options=-c%20search_path%3D${schema}`
      const { privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' },
      })
      let message = ''
      try {
        const runtime = await createRuntime(
          readEnv({
            ACCESS_ENVIRONMENT: 'production',
            ACCESS_HOST: '127.0.0.1',
            ACCESS_PORT: '0',
            ACCESS_DATABASE_URL: scoped,
            ACCESS_ISSUER: 'https://access.example.com',
            ACCESS_ADMIN_TOKEN: 'the-admin-token-of-the-production',
            ACCESS_DECISION_TOKEN: 'the-access-token-of-the-production',
            ACCESS_ALLOW_MEMORY_STATE: 'true',
            ACCESS_STATE_SECRET: '4f9a2c8e'.repeat(8),
            ACCESS_SECRET_ENCRYPTION_KEY: 'b31e7d09'.repeat(8),
            ACCESS_SIGNING_KEY: privateKey,
            ACCESS_SIGNING_KID: 'the-kid-of-the-test',
          })
        )
        await runtime.close()
      } catch (error) {
        message = String(error)
      }
      // The role of the test is a superuser: the deployment refuses to
      // start with it.
      expect(message).toContain('bypasses the isolation of the tenants')
    },
    30_000
  )
})
