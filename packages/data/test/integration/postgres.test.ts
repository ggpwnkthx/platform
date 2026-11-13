import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Client } from 'pg'
import { resolve } from 'node:path'
import { testDatabase, type TestDatabase } from '../helpers/database'
import {
  detectDrift,
  loadMigrations,
  verifyMigrations,
} from '../../src/platform/postgres/migrations'
import { ConnectionPool, roleOf } from '../../src/platform/postgres/database'
import { parseManifestBundle } from '../../src/domains/schema'

let database: TestDatabase
let runtime: Client
let owner: Client

beforeAll(async () => {
  database = await testDatabase()
  await database.reset()
  await database.seed([
    {
      id: '22222222-2222-4222-8222-222222222222',
      tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      slug: 'acme',
    },
    {
      id: '33333333-3333-4333-8333-333333333333',
      tenantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      slug: 'other',
    },
  ])
  runtime = new Client({ connectionString: database.runtimeUrl })
  owner = new Client({ connectionString: database.ownerUrl })
  await runtime.connect()
  await owner.connect()
})

afterAll(async () => {
  await runtime?.end()
  await owner?.end()
})

/** Inserts a row of a collection. */
async function insertArticle(
  client: Client,
  values: {
    tenantId: string
    workspaceId: string
    id?: string
    title?: string
    categoryId?: string | null
  }
): Promise<string> {
  const id = values.id ?? crypto.randomUUID()
  await client.query(
    `insert into data.articles (id, tenant_id, workspace_id, created_by, updated_by, title, category_id)
     values ($1::uuid, $2::uuid, $3::uuid, '11111111-1111-4111-8111-111111111111'::uuid,
             '11111111-1111-4111-8111-111111111111'::uuid, $4, $5::uuid)`,
    [id, values.tenantId, values.workspaceId, values.title ?? 'Article', values.categoryId ?? null]
  )
  return id
}

describe('the isolation of the rows', () => {
  test('a statement without a scope sees nothing', async () => {
    const result = await runtime.query('select count(*)::text as count from data.articles')
    expect(result.rows[0].count).toBe('0')
  })

  test('a statement of a tenant sees the rows of its tenant only', async () => {
    await owner.query(
      `insert into data.articles (id, tenant_id, workspace_id, created_by, updated_by, title)
       values ('44444444-4444-4444-8444-444444444444'::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
               '22222222-2222-4222-8222-222222222222'::uuid, '11111111-1111-4111-8111-111111111111'::uuid,
               '11111111-1111-4111-8111-111111111111'::uuid, 'One')`
    )
    await runtime.query('begin')
    await runtime.query(
      `select set_config('data.tenant_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true),
              set_config('data.workspace_id', '22222222-2222-4222-8222-222222222222', true)`
    )
    const result = await runtime.query('select count(*)::text as count from data.articles')
    expect(result.rows[0].count).toBe('1')
    await runtime.query('commit')
  })

  test('a statement of another workspace sees nothing', async () => {
    await runtime.query('begin')
    await runtime.query(
      `select set_config('data.tenant_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true),
              set_config('data.workspace_id', '33333333-3333-4333-8333-333333333333', true)`
    )
    const result = await runtime.query('select count(*)::text as count from data.articles')
    expect(result.rows[0].count).toBe('0')
    await runtime.query('commit')
  })

  test('a pooled connection does not keep the scope of a transaction', async () => {
    const pool = new ConnectionPool({
      url: database.runtimeUrl,
      max: 1,
      statementTimeoutMs: 3000,
      acquireTimeoutMs: 2000,
      applicationName: 'test-pool',
    })
    const client = await pool.acquire()
    await client.query('begin')
    await client.query(
      `select set_config('data.tenant_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true),
              set_config('data.workspace_id', '22222222-2222-4222-8222-222222222222', true)`
    )
    await client.query('commit')
    client.release()
    const again = await pool.acquire()
    const result = await again.query('select count(*)::text as count from data.articles')
    expect(result.rows[0].count).toBe('0')
    again.release()
    await pool.close()
  })
})

describe('the relations of the collections', () => {
  test('a reference to another workspace is refused', async () => {
    await owner.query(
      `insert into data.categories (id, tenant_id, workspace_id, created_by, updated_by, name)
       values ('55555555-5555-4555-8555-555555555555'::uuid, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,
               '33333333-3333-4333-8333-333333333333'::uuid, '11111111-1111-4111-8111-111111111111'::uuid,
               '11111111-1111-4111-8111-111111111111'::uuid, 'Other')`
    )
    let refused = false
    try {
      await insertArticle(owner, {
        tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        workspaceId: '22222222-2222-4222-8222-222222222222',
        categoryId: '55555555-5555-4555-8555-555555555555',
      })
    } catch (error) {
      refused = true
      expect((error as { code?: string }).code).toBe('23503')
    }
    expect(refused).toBe(true)
  })
})

describe('the privileges of the roles', () => {
  test('the role of the api is not a superuser and does not bypass the policies', async () => {
    const pool = new ConnectionPool({
      url: database.runtimeUrl,
      max: 1,
      statementTimeoutMs: 3000,
      acquireTimeoutMs: 2000,
      applicationName: 'test-role',
    })
    const role = await roleOf(pool)
    expect(role.superuser).toBe(false)
    expect(role.bypassesRowLevelSecurity).toBe(false)
    await pool.close()
  })

  test('the role of the api may not read the registry beyond its three columns', async () => {
    let refused = false
    try {
      await runtime.query('select slug from platform.workspaces')
    } catch (error) {
      refused = true
      expect((error as { code?: string }).code).toBe('42501')
    }
    expect(refused).toBe(true)
  })

  test('the role of the api may not alter the schema', async () => {
    let refused = false
    try {
      await runtime.query('alter table data.articles add column extra text')
    } catch (error) {
      refused = true
      expect((error as { code?: string }).code).toBe('42501')
    }
    expect(refused).toBe(true)
  })

  test('the role of the api may not change the history of the audit log', async () => {
    let refused = false
    try {
      await runtime.query('delete from platform.audit_entries')
    } catch (error) {
      refused = true
      expect((error as { code?: string }).code).toBe('42501')
    }
    expect(refused).toBe(true)
  })

  test('the role of the api may not read the deliveries', async () => {
    let refused = false
    try {
      await runtime.query('select * from platform.outbox_deliveries')
    } catch (error) {
      refused = true
      expect((error as { code?: string }).code).toBe('42501')
    }
    expect(refused).toBe(true)
  })

  test('the role of the deliveries may not read a business record', async () => {
    const delivery = new Client({ connectionString: database.deliveryUrl })
    await delivery.connect()
    let refused = false
    try {
      await delivery.query('select * from data.articles')
    } catch (error) {
      refused = true
      expect((error as { code?: string }).code).toBe('42501')
    }
    expect(refused).toBe(true)
    await delivery.end()
  })
})

describe('the isolation of the outbox', () => {
  const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  const WORKSPACE_A = '22222222-2222-4222-8222-222222222222'
  const WORKSPACE_B = '33333333-3333-4333-8333-333333333333'
  const EVENT_A = '44444444-4444-4444-8444-444444444444'
  const EVENT_B = '55555555-5555-4555-8555-555555555555'

  /** Writes one event, and one delivery of it. */
  async function seedEvent(id: string, tenantId: string, workspaceId: string): Promise<void> {
    await owner.query(
      `insert into platform.outbox_events
         (id, version, type, tenant_id, workspace_id, collection, record_id, record_version,
          actor_id, occurred_at, changed_fields, correlation_id, causation_depth, payload)
       values ($1::uuid, 1, 'record.created', $2::uuid, $3::uuid, 'articles',
               '66666666-6666-4666-8666-666666666666'::uuid, 1,
               '11111111-1111-4111-8111-111111111111'::uuid, now(), '{}', $1::text, 0, '{}'::jsonb)`,
      [id, tenantId, workspaceId]
    )
  }

  /** Writes a delivery of an event, with a subscriber of its own. */
  async function seedDelivery(
    eventId: string,
    subscriber: string,
    tenantId: string,
    workspaceId: string
  ): Promise<void> {
    await owner.query(
      `insert into platform.outbox_deliveries
         (event_id, subscriber_id, tenant_id, workspace_id, state, attempts, next_attempt_at,
          created_at, updated_at)
       values ($1::uuid, $2, $3::uuid, $4::uuid, 'pending', 0, now(), now(), now())`,
      [eventId, subscriber, tenantId, workspaceId]
    )
  }

  /** Reads the events with the role of the api, in a scope. */
  async function readEventsAsRuntime(tenantId: string | null, workspaceId: string | null) {
    await runtime.query('begin')
    try {
      if (tenantId !== null && workspaceId !== null) {
        await runtime.query(
          `select set_config('data.tenant_id', $1, true), set_config('data.workspace_id', $2, true)`,
          [tenantId, workspaceId]
        )
      }
      return await runtime.query('select id, tenant_id from platform.outbox_events order by id')
    } finally {
      await runtime.query('rollback')
    }
  }

  beforeAll(async () => {
    await seedEvent(EVENT_A, TENANT_A, WORKSPACE_A)
    await seedEvent(EVENT_B, TENANT_B, WORKSPACE_B)
    await seedDelivery(EVENT_B, 'the-seeded-subscriber', TENANT_B, WORKSPACE_B)
  })

  test('the role of the api may not read the events of the platform', async () => {
    // The events are the metadata of the writes of the tenants. The
    // role of the api writes them and never reads them: the worker
    // reads them, with the role of the delivery.
    let refused = false
    try {
      await readEventsAsRuntime(TENANT_A, WORKSPACE_A)
    } catch (error) {
      refused = true
      expect((error as { code?: string }).code).toBe('42501')
    }
    expect(refused).toBe(true)
  })

  test('the role of the api reads no event without a scope either', async () => {
    let refused = false
    try {
      await readEventsAsRuntime(null, null)
    } catch (error) {
      refused = true
      expect((error as { code?: string }).code).toBe('42501')
    }
    expect(refused).toBe(true)
  })

  test('the role of the api may not write a delivery of another tenant', async () => {
    await runtime.query('begin')
    try {
      await runtime.query(
        `select set_config('data.tenant_id', $1, true), set_config('data.workspace_id', $2, true)`,
        [TENANT_A, WORKSPACE_A]
      )
      let refused = false
      try {
        await runtime.query(
          `insert into platform.outbox_deliveries
             (event_id, subscriber_id, tenant_id, workspace_id, state, attempts, next_attempt_at,
              created_at, updated_at)
           values ($1::uuid, 'the-other-subscriber', $2::uuid, $3::uuid, 'pending', 0, now(), now(),
                   now())`,
          [EVENT_B, TENANT_B, WORKSPACE_B]
        )
      } catch (_error) {
        refused = true
      }
      expect(refused).toBe(true)
    } finally {
      await runtime.query('rollback')
    }
  })

  test('the role of the api writes the deliveries of its own tenant', async () => {
    await runtime.query('begin')
    try {
      await runtime.query(
        `select set_config('data.tenant_id', $1, true), set_config('data.workspace_id', $2, true)`,
        [TENANT_A, WORKSPACE_A]
      )
      const written = await runtime.query(
        `insert into platform.outbox_deliveries
           (event_id, subscriber_id, tenant_id, workspace_id, state, attempts, next_attempt_at,
            created_at, updated_at)
         values ($1::uuid, 'the-own-subscriber', $2::uuid, $3::uuid, 'pending', 0, now(), now(),
                 now())`,
        [EVENT_A, TENANT_A, WORKSPACE_A]
      )
      expect(written.rowCount).toBe(1)
    } finally {
      await runtime.query('rollback')
    }
  })

  test('the role of the deliveries reads the events of every tenant', async () => {
    const delivery = new Client({ connectionString: database.deliveryUrl })
    await delivery.connect()
    try {
      const rows = await delivery.query('select id from platform.outbox_events order by id')
      expect(rows.rows.map((row) => row.id)).toEqual([EVENT_A, EVENT_B])
    } finally {
      await delivery.end()
    }
  })

  test('no policy that widens a scope is given to the role of the api', async () => {
    // The policies of the tables of the backend are combined with a
    // logical or, so a policy that holds every row of one table undoes
    // the policy that holds the rows of the scope. Every policy that
    // applies to the role of the api, or to every role, must therefore
    // hold the scope of the transaction.
    const policies = await owner.query<{
      tablename: string
      policyname: string
      roles: string
      qual: string | null
    }>(
      `select c.relname as tablename, p.polname as policyname,
              p.polroles::text as roles, pg_get_expr(p.polqual, p.polrelid) as qual
         from pg_policy p
         join pg_class c on c.oid = p.polrelid
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname in ('data', 'platform')
          and (p.polroles = '{0}'::oid[] or 'data_runtime'::regrole = any(p.polroles))
          and p.polpermissive
          and p.polqual is not null
          and pg_get_expr(p.polqual, p.polrelid) !~ 'current_setting'`
    )
    expect(policies.rows).toEqual([])
  })
})

describe('the migrations and the drift', () => {
  test('the applied migrations are the ones of the repository', async () => {
    const pool = new ConnectionPool({
      url: database.ownerUrl,
      max: 1,
      statementTimeoutMs: 10_000,
      acquireTimeoutMs: 2000,
      applicationName: 'test-migrations',
    })
    const migrations = await loadMigrations(resolve(import.meta.dir, '..', '..', 'migrations'))
    await verifyMigrations(pool, migrations)
    await pool.close()
  })

  test('a manifest that does not match the schema is a drift', async () => {
    const pool = new ConnectionPool({
      url: database.ownerUrl,
      max: 1,
      statementTimeoutMs: 10_000,
      acquireTimeoutMs: 2000,
      applicationName: 'test-drift',
    })
    const manifest = parseManifestBundle(await Bun.file('manifests/schema.json').text())
    const problems = await detectDrift(pool, manifest)
    expect(problems).toEqual([])
    const broken = {
      ...manifest,
      collections: manifest.collections.map((collection) =>
        collection.key === 'articles'
          ? {
              ...collection,
              fields: {
                ...collection.fields,
                missing_field: { type: 'string' as const, required: false, nullable: true },
              },
            }
          : collection
      ),
    }
    const detected = await detectDrift(pool, broken)
    expect(detected.some((problem) => problem.includes('missing_field'))).toBe(true)
    await pool.close()
  })
})
