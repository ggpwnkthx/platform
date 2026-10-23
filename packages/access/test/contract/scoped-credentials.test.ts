import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createTestClient, type TestClient } from '../fixtures/client'
import { startTestRuntime, TEST_ENCRYPTION_KEY, type TestRuntime } from '../fixtures/runtime'
import { tenantPayload } from '../fixtures/tenant'

/**
 * The credentials of a tenant, and the end of the migration of the shared
 * token (spec §8.8).
 *
 * The bearer token of the deployment is not scoped to a tenant and it is
 * deprecated. It is **optional**: a deployment that does not set it
 * accepts only the credentials of a tenant, which are scoped to it. This
 * file proves that a deployment without the shared token answers the
 * gateway that presents the credentials of its tenant, and refuses the
 * bearer scheme.
 */

/** The token of the administration of the tests. */
const ADMIN_TOKEN = 'the-admin-token'
/** The workspace of the tests. */
const WORKSPACE = '11111111-1111-4111-8111-111111111111'

let service: TestRuntime
let client: TestClient

/** Calls the administration of the tests. */
let admin: (
  path: string,
  method: string,
  body: Record<string, unknown>
) => Promise<Record<string, unknown>>

/** Asks for a decision with a header of authorization. */
let decide: (
  authorization: string | null,
  subject: string
) => Promise<{ status: number; body: Record<string, unknown> }>

/** The id of the principal of the tests. */
let subject: string

beforeAll(async () => {
  // The deployment of the end of the migration: no shared token.
  service = await startTestRuntime({
    ACCESS_ADMIN_TOKEN: ADMIN_TOKEN,
    ACCESS_SECRET_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
  })
  client = createTestClient(service.base, ADMIN_TOKEN)
  admin = async (path, method, body) => (await client.call(path, method, body)).body
  decide = async (authorization, subject) =>
    await client.decide(
      { subject, workspaceId: WORKSPACE, routeId: 'workspace-api', roles: [] },
      authorization
    )

  await admin(
    '/v1/admin/tenants',
    'POST',
    tenantPayload({ clientSecret: 'the-secret-of-the-gateway' })
  )
  const principal = await admin('/v1/admin/users', 'POST', {
    tenant: 'acme',
    externalSubject: 'the-subject',
  })
  subject = principal.id as string
  await admin('/v1/admin/grants', 'PUT', {
    tenant: 'acme',
    userId: subject,
    permission: 'workspace.read',
    workspaceId: WORKSPACE,
    routeId: 'workspace-api',
  })
})

afterAll(async () => {
  await service.stop()
})

describe('a deployment without the shared token', () => {
  test('the credentials of the tenant of the gateway are accepted', async () => {
    const credentials = Buffer.from('gateway-acme:the-secret-of-the-gateway').toString('base64')
    const answer = await decide(`Basic ${credentials}`, subject)
    expect(answer.status).toBe(200)
    expect(answer.body).toEqual({ allow: true, reason: 'allowed' })
  })

  test('the bearer scheme is refused', async () => {
    const answer = await decide('Bearer the-access-token', subject)
    expect(answer.status).toBe(401)
    expect(answer.body.error).toBe('unauthorized')
  })

  test('a request without a credential is refused', async () => {
    const answer = await decide(null, subject)
    expect(answer.status).toBe(401)
    expect(answer.body.error).toBe('unauthorized')
  })

  test('the credentials of a tenant are scoped to it', async () => {
    await admin('/v1/admin/tenants', 'POST', {
      slug: 'other',
      displayName: 'Other Inc',
      issuer: 'https://login.other.example',
      idpClientId: 'access-other',
      idpClientSecret: 'secret',
      clientId: 'gateway-other',
      clientSecret: 'the-secret-of-the-other-gateway',
    })
    const principal = await admin('/v1/admin/users', 'POST', {
      tenant: 'other',
      externalSubject: 'the-subject-of-the-other-tenant',
    })
    const credentials = Buffer.from('gateway-acme:the-secret-of-the-gateway').toString('base64')
    const answer = await decide(`Basic ${credentials}`, principal.id as string)
    expect(answer.status).toBe(200)
    // The subject exists, in another tenant: the answer does not tell the
    // gateway that it exists.
    expect(answer.body.allow).toBe(false)
    expect(answer.body.reason).toBe('the principal does not exist')
  })
})
