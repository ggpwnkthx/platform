import { generateKeyPairSync } from 'node:crypto'
import { createRuntime, type AccessRuntime } from '../../src/runtime/composition'
import { readEnv } from '../../src/runtime/env'

/**
 * The access service under test.
 *
 * The suite runs against an access service that it starts itself, in the process of
 * the test: it is the fast way, and it is the way a developer runs it.
 *
 * The suite can also run against an access service that is **already running** — the
 * image of a release, for instance — when the environment names it:
 *
 *   ACCESS_EXTERNAL_URL           the url the callers reach that the access service at
 *   ACCESS_EXTERNAL_ADMIN_TOKEN   the token of its administration
 *   ACCESS_EXTERNAL_ACCESS_TOKEN  the token of its decisions
 *
 * The suite never creates what the environment names: a suite that is
 * supposed to prove the image of a release has to talk to that image,
 * and a suite that talks to another the access service proves nothing about it.
 */

/** The access service under test. */
export interface AccessUnderTest {
  /** The url the callers reach the access service at. */
  url: string
  /** The token of the administration of the access service. */
  adminToken: string
  /** The token of the decisions of the access service. */
  accessToken: string
  /** True when the access service runs in the process of the test. */
  local: boolean
  /** Stops the access service, when the suite is the one that started it. */
  stop: () => Promise<void>
}

/** Finds a free port. */
export async function freePort(): Promise<number> {
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('ok') })
  const port = server.port ?? 0
  await server.stop(true)
  return port
}

/**
 * The access service that the suite runs against.
 *
 * The environment decides: a running access service when it is named, an access service of the
 * process of the test otherwise.
 */
export async function startAccessUnderTest(): Promise<AccessUnderTest> {
  const external = process.env.ACCESS_EXTERNAL_URL?.trim()
  if (external) {
    const adminToken = process.env.ACCESS_EXTERNAL_ADMIN_TOKEN?.trim()
    const accessToken = process.env.ACCESS_EXTERNAL_ACCESS_TOKEN?.trim()
    if (!adminToken) {
      throw new Error(
        'ACCESS_EXTERNAL_URL is set and ACCESS_EXTERNAL_ADMIN_TOKEN is not: the suite administers the access service it is given'
      )
    }
    if (!accessToken) {
      throw new Error(
        'ACCESS_EXTERNAL_URL is set and ACCESS_EXTERNAL_ACCESS_TOKEN is not: the gateway of the reference asks the access service it is given for its decisions'
      )
    }
    return {
      url: external,
      adminToken,
      accessToken,
      local: false,
      stop: async () => {
        // The access service is not ours: it is not ours to stop.
      },
    }
  }

  const port = await freePort()
  const url = `http://127.0.0.1:${port}`
  const signingKey = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  }).privateKey

  const access: AccessRuntime = await createRuntime(
    readEnv({
      ACCESS_HOST: '127.0.0.1',
      ACCESS_PORT: String(port),
      ACCESS_ISSUER: url,
      ACCESS_PUBLIC_URL: url,
      ACCESS_DATABASE_URL: 'pglite://memory://',
      ACCESS_ADMIN_TOKEN: 'the-admin-token',
      ACCESS_DECISION_TOKEN: 'the-access-token-of-the-access-service',
      ACCESS_SECRET_ENCRYPTION_KEY: 'a'.repeat(64),
      ACCESS_STATE_SECRET: 'b'.repeat(64),
      ACCESS_SIGNING_KEY: signingKey,
      ACCESS_SIGNING_KID: 'access-1',
    })
  )

  return {
    url,
    adminToken: 'the-admin-token',
    accessToken: 'the-access-token-of-the-access-service',
    local: true,
    stop: async () => {
      await access.listener.stop(true)
      await access.database.close()
    },
  }
}
