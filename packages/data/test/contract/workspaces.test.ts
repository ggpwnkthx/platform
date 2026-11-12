import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createHarness, PRINCIPAL_ID, TENANT_ID, type Harness } from '../helpers/harness'

let harness: Harness

beforeAll(async () => {
  harness = await createHarness()
})

afterAll(async () => {
  await harness?.stop()
})

/** The body of a response, as json. */
async function json<T = any>(response: Response): Promise<T> {
  return (await response.json()) as T
}

/** The body of a creation of a workspace. */
const CREATION = {
  tenant: 'acme',
  tenantId: TENANT_ID,
  slug: 'new-workspace',
  displayName: 'New workspace',
}

describe('the creation of a workspace', () => {
  test('a caller that holds the capability creates a workspace of its tenant', async () => {
    harness.access.grants.set(PRINCIPAL_ID, [
      { tenantId: TENANT_ID, permissionKeys: ['data.workspace.create'] },
    ])
    const response = await harness.request('/v1/workspaces', {
      method: 'POST',
      workspaceId: '',
      body: CREATION,
    })
    expect(response.status).toBe(201)
    const body = await json(response)
    expect(body.data.slug).toBe('new-workspace')
    expect(body.data.displayName).toBe('New workspace')
    expect(body.data.tenantId).toBe(TENANT_ID)
    expect(body.data.tenant).toBe('acme')
    expect(body.data.status).toBe('active')
    expect(body.data.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  test('the workspace is registered and serves its tenant', async () => {
    harness.access.grants.set(PRINCIPAL_ID, [
      { tenantId: TENANT_ID, permissionKeys: ['data.workspace.create'] },
    ])
    const response = await harness.request('/v1/workspaces', {
      method: 'POST',
      workspaceId: '',
      body: { ...CREATION, slug: 'registered' },
    })
    expect(response.status).toBe(201)
    const body = await json(response)
    const rows = await harness.database.query<{ id: string; tenant_id: string }>(
      'select id, tenant_id from platform.workspaces where slug = $1',
      ['registered']
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).toBe(body.data.id)
    expect(rows[0]!.tenant_id).toBe(TENANT_ID)
  })

  test('a caller that holds no capability is refused', async () => {
    harness.access.grants.set(PRINCIPAL_ID, [
      { tenantId: TENANT_ID, permissionKeys: ['content.reader'] },
    ])
    const response = await harness.request('/v1/workspaces', {
      method: 'POST',
      workspaceId: '',
      body: { ...CREATION, slug: 'refused' },
    })
    expect(response.status).toBe(403)
  })

  test('a caller without a grant is refused', async () => {
    harness.access.grants.set(PRINCIPAL_ID, [])
    const response = await harness.request('/v1/workspaces', {
      method: 'POST',
      workspaceId: '',
      body: { ...CREATION, slug: 'anonymous' },
    })
    expect(response.status).toBe(403)
  })

  test('a slug that the tenant already holds is a conflict', async () => {
    harness.access.grants.set(PRINCIPAL_ID, [
      { tenantId: TENANT_ID, permissionKeys: ['data.workspace.create'] },
    ])
    const response = await harness.request('/v1/workspaces', {
      method: 'POST',
      workspaceId: '',
      body: { ...CREATION, slug: 'acme' },
    })
    expect(response.status).toBe(409)
  })

  test('a slug that the registry does not accept is a bad request', async () => {
    harness.access.grants.set(PRINCIPAL_ID, [
      { tenantId: TENANT_ID, permissionKeys: ['data.workspace.create'] },
    ])
    const response = await harness.request('/v1/workspaces', {
      method: 'POST',
      workspaceId: '',
      body: { ...CREATION, slug: 'Not a slug' },
    })
    expect(response.status).toBe(400)
  })

  test('a tenant that is not a uuid is a bad request', async () => {
    harness.access.grants.set(PRINCIPAL_ID, [
      { tenantId: TENANT_ID, permissionKeys: ['data.workspace.create'] },
    ])
    const response = await harness.request('/v1/workspaces', {
      method: 'POST',
      workspaceId: '',
      body: { ...CREATION, tenantId: 'not-a-uuid' },
    })
    expect(response.status).toBe(400)
  })

  test('a request that is not signed is refused', async () => {
    const response = await harness.request('/v1/workspaces', {
      method: 'POST',
      workspaceId: '',
      body: CREATION,
      signature: null,
    })
    expect(response.status).toBe(401)
  })
})
