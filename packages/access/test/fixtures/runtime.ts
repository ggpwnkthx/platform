/**
 * The runtime of the tests of the http surface.
 *
 * A test of the contract starts a deployment of Access in the process of the
 * test, reaches it at a url of the loopback and stops it when it is
 * done. The three steps are the same in every file of the suite: they
 * live here, once, and the file of the test says what is specific to it.
 */

import { createRuntime, type AccessRuntime } from '../../src/runtime/composition'
import { readEnv, type Env } from '../../src/runtime/env'

/**
 * The environment that every deployment of the tests shares.
 *
 * The database is the embedded PostgreSQL of the process: the tests need
 * no server and they run the migrations of the production. The port is
 * zero: the operating system names a free port of the loopback.
 */
const TEST_ENV: Env = {
  ACCESS_HOST: '127.0.0.1',
  ACCESS_PORT: '0',
  ACCESS_DATABASE_URL: 'pglite://memory://',
}

/** The key of the secrets of the deployments of the tests. */
/** The key of the secrets of the deployments of the tests. */
export const TEST_ENCRYPTION_KEY = 'a'.repeat(64)

/** The secret of the state of the deployments of the tests. */
const TEST_STATE_SECRET = 'b'.repeat(64)

/** A deployment of Access that a test started. */
export interface TestRuntime {
  /** The runtime of the service. */
  runtime: AccessRuntime
  /** The url the callers reach the service at. */
  base: string
  /** Stops the listener and closes the database of the service. */
  stop: () => Promise<void>
}

/**
 * The environment of a deployment that serves the login of a tenant.
 *
 * The key of the service is the one of the file: every file signs with
 * its own key, and the rest of the environment is the same.
 */
export function loginEnv(adminToken: string, signingKey: string): Env {
  return {
    ACCESS_ADMIN_TOKEN: adminToken,
    ACCESS_SECRET_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
    ACCESS_STATE_SECRET: TEST_STATE_SECRET,
    ACCESS_ISSUER: 'https://access.example.com',
    ACCESS_SIGNING_KEY: signingKey,
    ACCESS_SIGNING_KID: 'access-1',
  }
}

/**
 * Starts a deployment of Access in the process of the test.
 *
 * The environment of the deployment is the one of the tests, and the
 * values of the caller are merged into it: a test that needs a token or
 * a key of its own names it, and nothing else changes.
 */
export async function startTestRuntime(env: Env = {}): Promise<TestRuntime> {
  const runtime = await createRuntime(readEnv({ ...TEST_ENV, ...env }))
  const base = `http://127.0.0.1:${runtime.listener.port}`
  return {
    runtime,
    base,
    stop: async () => {
      await runtime.listener.stop(true)
      await runtime.database.close()
    },
  }
}
