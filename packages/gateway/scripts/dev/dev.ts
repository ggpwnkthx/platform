#!/usr/bin/env bun
/**
 * The development runner.
 *
 * It starts everything that is needed to work on the gateway locally in a
 * single process:
 *
 *   - the identity provider   (the `oidc-provider` package, on :5556)
 *   - the access fixture      (:8090)
 *   - two sample upstreams    (:3000 and :3001)
 *   - the gateway itself      (:8080)
 *
 * The gateway is started through the same runtime as the container uses, so
 * the two behave the same. A change in the configuration is picked up by the
 * gateway itself, a change in the code restarts the process.
 */
import { generateKeyPairSync } from 'node:crypto'
import { readEnv } from '../../src/runtime/env'
import { createRuntime } from '../../src/runtime/composition'
import { publicKeyPem, asymmetricIdentityKey } from '../../src/domains/forwarding'
import { watchConfiguration } from '../../src/runtime/lifecycle'
import { startAccessService } from '../../services/fixtures/access-fixture'
import { startOidcProvider } from '../../services/fixtures/oidc-provider'
import { startUpstream } from '../../services/fixtures/upstream'

const GATEWAY_PORT = 8080
const IDP_PORT = 5556
const ACCESS_PORT = 8090
const UPSTREAM_A_PORT = 3000
const UPSTREAM_B_PORT = 3001

const OIDC_CLIENT_ID = 'gateway'
const OIDC_CLIENT_SECRET = 'gateway-secret'
const OIDC_REDIRECT_URI = `http://localhost:${GATEWAY_PORT}/auth/callback`

const DEV_ENV: Record<string, string> = {
  GATEWAY_CONFIG: './config/routes.dev.json',
  GATEWAY_PORT: String(GATEWAY_PORT),
  GATEWAY_HOST: '127.0.0.1',
  GATEWAY_OIDC_ISSUER: `http://localhost:${IDP_PORT}`,
  GATEWAY_OIDC_CLIENT_ID: OIDC_CLIENT_ID,
  GATEWAY_OIDC_CLIENT_SECRET: OIDC_CLIENT_SECRET,
  GATEWAY_OIDC_REDIRECT_URI: OIDC_REDIRECT_URI,
  GATEWAY_OIDC_SCOPES: 'openid,profile,email',
  GATEWAY_ACCESS_URL: `http://localhost:${ACCESS_PORT}`,
  GATEWAY_SESSION_SECRET: 'gateway-development-secret',
  GATEWAY_COOKIE_SECURE: 'false',
  GATEWAY_EXTERNAL_PROTO: 'http',
  GATEWAY_LOG_LEVEL: 'info',
}

async function main(): Promise<void> {
  // The development runner starts the fixtures, and the fixtures refuse to
  // run in a production environment.
  process.env.NODE_ENV = 'development'

  // The key of the signature of the identity is generated for the run: the
  // symmetric format of the earlier releases is removed, so the gateway
  // signs with the asymmetric one. The public key is printed below, so an
  // upstream of the development stack can verify the identities it
  // receives.
  const identityKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const identityKeyPem = identityKey.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const identityPublicKeyPem = publicKeyPem(asymmetricIdentityKey(identityKeyPem))

  const idp = await startOidcProvider({
    port: IDP_PORT,
    issuer: `http://localhost:${IDP_PORT}`,
    clientId: OIDC_CLIENT_ID,
    clientSecret: OIDC_CLIENT_SECRET,
    redirectUris: [OIDC_REDIRECT_URI],
  })

  const access = await startAccessService({ port: ACCESS_PORT })
  const upstreamA = await startUpstream({ name: 'upstream-a', port: UPSTREAM_A_PORT })
  const upstreamB = await startUpstream({ name: 'upstream-b', port: UPSTREAM_B_PORT })

  const settings = readEnv({
    ...process.env,
    ...DEV_ENV,
    GATEWAY_IDENTITY_SIGNING_KEY: identityKeyPem,
  })
  const runtime = await createRuntime(settings)
  const config = await Bun.file(settings.configPath).text()
  const loaded = runtime.config.applyText(config)
  if (!loaded.ok) {
    runtime.logger.error('the configuration of the development stack is invalid', {
      error: loaded.error,
    })
  }

  const watcher = watchConfiguration({
    store: runtime.config,
    logger: runtime.logger,
    observer: runtime.observer,
    path: settings.configPath,
  })
  await watcher.ready

  console.log('')
  console.log('  the gateway is starting up')
  console.log('  ─────────────────────────────────────────────')
  console.log(`  gateway        http://localhost:${GATEWAY_PORT}`)
  console.log(`  identity       ${idp.issuer}`)
  console.log('')
  console.log('  sign in with   alice@gateway.test / alice-password')
  console.log('  workspace      11111111-1111-4111-8111-111111111111')
  console.log(`  public route   http://localhost:${GATEWAY_PORT}/`)
  console.log(
    `  workspace API  http://localhost:${GATEWAY_PORT}/ws/11111111-1111-4111-8111-111111111111/`
  )
  console.log('')
  console.log('  The key of the identity signature is generated for this run.')
  console.log('  An upstream that verifies the identities of the stack needs')
  console.log('  the public key of this run:')
  console.log('')
  console.log(identityPublicKeyPem.trimEnd())
  console.log('')

  let stopping = false
  const stop = async (signal: string): Promise<void> => {
    if (stopping) return
    stopping = true
    await runtime.drain(signal)
    watcher.stop()
    await runtime.close()
    await Promise.all([idp.stop(), access.stop(), upstreamA.stop(), upstreamB.stop()])
    process.exit(0)
  }

  process.on('SIGINT', () => void stop('SIGINT'))
  process.on('SIGTERM', () => void stop('SIGTERM'))
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      level: 'error',
      msg: 'the development stack could not be started',
      error: error instanceof Error ? error.message : String(error),
    })
  )
  process.exit(1)
})
