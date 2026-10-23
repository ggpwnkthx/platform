import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createTestClient, type TestClient } from '../fixtures/client'
import { startTestRuntime, TEST_ENCRYPTION_KEY, type TestRuntime } from '../fixtures/runtime'
import { tenantPayload } from '../fixtures/tenant'

/** The token of the gateway of the tests. */
const ACCESS_TOKEN = 'the-access-token'
/** The token of the administration of the tests. */
const ADMIN_TOKEN = 'the-admin-token'
/** The token of the metrics of the tests. */
const METRICS_TOKEN = 'the-metrics-token'

/** The workspace of the tests. */
const WORKSPACE = '11111111-1111-4111-8111-111111111111'
/** Another workspace. */
const OTHER_WORKSPACE = '22222222-2222-4222-8222-222222222222'

let service: TestRuntime
let client: TestClient

/** Calls the administration of the tests. */
let admin: (
  path: string,
  method: string,
  body: Record<string, unknown>
) => Promise<Record<string, unknown>>

/** Asks for a decision. */
let decide: (
  body: Record<string, unknown>,
  token?: string | null
) => Promise<{ status: number; body: Record<string, unknown> }>

/**
 * Reads the value of a metric of the service.
 *
 * The value is the sum of the samples of the metric: the metrics of the
 * service are counters and histograms.
 */
async function metric(name: string): Promise<number> {
  const response = await fetch(`${service.base}/metrics`, {
    headers: { authorization: `Bearer ${METRICS_TOKEN}` },
  })
  const text = await response.text()
  let total = 0
  for (const line of text.split('\n')) {
    if (!line.startsWith(name)) continue
    const value = Number(line.trim().split(/\s+/).at(-1))
    if (Number.isFinite(value)) total += value
  }
  return total
}

/** The id of the principal of the tests. */
let subject: string

beforeAll(async () => {
  service = await startTestRuntime({
    ACCESS_ADMIN_TOKEN: ADMIN_TOKEN,
    ACCESS_DECISION_TOKEN: ACCESS_TOKEN,
    ACCESS_METRICS_TOKEN: METRICS_TOKEN,
    ACCESS_SECRET_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
  })
  client = createTestClient(service.base)
  admin = async (path, method, body) => (await client.call(path, method, body, ADMIN_TOKEN)).body
  decide = (body, token = ACCESS_TOKEN) =>
    client.decide(body, token === null ? null : `Bearer ${token}`)

  await admin('/v1/admin/tenants', 'POST', tenantPayload())
  const principal = await admin('/v1/admin/users', 'POST', {
    tenant: 'acme',
    externalSubject: 'the-subject',
  })
  subject = principal.id as string
})

afterAll(async () => {
  await service.stop()
})

describe('the decisions of the gateway', () => {
  test('a principal with a grant is allowed', async () => {
    await admin('/v1/admin/grants', 'PUT', {
      tenant: 'acme',
      userId: subject,
      permission: 'workspace.read',
      workspaceId: WORKSPACE,
      routeId: 'workspace-api',
    })
    const answer = await decide({
      subject,
      workspaceId: WORKSPACE,
      routeId: 'workspace-api',
      roles: ['workspace.read'],
    })
    expect(answer.status).toBe(200)
    expect(answer.body).toEqual({ allow: true, reason: 'allowed' })
  })

  test('a grant of another workspace does not grant this one', async () => {
    const answer = await decide({
      subject,
      workspaceId: OTHER_WORKSPACE,
      routeId: 'workspace-api',
      roles: ['workspace.read'],
    })
    expect(answer.body.allow).toBe(false)
    expect(answer.body.reason).toBe('the principal does not have the role of the workspace')
  })

  test('a denial carries the code of its reason', async () => {
    // The gateway counts the code when the service sends one, and it
    // falls back on the text of the reason when it does not (spec §8.2).
    const answer = await decide({
      subject,
      workspaceId: OTHER_WORKSPACE,
      routeId: 'workspace-api',
      roles: ['workspace.read'],
    })
    expect(answer.body.reasonCode).toBe('missing_role')
  })

  test('a denial that is not a missing role carries the code of a denial', async () => {
    const answer = await decide({
      subject: '33333333-3333-4333-8333-333333333333',
      workspaceId: WORKSPACE,
      routeId: 'workspace-api',
      roles: [],
    })
    expect(answer.body.allow).toBe(false)
    expect(answer.body.reasonCode).toBe('access_denied')
  })

  test('an allowance carries no code', async () => {
    const answer = await decide({
      subject,
      workspaceId: WORKSPACE,
      routeId: 'workspace-api',
      roles: ['workspace.read'],
    })
    expect(answer.body).toEqual({ allow: true, reason: 'allowed' })
  })

  test('a grant of another route does not grant this one', async () => {
    const answer = await decide({
      subject,
      workspaceId: WORKSPACE,
      routeId: 'another-route',
      roles: ['workspace.read'],
    })
    expect(answer.body.allow).toBe(false)
    expect(answer.body.reason).toBe('the principal does not have the role of the workspace')
  })

  test('a subject that is no principal is refused', async () => {
    const answer = await decide({
      subject: '33333333-3333-4333-8333-333333333333',
      workspaceId: WORKSPACE,
      routeId: 'workspace-api',
      roles: [],
    })
    expect(answer.body.allow).toBe(false)
    expect(answer.body.reason).toBe('the principal does not exist')
  })

  test('a disabled principal is refused', async () => {
    await admin('/v1/admin/users', 'POST', {
      tenant: 'acme',
      externalSubject: 'the-disabled-subject',
      status: 'disabled',
    })
    const disabled = await admin('/v1/admin/users', 'POST', {
      tenant: 'acme',
      externalSubject: 'the-disabled-subject',
    })
    const answer = await decide({
      subject: disabled.id,
      workspaceId: WORKSPACE,
      routeId: 'workspace-api',
      roles: [],
    })
    expect(answer.body.allow).toBe(false)
    expect(answer.body.reason).toBe('the principal is disabled')
  })

  test('the roles of the request are not the policy', async () => {
    // The token of the caller carries the roles: they are a snapshot and
    // they do not allow anything.
    const answer = await decide({
      subject: '33333333-3333-4333-8333-333333333333',
      workspaceId: WORKSPACE,
      routeId: 'workspace-api',
      roles: ['workspace.read', 'workspace.admin'],
    })
    expect(answer.body.allow).toBe(false)
  })

  test('a grant that has expired is refused', async () => {
    const expired = await admin('/v1/admin/users', 'POST', {
      tenant: 'acme',
      externalSubject: 'the-expired-subject',
    })
    await admin('/v1/admin/grants', 'PUT', {
      tenant: 'acme',
      userId: expired.id,
      permission: 'workspace.read',
      workspaceId: WORKSPACE,
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    })
    const answer = await decide({
      subject: expired.id,
      workspaceId: WORKSPACE,
      routeId: 'workspace-api',
      roles: [],
    })
    expect(answer.body.allow).toBe(false)
    expect(answer.body.reason).toBe('the role of the workspace has expired')
  })

  test('a revoked grant is refused', async () => {
    const revoked = await admin('/v1/admin/users', 'POST', {
      tenant: 'acme',
      externalSubject: 'the-revoked-subject',
    })
    const grant = await admin('/v1/admin/grants', 'PUT', {
      tenant: 'acme',
      userId: revoked.id,
      permission: 'workspace.read',
      workspaceId: WORKSPACE,
    })
    await fetch(`${service.base}/v1/admin/grants/${grant.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    })
    const answer = await decide({
      subject: revoked.id,
      workspaceId: WORKSPACE,
      routeId: 'workspace-api',
      roles: [],
    })
    expect(answer.body.allow).toBe(false)
    expect(answer.body.reason).toBe('the principal does not have the role of the workspace')
  })

  test('a database that is down is a service that is not available', async () => {
    // The gateway fails closed on anything that is not a successful
    // answer: a decision that cannot be computed is a 503.
    const without = await startTestRuntime({ ACCESS_DECISION_TOKEN: ACCESS_TOKEN })
    try {
      await without.runtime.database.close()
      const response = await fetch(
        `http://127.0.0.1:${without.runtime.listener.port}/v1/decisions`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${ACCESS_TOKEN}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ subject, workspaceId: WORKSPACE, routeId: 'workspace-api' }),
        }
      )
      expect(response.status).toBe(503)
      expect(((await response.json()) as Record<string, unknown>).error).toBe('service_unavailable')
    } finally {
      await without.runtime.listener.stop(true)
    }
  })

  test('a missing token is refused', async () => {
    const answer = await decide({ subject, workspaceId: WORKSPACE, routeId: 'workspace-api' }, null)
    expect(answer.status).toBe(401)
    expect(answer.body.error).toBe('unauthorized')
  })

  test('a wrong token is refused', async () => {
    const answer = await decide(
      { subject, workspaceId: WORKSPACE, routeId: 'workspace-api' },
      'wrong'
    )
    expect(answer.status).toBe(401)
  })

  test('a body that is not json is refused', async () => {
    const response = await fetch(`${service.base}/v1/decisions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${ACCESS_TOKEN}`, 'content-type': 'application/json' },
      body: 'not json',
    })
    expect(response.status).toBe(400)
    expect(((await response.json()) as Record<string, unknown>).error).toBe('bad_request')
  })

  test('a body without a subject is refused', async () => {
    const answer = await decide({ workspaceId: WORKSPACE, routeId: 'workspace-api' })
    expect(answer.status).toBe(400)
    expect(answer.body.error).toBe('bad_request')
  })

  test('a body with a subject that is not a string is refused', async () => {
    const answer = await decide({ subject: 42 })
    expect(answer.status).toBe(400)
  })

  test('a subject that is not the id of a principal is refused', async () => {
    // The subject names a row of the platform: a value that is not an id
    // is refused by the contract and never reaches the database, so it is
    // not a failure of the storage.
    const answer = await decide({ subject: 'not-a-principal' })
    expect(answer.status).toBe(400)
    expect(answer.body.error).toBe('bad_request')
  })

  test('a subject that is not an id does not fail the store', async () => {
    // The metric of the failures of the stores counts the failures of the
    // database: a malformed request is not one of them.
    const before = await metric('access_store_errors_total')
    await decide({ subject: 'not-a-principal' })
    const after = await metric('access_store_errors_total')
    expect(after).toBe(before)
  })

  test('a field that the access service does not know is ignored', async () => {
    const answer = await decide({
      subject,
      workspaceId: WORKSPACE,
      routeId: 'workspace-api',
      roles: [],
      somethingElse: 'the contract of the gateway does not change',
    })
    expect(answer.status).toBe(200)
  })
})

describe('the metrics of the service', () => {
  test('the endpoint is not served when no token is configured', async () => {
    // A deployment without a token does not serve the metrics at all: they
    // never end up on a public listener by accident.
    const without = await startTestRuntime()
    try {
      const response = await fetch(`http://127.0.0.1:${without.runtime.listener.port}/metrics`)
      expect(response.status).toBe(404)
    } finally {
      await without.runtime.listener.stop(true)
      await without.runtime.database.close()
    }
  })

  test('a missing token is refused', async () => {
    const response = await fetch(`${service.base}/metrics`)
    expect(response.status).toBe(401)
  })

  test('a wrong token is refused', async () => {
    const response = await fetch(`${service.base}/metrics`, {
      headers: { authorization: 'Bearer wrong' },
    })
    expect(response.status).toBe(401)
  })

  test('the metrics are the text of Prometheus', async () => {
    await decide({ subject, workspaceId: WORKSPACE, routeId: 'workspace-api', roles: [] })
    const response = await fetch(`${service.base}/metrics`, {
      headers: { authorization: `Bearer ${METRICS_TOKEN}` },
    })
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).toContain('access_decisions_total')
    expect(text).toContain('access_decision_duration_seconds')
  })
})

describe('the credentials of the decisions', () => {
  /** The credentials of the gateway of a tenant, in base64. */
  function basic(clientId: string, clientSecret: string): string {
    return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
  }

  /** Asks for a decision with a credential of the caller. */
  async function decideWith(
    credential: string,
    body: Record<string, unknown>
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await fetch(`${service.base}/v1/decisions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: credential },
      body: JSON.stringify(body),
    })
    return { status: response.status, body: (await response.json()) as Record<string, unknown> }
  }

  test('the credentials of a tenant answer a decision of that tenant', async () => {
    const answer = await decideWith(basic('gateway-acme', 'secret'), {
      subject,
      workspaceId: WORKSPACE,
      routeId: 'workspace-api',
      roles: [],
    })
    expect(answer.status).toBe(200)
    expect(answer.body.allow).toBe(true)
  })

  test('a wrong secret is refused', async () => {
    const answer = await decideWith(basic('gateway-acme', 'wrong'), {
      subject,
      workspaceId: WORKSPACE,
      routeId: 'workspace-api',
      roles: [],
    })
    expect(answer.status).toBe(401)
  })

  test('a client id that is not registered is refused', async () => {
    const answer = await decideWith(basic('gateway-nowhere', 'secret'), {
      subject,
      workspaceId: WORKSPACE,
      routeId: 'workspace-api',
      roles: [],
    })
    expect(answer.status).toBe(401)
  })

  test('the decisions of a tenant do not see the principals of another tenant', async () => {
    await admin('/v1/admin/tenants', 'POST', {
      slug: 'other',
      displayName: 'Other',
      issuer: 'https://login.other.example',
      idpClientId: 'access-other',
      idpClientSecret: 'secret',
      clientId: 'gateway-other',
      clientSecret: 'the-secret-of-other',
    })
    const principal = await admin('/v1/admin/users', 'POST', {
      tenant: 'other',
      externalSubject: 'the-subject-of-another-tenant',
    })
    await admin('/v1/admin/grants', 'PUT', {
      tenant: 'other',
      userId: principal.id,
      // The permission of the grant belongs to the tenant: a permission of
      // another tenant is refused (spec §10.6).
      permission: 'workspace.other',
      workspaceId: WORKSPACE,
      routeId: 'workspace-api',
    })

    // The gateway of the tenant acme asks about a principal of the tenant
    // other: the answer does not say that the principal exists.
    const answer = await decideWith(basic('gateway-acme', 'secret'), {
      subject: principal.id,
      workspaceId: WORKSPACE,
      routeId: 'workspace-api',
      roles: [],
    })
    expect(answer.status).toBe(200)
    expect(answer.body.allow).toBe(false)
    expect(answer.body.reason).toBe('the principal does not exist')

    // The gateway of the tenant other asks about its own principal.
    const own = await decideWith(basic('gateway-other', 'the-secret-of-other'), {
      subject: principal.id,
      workspaceId: WORKSPACE,
      routeId: 'workspace-api',
      roles: [],
    })
    expect(own.body.allow).toBe(true)
  })

  test('the bearer token of the deployment is not scoped', async () => {
    await admin('/v1/admin/tenants', 'POST', {
      slug: 'third',
      displayName: 'Third',
      issuer: 'https://login.third.example',
      idpClientId: 'access-third',
      idpClientSecret: 'secret',
      clientId: 'gateway-third',
      clientSecret: 'secret',
    })
    const principal = await admin('/v1/admin/users', 'POST', {
      tenant: 'third',
      externalSubject: 'the-subject-of-the-third-tenant',
    })
    await admin('/v1/admin/grants', 'PUT', {
      tenant: 'third',
      userId: principal.id,
      permission: 'workspace.third',
      workspaceId: WORKSPACE,
      routeId: 'workspace-api',
    })

    // The bearer token of the deployment sees every tenant of the
    // platform: that is the price of the scheme of the reference.
    const answer = await decide({
      subject: principal.id,
      workspaceId: WORKSPACE,
      routeId: 'workspace-api',
      roles: [],
    })
    expect(answer.status).toBe(200)
    expect(answer.body.allow).toBe(true)

    // The credentials of the tenant acme do not.
    const scoped = await decideWith(basic('gateway-acme', 'secret'), {
      subject: principal.id,
      workspaceId: WORKSPACE,
      routeId: 'workspace-api',
      roles: [],
    })
    expect(scoped.body.allow).toBe(false)
    expect(scoped.body.reason).toBe('the principal does not exist')
  })

  test('the credentials of a tenant with a shared client are scoped to its tenant', async () => {
    await admin('/v1/admin/tenants', 'POST', {
      slug: 'shared',
      displayName: 'Shared',
      issuer: 'https://login.shared.example',
      idpClientId: 'access-shared',
      idpClientSecret: 'secret',
      clientId: 'gateway-shared',
      clientSecret: 'secret',
      sharedClient: true,
    })
    const principal = await admin('/v1/admin/users', 'POST', {
      tenant: 'shared',
      externalSubject: 'the-subject-of-the-shared-tenant',
    })
    await admin('/v1/admin/grants', 'PUT', {
      tenant: 'shared',
      userId: principal.id,
      permission: 'workspace.read',
      workspaceId: WORKSPACE,
      routeId: 'workspace-api',
    })
    // The gateway of the shared client asks about a principal of another
    // tenant: the credentials of a tenant are scoped to it, and the
    // answer is the one of a principal that does not exist.
    const scoped = await decideWith(basic('gateway-shared', 'secret'), {
      subject,
      workspaceId: WORKSPACE,
      routeId: 'workspace-api',
      roles: [],
    })
    expect(scoped.status).toBe(200)
    expect(scoped.body.allow).toBe(false)
    expect(scoped.body.reason).toBe('the principal does not exist')
    // The bearer token of the deployment is the way to ask about every
    // tenant of the platform.
    const unscoped = await decide({
      subject,
      workspaceId: WORKSPACE,
      routeId: 'workspace-api',
      roles: [],
    })
    expect(unscoped.body.allow).toBe(true)
  })

  test('a credential that is not understood is refused', async () => {
    const answer = await decideWith('Digest whatever', {
      subject,
      workspaceId: WORKSPACE,
      routeId: 'workspace-api',
      roles: [],
    })
    expect(answer.status).toBe(401)
  })
})

describe('the grants of a group', () => {
  test('a member of the group is allowed by the grant of the group', async () => {
    const member = await admin('/v1/admin/users', 'POST', {
      tenant: 'acme',
      externalSubject: 'the-subject-of-a-member',
    })
    const group = await admin('/v1/admin/groups', 'POST', {
      tenant: 'acme',
      key: 'team-decisions',
      members: ['the-subject-of-a-member'],
    })
    expect(group.key).toBe('team-decisions')

    await admin('/v1/admin/grants', 'PUT', {
      tenant: 'acme',
      group: 'team-decisions',
      permission: 'workspace.team',
      workspaceId: WORKSPACE,
      routeId: 'workspace-api',
    })

    const answer = await decide({
      subject: member.id,
      workspaceId: WORKSPACE,
      routeId: 'workspace-api',
      roles: [],
    })
    expect(answer.status).toBe(200)
    expect(answer.body.allow).toBe(true)
    expect(answer.body.reason).toBe('allowed')
  })

  test('a principal that is not a member of the group is refused', async () => {
    const outsider = await admin('/v1/admin/users', 'POST', {
      tenant: 'acme',
      externalSubject: 'the-subject-of-an-outsider',
    })
    const answer = await decide({
      subject: outsider.id,
      workspaceId: WORKSPACE,
      routeId: 'workspace-api',
      roles: [],
    })
    expect(answer.body.allow).toBe(false)
    expect(answer.body.reason).toBe('the principal does not have the role of the workspace')
  })

  test('a principal that leaves the group loses the access', async () => {
    const member = await admin('/v1/admin/users', 'POST', {
      tenant: 'acme',
      externalSubject: 'the-subject-of-a-leaver',
    })
    await admin('/v1/admin/groups', 'POST', {
      tenant: 'acme',
      key: 'team-leavers',
      members: ['the-subject-of-a-leaver'],
    })
    await admin('/v1/admin/grants', 'PUT', {
      tenant: 'acme',
      group: 'team-leavers',
      permission: 'workspace.leavers',
      workspaceId: WORKSPACE,
      routeId: 'workspace-api',
    })
    const before = await decide({
      subject: member.id,
      workspaceId: WORKSPACE,
      routeId: 'workspace-api',
      roles: [],
    })
    expect(before.body.allow).toBe(true)

    // The membership is replaced: the principal is not in the group any
    // more.
    await admin('/v1/admin/groups', 'POST', {
      tenant: 'acme',
      key: 'team-leavers',
      members: [],
    })
    const after = await decide({
      subject: member.id,
      workspaceId: WORKSPACE,
      routeId: 'workspace-api',
      roles: [],
    })
    expect(after.body.allow).toBe(false)
  })
})

describe('the grants of a group and the grants of the principal', () => {
  test('a live grant of a group wins over an expired grant of the principal', async () => {
    const principal = await admin('/v1/admin/users', 'POST', {
      tenant: 'acme',
      externalSubject: 'the-subject-of-both-kinds',
    })
    await admin('/v1/admin/groups', 'POST', {
      tenant: 'acme',
      key: 'team-both-kinds',
      members: ['the-subject-of-both-kinds'],
    })
    // An expired grant of the principal.
    await admin('/v1/admin/grants', 'PUT', {
      tenant: 'acme',
      userId: principal.id,
      permission: 'workspace.expired',
      workspaceId: WORKSPACE,
      routeId: 'workspace-api',
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    })
    // A live grant of the group.
    await admin('/v1/admin/grants', 'PUT', {
      tenant: 'acme',
      group: 'team-both-kinds',
      permission: 'workspace.live',
      workspaceId: WORKSPACE,
      routeId: 'workspace-api',
    })

    const answer = await decide({
      subject: principal.id,
      workspaceId: WORKSPACE,
      routeId: 'workspace-api',
      roles: [],
    })
    expect(answer.status).toBe(200)
    expect(answer.body.allow).toBe(true)
    expect(answer.body.reason).toBe('allowed')
  })
})

describe('the grants of a group and the grants of the principal', () => {
  test('a live grant of the principal wins over an expired grant of the group', async () => {
    const principal = await admin('/v1/admin/users', 'POST', {
      tenant: 'acme',
      externalSubject: 'the-subject-of-a-live-principal',
    })
    await admin('/v1/admin/groups', 'POST', {
      tenant: 'acme',
      key: 'team-of-an-expired-grant',
      members: ['the-subject-of-a-live-principal'],
    })
    await admin('/v1/admin/grants', 'PUT', {
      tenant: 'acme',
      group: 'team-of-an-expired-grant',
      permission: 'workspace.expired',
      workspaceId: WORKSPACE,
      routeId: 'workspace-api',
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    })
    await admin('/v1/admin/grants', 'PUT', {
      tenant: 'acme',
      userId: principal.id,
      permission: 'workspace.live',
      workspaceId: WORKSPACE,
      routeId: 'workspace-api',
    })

    const answer = await decide({
      subject: principal.id,
      workspaceId: WORKSPACE,
      routeId: 'workspace-api',
      roles: [],
    })
    expect(answer.body.allow).toBe(true)
    expect(answer.body.reason).toBe('allowed')
  })

  test('an expired grant of a group is the reason of the refusal', async () => {
    const principal = await admin('/v1/admin/users', 'POST', {
      tenant: 'acme',
      externalSubject: 'the-subject-of-an-expired-group',
    })
    await admin('/v1/admin/groups', 'POST', {
      tenant: 'acme',
      key: 'team-of-expired-grants',
      members: ['the-subject-of-an-expired-group'],
    })
    await admin('/v1/admin/grants', 'PUT', {
      tenant: 'acme',
      group: 'team-of-expired-grants',
      permission: 'workspace.expired',
      workspaceId: WORKSPACE,
      routeId: 'workspace-api',
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    })

    const answer = await decide({
      subject: principal.id,
      workspaceId: WORKSPACE,
      routeId: 'workspace-api',
      roles: [],
    })
    expect(answer.body.allow).toBe(false)
    expect(answer.body.reason).toBe('the role of the workspace has expired')
  })
})
