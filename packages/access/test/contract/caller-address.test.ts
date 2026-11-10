import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createTestClient } from '../fixtures/client'
import { startTestRuntime, TEST_ENCRYPTION_KEY, type TestRuntime } from '../fixtures/runtime'
import { tenantPayload } from '../fixtures/tenant'

/**
 * The address of the caller in the audit (spec §10.1).
 *
 * The address of the socket is the address of the peer: behind an
 * ingress it is the address of the ingress, and every caller of the
 * deployment shares it. A deployment that is behind an ingress that is
 * the only way in reads the address the ingress reports, and the audit
 * names the operator that made the change.
 */
const ADMIN_TOKEN = 'the-admin-token'

let service: TestRuntime
let admin: (
  path: string,
  method: string,
  body?: Record<string, unknown>
) => Promise<{ status: number; body: Record<string, unknown> }>

beforeAll(async () => {
  service = await startTestRuntime({
    ACCESS_ADMIN_TOKEN: ADMIN_TOKEN,
    ACCESS_SECRET_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
    ACCESS_INGRESS_ONLY: 'true',
  })
  admin = createTestClient(service.base, ADMIN_TOKEN).call
})

afterAll(async () => {
  await service.stop()
})

describe('the address of the caller in the audit', () => {
  test('the audit names the address the ingress reported', async () => {
    const client = createTestClient(service.base, ADMIN_TOKEN)
    await client.request('/v1/admin/tenants', {
      method: 'POST',
      body: tenantPayload({
        idpClientSecret: 'the-secret-of-the-provider',
        clientSecret: 'the-secret-of-the-gateway',
        clientRedirectUris: ['https://gateway-acme.example.com/auth/callback'],
      }),
      headers: { authorization: `Bearer ${ADMIN_TOKEN}`, 'x-real-ip': '203.0.113.7' },
    })
    const body = await admin('/v1/admin/audit?tenant=acme', 'GET')
    const records = body.body.records as Record<string, unknown>[]
    expect(records.length).toBeGreaterThan(0)
    expect(records[0]!.address).toBe('203.0.113.7')
  })

  test('a request that reports no address keeps the address of the socket', async () => {
    const client = createTestClient(service.base, ADMIN_TOKEN)
    await client.request('/v1/admin/users', {
      method: 'POST',
      body: { tenant: 'acme', externalSubject: 'the-subject-of-no-address' },
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    })
    const body = await admin('/v1/admin/audit?action=principal.created', 'GET')
    const records = body.body.records as Record<string, unknown>[]
    const record = records.find((row) => row.targetId !== undefined)
    expect(record?.address).toBeTruthy()
    expect(record?.address).not.toBe('203.0.113.7')
  })
})
