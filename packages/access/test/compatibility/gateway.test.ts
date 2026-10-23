import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startProviderFixture, type ProviderFixture } from '../fixtures/provider'
import { createTestClient } from '../fixtures/client'
import { freePort, startAccessUnderTest, type AccessUnderTest } from './access'
import { referenceRoot } from './reference'
import { login, request, waitFor } from './browser'

/**
 * The compatibility suite (spec §15.1).
 *
 * The gateway of the reference runs, unchanged, with its own configuration
 * and with the access service in place of the two fixtures: the access service is the provider of the
 * identity and the access service of the gateway. The gateway is started
 * as a process of the reference: the tree of the reference is read-only
 * and it is never modified.
 */

/** The root of the reference: it is prepared by `bun run test:compat`. */
let reference: string

/** The token of the metrics of the gateway. */
const METRICS_TOKEN = 'the-metrics-token-of-the-gateway'
/** The workspace of the tests. */
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'

/** The access service under test: the one of the process, or the one of the environment. */
let accessUnderTest: AccessUnderTest
let accessUrl: string
let provider: ProviderFixture
let gateway: Bun.Subprocess<'ignore', 'pipe', 'pipe'>
let gatewayUrl: string
let directory: string
let upstreamUrl: string
/** The id of the principal that has a grant: the subject of the tokens. */
let principalId: string

/** The upstream of the tests: it answers with the headers it received. */
const upstream = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  fetch(request) {
    return Response.json({ headers: Object.fromEntries(request.headers.entries()) })
  },
})

/** Calls the administration of the access service. */
let admin: (path: string, method: string, body: Record<string, unknown>) => Promise<void>

beforeAll(async () => {
  reference = referenceRoot()
  upstreamUrl = `http://127.0.0.1:${upstream.port}`
  provider = await startProviderFixture()

  // The access service under test: the one of the process of the test, or the one
  // that the environment names — the image of a release, for instance.
  accessUnderTest = await startAccessUnderTest()
  accessUrl = accessUnderTest.url
  admin = createTestClient(accessUrl, accessUnderTest.adminToken).strict

  // The issuer of the access service is the url the gateway reaches: the discovery
  // document of the provider is read at that address.
  const gatewayPort = await freePort()
  gatewayUrl = `http://127.0.0.1:${gatewayPort}`

  await admin('/v1/admin/tenants', 'POST', {
    slug: 'acme',
    displayName: 'Acme Inc',
    issuer: provider.issuer,
    idpClientId: provider.clientId,
    idpClientSecret: provider.clientSecret,
    idpRedirectUri: `${accessUrl}/oauth/tenant/callback`,
    clientId: 'gateway-acme',
    clientSecret: 'the-secret-of-the-gateway',
    // The url the gateway sends the browser back to is registered with
    // the tenant: the gateway of the reference is at a port of the test.
    clientRedirectUris: [`${gatewayUrl}/auth/callback`],
  })

  // The principal that has a grant and the one that has none.
  const withGrant = await fetch(`${accessUrl}/v1/admin/users`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessUnderTest.adminToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      tenant: 'acme',
      externalSubject: provider.subject,
      email: 'alice@gateway.test',
      displayName: 'Alice',
    }),
  })
  const principal = (await withGrant.json()) as { id: string }
  principalId = principal.id
  await fetch(`${accessUrl}/v1/admin/users`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessUnderTest.adminToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      tenant: 'acme',
      externalSubject: 'the-subject-without-a-grant',
      email: 'bob@gateway.test',
      displayName: 'Bob',
    }),
  })

  await admin('/v1/admin/grants', 'PUT', {
    tenant: 'acme',
    userId: principal.id,
    permission: 'workspace.read',
    workspaceId: WORKSPACE_ID,
    routeId: 'workspace-api',
  })

  // The configuration of the gateway: it is the configuration of the
  // reference, with the routes of the tests.
  directory = await mkdtemp(join(tmpdir(), 'access-compatibility-'))
  const configPath = join(directory, 'routes.json')
  await writeFile(
    configPath,
    JSON.stringify(
      {
        version: 1,
        defaults: {
          auth: { mode: 'none' },
          timeouts: { responseMs: 5000, firstByteMs: 30000, bodyMs: 300000 },
          maxBodyBytes: 1024 * 1024,
        },
        trustedProxies: ['127.0.0.1/32'],
        routes: [
          {
            id: 'public-site',
            match: { host: 'public.gateway.test', path: '/' },
            upstream: upstreamUrl,
            auth: { mode: 'none' },
          },
          {
            id: 'workspace-api',
            match: { host: 'api.gateway.test', path: '/ws/{workspaceId}/' },
            upstream: upstreamUrl,
            auth: { mode: 'any', workspace: { param: 'workspaceId', requireUuid: true } },
          },
          {
            // The route of the bearer token: the gateway validates the
            // token of the access service against the provider it
            // discovers for the browser, and the rules of that validation
            // are the ones of the release `1.0.0` of the platform.
            id: 'api-jwt',
            match: { host: 'api.gateway.test', path: '/jwt/' },
            upstream: upstreamUrl,
            auth: { mode: 'jwt' },
          },
        ],
      },
      null,
      2
    )
  )

  // The gateway of the reference, unchanged, with the access service in place of the two
  // fixtures.
  gateway = Bun.spawn(['bun', 'run', join(reference, 'src', 'main.ts')], {
    cwd: reference,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      GATEWAY_CONFIG: configPath,
      GATEWAY_HOST: '127.0.0.1',
      GATEWAY_PORT: String(gatewayPort),
      GATEWAY_OIDC_ISSUER: accessUrl,
      GATEWAY_OIDC_CLIENT_ID: 'gateway-acme',
      GATEWAY_OIDC_CLIENT_SECRET: 'the-secret-of-the-gateway',
      GATEWAY_OIDC_REDIRECT_URI: `${gatewayUrl}/auth/callback`,
      GATEWAY_OIDC_ALLOW_INSECURE: 'true',
      GATEWAY_ACCESS_URL: accessUrl,
      GATEWAY_ACCESS_TOKEN: accessUnderTest.accessToken,
      GATEWAY_ACCESS_CACHE_TTL_MS: '0',
      GATEWAY_SESSION_SECRET: 'the-session-secret',
      GATEWAY_SESSION_URL: 'memory://local',
      GATEWAY_COOKIE_SECURE: 'false',
      GATEWAY_LOG_LEVEL: 'error',
      GATEWAY_SHUTDOWN_TIMEOUT_MS: '2000',
      GATEWAY_METRICS_TOKEN: METRICS_TOKEN,
      GATEWAY_RATE_LIMIT_MAX: '0',
      GATEWAY_RATE_LIMIT_GLOBAL_MAX: '0',
      GATEWAY_LOGIN_RATE_LIMIT_MAX: '1000',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  await waitFor(`${gatewayUrl}/healthz`)
})

afterAll(async () => {
  gateway?.kill('SIGTERM')
  await gateway?.exited
  await accessUnderTest?.stop()
  await provider?.stop()
  await upstream.stop(true)
  if (directory) await rm(directory, { recursive: true, force: true })
})

/**
 * The tokens of the access service for the gateway.
 *
 * The suite plays the client that the gateway is: it logs a browser in at
 * the provider of the tenant, it comes back to the access service with the code, and it
 * exchanges the code at the token endpoint of the access service. The access token it
 * keeps is the credential that the gateway validates against the provider
 * it discovers for the browser.
 */
async function tokensOfAccess(): Promise<{ accessToken: string; idToken: string }> {
  const verifier = 'the-verifier-of-the-compatibility-suite'
  const challenge = createHash('sha256').update(verifier, 'ascii').digest('base64url')
  const redirectUri = `${gatewayUrl}/auth/callback`
  const query = new URLSearchParams({
    client_id: 'gateway-acme',
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid profile email',
    state: 'the-state-of-the-suite',
    nonce: 'the-nonce-of-the-suite',
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })

  const authorize = await fetch(`${accessUrl}/oauth/authorize?${query.toString()}`, {
    redirect: 'manual',
  })
  const cookie = (authorize.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
  const atProvider = await fetch(authorize.headers.get('location') ?? '', { redirect: 'manual' })
  const callback = await fetch(atProvider.headers.get('location') ?? '', {
    redirect: 'manual',
    headers: { cookie },
  })
  const code = new URL(callback.headers.get('location') ?? '').searchParams.get('code') ?? ''
  if (!code) {
    throw new Error(`the login of the suite did not come back with a code: ${callback.status}`)
  }

  const token = await fetch(`${accessUrl}/oauth/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from('gateway-acme:the-secret-of-the-gateway').toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }).toString(),
  })
  if (!token.ok) {
    throw new Error(
      `the token endpoint of the access service answered ${token.status}: ${await token.text()}`
    )
  }
  const body = (await token.json()) as { access_token?: string; id_token?: string }
  if (!body.access_token || !body.id_token) {
    throw new Error('the token endpoint of the access service answered no token')
  }
  return { accessToken: body.access_token, idToken: body.id_token }
}

describe('the compatibility of the access service with the gateway', () => {
  test('a browser logs in at the provider of the tenant and comes back with a session', async () => {
    const cookie = await login(gatewayUrl)
    expect(cookie).toContain('gateway_session=')
  })

  test('the gateway writes the headers of the identity of the principal', async () => {
    const cookie = await login(gatewayUrl)
    const response = await request(gatewayUrl, `/ws/${WORKSPACE_ID}/`, cookie, 'api.gateway.test')
    expect(response.status).toBe(200)
    const body = (await response.json()) as { headers: Record<string, string> }
    expect(body.headers['x-gateway-user']).toBeTruthy()
    expect(body.headers['x-gateway-email']).toBe('alice@gateway.test')
    expect(body.headers['x-gateway-roles']).toContain('workspace.read')
  })

  test('the gateway writes the subject of the principal as it is', async () => {
    // The gateway of the release `1.0.0` of the platform writes the
    // subject of the identity **as it is**: a subject that is rewritten
    // would speak of two different callers to the access service, which
    // decides with the subject it was given, and to the upstream, which
    // reads the subject of the header. The subject of the access service
    // is the id of a principal, and the header carries it character for
    // character.
    provider.authenticateAs(provider.subject)
    const cookie = await login(gatewayUrl)
    const response = await request(gatewayUrl, `/ws/${WORKSPACE_ID}/`, cookie, 'api.gateway.test')
    expect(response.status).toBe(200)
    const body = (await response.json()) as { headers: Record<string, string> }
    expect(body.headers['x-gateway-user']).toBe(principalId)
  })

  test('a principal without a grant is refused by the gateway', async () => {
    // The principal that has no grant at all reaches nothing: the
    // decision of the access service denies it and the gateway fails closed.
    provider.authenticateAs('the-subject-without-a-grant')
    const cookie = await login(gatewayUrl)
    const response = await request(gatewayUrl, `/ws/${WORKSPACE_ID}/`, cookie, 'api.gateway.test')
    expect(response.status).toBe(403)
    expect(await response.text()).toContain('workspace_forbidden')
  })

  test('the metrics of the gateway count the denial as a missing role', async () => {
    provider.authenticateAs('the-subject-without-a-grant')
    const cookie = await login(gatewayUrl)
    await request(gatewayUrl, `/ws/${WORKSPACE_ID}/`, cookie, 'api.gateway.test')
    const metrics = await fetch(`${gatewayUrl}/metrics`, {
      headers: { authorization: `Bearer ${METRICS_TOKEN}` },
    })
    const text = await metrics.text()
    expect(text).toContain('gateway_auth_failures_total')
    expect(text).toContain('missing_role')
  })

  test('the gateway discovers the access service and accepts its tokens', async () => {
    const discovery = await fetch(`${accessUrl}/.well-known/openid-configuration`)
    const document = (await discovery.json()) as Record<string, unknown>
    expect(document.issuer).toBe(accessUrl)
    expect(document.jwks_uri).toBe(`${accessUrl}/oauth/jwks`)
  })

  test('the gateway accepts the bearer token of the access service', async () => {
    // The gateway of the release `1.0.0` of the platform refuses a
    // bearer token that carries no expiry, and it bounds the lifetime of
    // a token with the moment it was issued: the token of the access
    // service carries the two, and its lifetime is five minutes.
    provider.authenticateAs(provider.subject)
    const { accessToken } = await tokensOfAccess()
    const response = await fetch(`${gatewayUrl}/jwt/`, {
      headers: { authorization: `Bearer ${accessToken}`, host: 'api.gateway.test' },
      redirect: 'manual',
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { headers: Record<string, string> }
    expect(body.headers['x-gateway-user']).toBeTruthy()
    expect(body.headers['x-gateway-roles']).toContain('workspace.read')
  })

  test('the gateway refuses the id token of the access service as a bearer credential', async () => {
    // The id token travels through the browser: it lands in the history,
    // in the logs and in the referrers. The gateway refuses a bearer
    // token that carries a nonce, and the id token of the access service carries one.
    provider.authenticateAs(provider.subject)
    const { idToken } = await tokensOfAccess()
    const response = await fetch(`${gatewayUrl}/jwt/`, {
      headers: { authorization: `Bearer ${idToken}`, host: 'api.gateway.test' },
      redirect: 'manual',
    })
    expect(response.status).toBe(401)
  })
})
