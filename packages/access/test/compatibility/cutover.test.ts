import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startProviderFixture, type ProviderFixture } from '../fixtures/provider'
import { createTestClient } from '../fixtures/client'
import { freePort, startAccessUnderTest, type AccessUnderTest } from './access'
import { referenceRoot } from './reference'
import { login, request, waitFor } from './browser'

/**
 * The rehearsal of the cutover of a tenant (docs/access/operations.md, "Tenant cutover").
 *
 * The rehearsal is the cutover, played against the gateway of the
 * reference, unchanged. It follows the phases of the runbook:
 *
 * 1. the tenant is registered,
 * 2. the principals are registered,
 * 3. the grants are registered,
 * 4. the check: a browser logs in at the provider of the tenant and
 *    reaches an upstream of the gateway,
 * 5. the way back: the grant is revoked and the access ends,
 * 6. the tenant is switched again without registering anything.
 *
 * The rehearsal is what makes the checklist of the cutover a list of
 * facts instead of a list of hopes.
 */

/** The root of the reference: it is prepared by `bun run test:compat`. */
let reference: string

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'

/**
 * The tenant of the rehearsal.
 *
 * The name of the tenant is unique per run: the rehearsal is a
 * *creation*, and an access service that keeps its rows between two runs would
 * answer "200, updated" instead of "201, created". The client of the
 * gateway is named after it: a client id belongs to one tenant.
 */
const TENANT_SLUG = `acme-cutover-${crypto.randomUUID().slice(0, 8)}`
const CLIENT_ID = `gateway-${TENANT_SLUG}`

/** The access service under test: the one of the process, or the one of the environment. */
let accessUnderTest: AccessUnderTest
let accessUrl: string
let provider: ProviderFixture
let gateway: Bun.Subprocess<'ignore', 'pipe', 'pipe'>
let gatewayUrl: string
let directory: string
let upstreamUrl: string

const upstream = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  fetch(request) {
    return Response.json({ headers: Object.fromEntries(request.headers.entries()) })
  },
})

/** Calls the administration of the access service. */
let admin: (
  path: string,
  method: string,
  body?: Record<string, unknown>
) => Promise<{ status: number; body: Record<string, unknown> }>

beforeAll(async () => {
  reference = referenceRoot()
  upstreamUrl = `http://127.0.0.1:${upstream.port}`
  provider = await startProviderFixture()

  // The access service under test: the one of the process of the test, or the one
  // that the environment names — the image of a release, for instance.
  accessUnderTest = await startAccessUnderTest()
  accessUrl = accessUnderTest.url
  admin = createTestClient(accessUrl, accessUnderTest.adminToken).call

  const gatewayPort = await freePort()
  gatewayUrl = `http://127.0.0.1:${gatewayPort}`

  directory = await mkdtemp(join(tmpdir(), 'access-cutover-'))
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
            id: 'workspace-api',
            match: { host: 'api.gateway.test', path: '/ws/{workspaceId}/' },
            upstream: upstreamUrl,
            auth: { mode: 'any', workspace: { param: 'workspaceId', requireUuid: true } },
          },
        ],
      },
      null,
      2
    )
  )

  gateway = Bun.spawn(['bun', 'run', join(reference, 'src', 'main.ts')], {
    cwd: reference,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      GATEWAY_CONFIG: configPath,
      GATEWAY_HOST: '127.0.0.1',
      GATEWAY_PORT: String(gatewayPort),
      GATEWAY_OIDC_ISSUER: accessUrl,
      GATEWAY_OIDC_CLIENT_ID: CLIENT_ID,
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

describe('the rehearsal of the cutover of a tenant', () => {
  test('the tenant, its principal and its grant are registered', async () => {
    // Phase 1: the tenant is registered.
    const tenant = await admin('/v1/admin/tenants', 'POST', {
      slug: TENANT_SLUG,
      displayName: 'Acme Inc',
      issuer: provider.issuer,
      idpClientId: provider.clientId,
      idpClientSecret: provider.clientSecret,
      idpRedirectUri: `${accessUrl}/oauth/tenant/callback`,
      clientId: CLIENT_ID,
      clientSecret: 'the-secret-of-the-gateway',
      // The url the gateway sends the browser back to is registered with
      // the tenant: the gateway of the reference is at a port of the test.
      clientRedirectUris: [`${gatewayUrl}/auth/callback`],
    })
    expect(tenant.status).toBe(201)

    // Phase 2: the principals are registered.
    const principal = await admin('/v1/admin/users', 'POST', {
      tenant: TENANT_SLUG,
      externalSubject: provider.subject,
      email: 'alice@gateway.test',
      displayName: 'Alice',
    })
    expect(principal.status).toBe(201)

    // Phase 3: the grants are registered.
    const grant = await admin('/v1/admin/grants', 'PUT', {
      tenant: TENANT_SLUG,
      userId: principal.body.id,
      permission: 'workspace.read',
      workspaceId: WORKSPACE_ID,
      routeId: 'workspace-api',
    })
    expect(grant.status).toBe(200)

    // The checklist of the cutover: the tenant, its principals and its
    // grants are registered, and the operator can read them.
    const tenants = await admin('/v1/admin/tenants', 'GET')
    expect((tenants.body.tenants as { slug: string }[]).map((row) => row.slug)).toContain(
      TENANT_SLUG
    )
    const principals = await admin(`/v1/admin/users?tenant=${TENANT_SLUG}`, 'GET')
    expect((principals.body.principals as { id: string }[]).map((row) => row.id)).toContain(
      principal.body.id as string
    )
    const grants = await admin(`/v1/admin/grants?tenant=${TENANT_SLUG}`, 'GET')
    expect((grants.body.grants as { id: string }[]).map((row) => row.id)).toContain(
      grant.body.id as string
    )
  })

  test('the check: a browser logs in and reaches an upstream of the gateway', async () => {
    const cookie = await login(gatewayUrl)
    const response = await request(gatewayUrl, `/ws/${WORKSPACE_ID}/`, cookie, 'api.gateway.test')
    expect(response.status).toBe(200)
    const body = (await response.json()) as { headers: Record<string, string> }
    expect(body.headers['x-gateway-user']).toBeTruthy()
    expect(body.headers['x-gateway-roles']).toContain('workspace.read')
  })

  test('the way back: the revocation of the grant ends the access', async () => {
    const grants = await admin(`/v1/admin/grants?tenant=${TENANT_SLUG}`, 'GET')
    const grant = (grants.body.grants as { id: string }[])[0]!
    const revoked = await admin(`/v1/admin/grants/${grant.id}`, 'DELETE')
    expect(revoked.status).toBe(204)

    const cookie = await login(gatewayUrl)
    const response = await request(gatewayUrl, `/ws/${WORKSPACE_ID}/`, cookie, 'api.gateway.test')
    expect(response.status).toBe(403)
    expect(await response.text()).toContain('workspace_forbidden')
  })

  test('the tenant is switched again without registering anything', async () => {
    // The data of the access service stays: the principal and the tenant are still
    // there, and the access is given again by a grant.
    const principals = await admin(`/v1/admin/users?tenant=${TENANT_SLUG}`, 'GET')
    const principal = (principals.body.principals as { id: string }[])[0]!
    const grant = await admin('/v1/admin/grants', 'PUT', {
      tenant: TENANT_SLUG,
      userId: principal.id,
      permission: 'workspace.read',
      workspaceId: WORKSPACE_ID,
      routeId: 'workspace-api',
    })
    expect(grant.status).toBe(200)

    const cookie = await login(gatewayUrl)
    const response = await request(gatewayUrl, `/ws/${WORKSPACE_ID}/`, cookie, 'api.gateway.test')
    expect(response.status).toBe(200)
  })
})
