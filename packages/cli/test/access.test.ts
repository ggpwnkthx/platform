import { describe, expect, test } from 'bun:test'
import {
  decide,
  listGrants,
  listTenants,
  removeRole,
  revokeGrant,
  writeGrant,
  writePrincipal,
  writeTenant,
} from '../src/domains/access'
import { FakeHttp } from './support'

/**
 * The parameters of a call to Access.
 *
 * @param http the transport of the call.
 */
function callOf(http: FakeHttp) {
  return { http, baseUrl: 'https://access.example.com', token: 'the-admin-token' }
}

describe('the administration of Access', () => {
  test('the tenants are read from Access', async () => {
    const http = new FakeHttp(FakeHttp.json(200, { tenants: [{ slug: 'acme' }] }))
    const body = (await listTenants(callOf(http))) as { tenants: unknown[] }
    expect(body.tenants).toHaveLength(1)
    expect(http.last.url).toBe('https://access.example.com/v1/admin/tenants')
    expect(http.last.token).toBe('the-admin-token')
  })

  test('a tenant is written with its fields', async () => {
    const http = new FakeHttp(FakeHttp.json(200, { slug: 'acme' }))
    await writeTenant(callOf(http), { slug: 'acme', displayName: 'Acme Inc' })
    expect(http.last.method).toBe('POST')
    expect(http.last.body).toBe(JSON.stringify({ slug: 'acme', displayName: 'Acme Inc' }))
  })

  test('a principal is written with the subject of the provider', async () => {
    const http = new FakeHttp(FakeHttp.json(200, { id: 'b1c2' }))
    await writePrincipal(callOf(http), { tenant: 'acme', externalSubject: '00u1' })
    expect(http.last.body).toBe(JSON.stringify({ tenant: 'acme', externalSubject: '00u1' }))
  })

  test('the grants of a tenant are a page', async () => {
    const http = new FakeHttp(FakeHttp.json(200, { grants: [] }))
    await listGrants(callOf(http), { tenant: 'acme', live: 'true', limit: 10 })
    expect(http.last.url).toBe(
      'https://access.example.com/v1/admin/grants?tenant=acme&live=true&limit=10'
    )
  })

  test('a grant is written with a put', async () => {
    const http = new FakeHttp(FakeHttp.json(200, { id: 'd3e4' }))
    await writeGrant(callOf(http), { tenant: 'acme', userId: 'b1c2', permission: 'workspace.read' })
    expect(http.last.method).toBe('PUT')
    expect(http.last.url).toBe('https://access.example.com/v1/admin/grants')
  })

  test('a grant is revoked by its id', async () => {
    const http = new FakeHttp(FakeHttp.json(204, null))
    await revokeGrant(callOf(http), 'd3e4')
    expect(http.last.method).toBe('DELETE')
    expect(http.last.url).toBe('https://access.example.com/v1/admin/grants/d3e4')
  })

  test('a role is removed by its id', async () => {
    const http = new FakeHttp(FakeHttp.json(204, null))
    await removeRole(callOf(http), 'a1b2')
    expect(http.last.url).toBe('https://access.example.com/v1/admin/roles/a1b2')
  })

  test('a decision is asked of Access, and never computed', async () => {
    const http = new FakeHttp(FakeHttp.json(200, { allow: true, reason: 'allowed' }))
    const answer = (await decide(callOf(http), { subject: '00u1' })) as { allow: boolean }
    expect(answer.allow).toBe(true)
    expect(http.last.method).toBe('POST')
    expect(http.last.url).toBe('https://access.example.com/v1/decisions')
    expect(http.last.body).toBe(JSON.stringify({ subject: '00u1' }))
  })

  test('the credential of the decision may be another one', async () => {
    const http = new FakeHttp(FakeHttp.json(200, { allow: false }))
    await decide(callOf(http), { subject: '00u1' }, 'the-decision-token')
    expect(http.last.token).toBe('the-decision-token')
  })
})
