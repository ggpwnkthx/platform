/**
 * The readiness of the process.
 *
 * The readiness is the last gate of the service: it is the one that
 * refuses a deployment whose database does not hold what the deployment
 * expects. Three facts are checked there, and each of them is a defect
 * that the ledger of the migrations cannot see:
 *
 * - the role of the connection owns no table of the deployment, and it
 *   is not a member of the role that owns them. The owner of a table may
 *   turn its policies off, and a member of the owner holds what the
 *   owner holds.
 * - the schema of the deployment is the schema of the files: a column
 *   that is missing, a column of another type and a table whose
 *   isolation was turned off are a drift.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { testDatabase, type TestDatabase } from '../helpers/database'
import { ConnectionPool } from '../../src/platform/postgres/database'
import { loadMigrations } from '../../src/platform/postgres/migrations'
import { parseManifestBundle } from '../../src/domains/schema'
import { Readiness } from '../../src/runtime/readiness'
import type { Logger } from '../../src/observability/logger'

let database: TestDatabase
let runtime: ConnectionPool
let owner: ConnectionPool

/** A logger that writes nothing. */
const silent: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silent,
}

/** Builds a readiness for a pool. */
async function readinessOf(pool: ConnectionPool): Promise<Readiness> {
  const migrations = await loadMigrations(resolve(import.meta.dir, '..', '..', 'migrations'))
  const manifest = parseManifestBundle(
    await Bun.file(resolve(import.meta.dir, '..', '..', 'manifests', 'schema.json')).text()
  )
  return new Readiness({
    pool,
    migrations,
    manifest,
    access: { discover: async () => ({ versions: [1] }) },
    logger: silent,
    clock: { now: () => Date.now() },
    worker: false,
    subscriberCount: 0,
  })
}

beforeAll(async () => {
  database = await testDatabase()
  runtime = new ConnectionPool({
    url: database.runtimeUrl,
    max: 1,
    statementTimeoutMs: 5000,
    acquireTimeoutMs: 2000,
    applicationName: 'test-readiness-runtime',
  })
  owner = new ConnectionPool({
    url: database.ownerUrl,
    max: 1,
    statementTimeoutMs: 5000,
    acquireTimeoutMs: 2000,
    applicationName: 'test-readiness-owner',
  })
})

afterAll(async () => {
  await runtime?.close()
  await owner?.close()
})

describe('the readiness of the service', () => {
  test('the role of the api is ready', async () => {
    const state = await (await readinessOf(runtime)).check()
    expect(state.ready).toBe(true)
  })

  test('the role that owns the tables is not ready', async () => {
    const state = await (await readinessOf(owner)).check()
    expect(state.ready).toBe(false)
    expect(state.reason).toContain('owns the tables of the deployment')
  })

  test('a table whose isolation was turned off is a drift', async () => {
    await owner.query('alter table data.articles disable row level security')
    try {
      const state = await (await readinessOf(runtime)).check()
      expect(state.ready).toBe(false)
      expect(state.reason).toContain('drifted')
      expect(state.reason).toContain('does not force its row level security')
    } finally {
      await owner.query('alter table data.articles enable row level security')
      await owner.query('alter table data.articles force row level security')
    }
  })

  test('the service is ready again when the isolation is restored', async () => {
    const state = await (await readinessOf(runtime)).check()
    expect(state.ready).toBe(true)
  })
})
