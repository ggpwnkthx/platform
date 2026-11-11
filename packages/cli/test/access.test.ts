import { describe, expect, test } from 'bun:test'
import { run, type CliRuntime } from '../src/app/cli'
import type { Services } from '../src/app/commands'
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
import { accessGroup } from '../src/runtime/commands/access'
import { FakeHttp, FakeInfrastructure } from './support'

/**
 * The runtime of the tests of the administration.
 *
 * @param http the transport of the calls.
 */
function runtimeOf(http: FakeHttp): { runtime: CliRuntime; out: string[] } {
  const out: string[] = []
  const services: Services = {
    http,
    profiles: { read: async () => ({ profiles: {} }), write: async () => undefined },
    credentials: {
      read: async () => null,
      write: async () => undefined,
      clear: async () => undefined,
    },
    browser: { open: async () => undefined },
    callback: {
      start: async () => {
        throw new Error('the commands of the administration do not open a browser')
      },
    },
    crypto: {
      randomBytes: (size: number) => new Uint8Array(size).fill(7),
      sha256: (value: Uint8Array) => new Uint8Array(value.length).fill(9),
    },
    infrastructure: new FakeInfrastructure(),
    files: { profiles: '/tmp/profiles.json', credentials: '/tmp/credentials.json' },
    progress: () => undefined,
  }
  return {
    out,
    runtime: {
      name: 'platformctl',
      commands: [],
      groups: [accessGroup],
      environment: {},
      services: () => services,
      contextOf: async () => ({
        name: 'default',
        accessUrl: 'https://access.example.com',
        adminToken: 'the-admin-token',
      }),
      out: (text) => out.push(text),
      err: () => undefined,
    },
  }
}

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

/**
 * The tenants of the administration.
 *
 * The tenant is the unit of the access: it holds the provider of the
 * identity, the client of the gateway and the flags of the platform.
 */
describe('the tenants of the administration', () => {
  test('a tenant that provisions its identities is written with the flag', async () => {
    const http = new FakeHttp(FakeHttp.json(200, { slug: 'acme' }))
    const { runtime } = runtimeOf(http)
    const status = await run(runtime, [
      'access',
      'tenants',
      'create',
      '--slug',
      'acme',
      '--display-name',
      'Acme Inc',
      '--issuer',
      'https://login.acme.example',
      '--idp-client-id',
      'access-acme',
      '--idp-client-secret',
      'the-secret',
      '--client-id',
      'gateway-acme',
      '--client-secret',
      'the-secret',
      '--auto-provision',
    ])
    expect(status).toBe(0)
    expect(http.last.method).toBe('POST')
    expect(http.last.url).toBe('https://access.example.com/v1/admin/tenants')
    const body = JSON.parse(http.last.body ?? '{}') as Record<string, unknown>
    expect(body.autoProvision).toBe(true)
  })

  test('a tenant that provisions no identity is written with the flag', async () => {
    const http = new FakeHttp(FakeHttp.json(200, { slug: 'acme' }))
    const { runtime } = runtimeOf(http)
    const status = await run(runtime, [
      'access',
      'tenants',
      'create',
      '--slug',
      'acme',
      '--display-name',
      'Acme Inc',
      '--issuer',
      'https://login.acme.example',
      '--idp-client-id',
      'access-acme',
      '--idp-client-secret',
      'the-secret',
      '--client-id',
      'gateway-acme',
      '--client-secret',
      'the-secret',
      '--no-auto-provision',
    ])
    expect(status).toBe(0)
    const body = JSON.parse(http.last.body ?? '{}') as Record<string, unknown>
    expect(body.autoProvision).toBe(false)
  })

  test('a tenant that hands its administration to its first identity is written with the flag', async () => {
    const http = new FakeHttp(FakeHttp.json(200, { slug: 'acme' }))
    const { runtime } = runtimeOf(http)
    const status = await run(runtime, [
      'access',
      'tenants',
      'create',
      '--slug',
      'acme',
      '--display-name',
      'Acme Inc',
      '--issuer',
      'https://login.acme.example',
      '--idp-client-id',
      'access-acme',
      '--idp-client-secret',
      'the-secret',
      '--client-id',
      'gateway-acme',
      '--client-secret',
      'the-secret',
      '--auto-provision',
      '--auto-provision-admin',
    ])
    expect(status).toBe(0)
    const body = JSON.parse(http.last.body ?? '{}') as Record<string, unknown>
    expect(body.autoProvisionAdmin).toBe(true)
  })

  test('a tenant that hands its administration to nobody is written with the flag', async () => {
    const http = new FakeHttp(FakeHttp.json(200, { slug: 'acme' }))
    const { runtime } = runtimeOf(http)
    const status = await run(runtime, [
      'access',
      'tenants',
      'create',
      '--slug',
      'acme',
      '--display-name',
      'Acme Inc',
      '--issuer',
      'https://login.acme.example',
      '--idp-client-id',
      'access-acme',
      '--idp-client-secret',
      'the-secret',
      '--client-id',
      'gateway-acme',
      '--client-secret',
      'the-secret',
      '--no-auto-provision-admin',
    ])
    expect(status).toBe(0)
    const body = JSON.parse(http.last.body ?? '{}') as Record<string, unknown>
    expect(body.autoProvisionAdmin).toBe(false)
  })
})

/**
 * The catalog of the providers.
 *
 * The catalog is a table of defaults and not a table of drivers: every
 * provider of a tenant is an OpenID Connect provider, and a preset fills
 * the issuer, the scopes and the algorithms of one.
 */
describe('the catalog of the providers', () => {
  test('the catalog holds the providers the platform supports', async () => {
    const http = new FakeHttp(FakeHttp.json(200, {}))
    const { runtime, out } = runtimeOf(http)
    const status = await run(runtime, ['access', 'catalog', 'list'])
    expect(status).toBe(0)
    const lines = out.join('\n')
    expect(lines).toContain('entra')
    expect(lines).toContain('okta')
    expect(lines).toContain('auth0')
    expect(lines).toContain('keycloak')
    expect(lines).toContain('google')
    expect(lines).toContain('custom')
  })

  test('the steps of a preset say how the client of Access is registered', async () => {
    const http = new FakeHttp(FakeHttp.json(200, {}))
    const { runtime, out } = runtimeOf(http)
    const status = await run(runtime, ['access', 'catalog', 'steps', '--key', 'okta'])
    expect(status).toBe(0)
    const lines = out.join('\n')
    expect(lines).toContain('https://{org}.okta.com')
    expect(lines).toContain('/oauth/tenant/callback')
  })

  test('a preset that the catalog does not hold is refused', async () => {
    const http = new FakeHttp(FakeHttp.json(200, {}))
    const { runtime } = runtimeOf(http)
    await expect(run(runtime, ['access', 'catalog', 'steps', '--key', 'nowhere'])).rejects.toThrow(
      /the catalog holds no preset named "nowhere"/
    )
  })

  test('a provider of a preset is written with the scopes of the vendor', async () => {
    const http = new FakeHttp(FakeHttp.json(200, { slug: 'okta' }))
    const { runtime } = runtimeOf(http)
    const status = await run(runtime, [
      'access',
      'providers',
      'create',
      '--tenant',
      'acme',
      '--catalog',
      'okta',
      '--issuer',
      'https://acme.okta.example',
      '--idp-client-id',
      'access-acme',
      '--idp-client-secret',
      'the-secret',
    ])
    expect(status).toBe(0)
    const body = JSON.parse(http.last.body ?? '{}') as Record<string, unknown>
    expect(body.slug).toBe('okta')
    expect(body.displayName).toBe('Okta')
    expect(body.idpScopes).toEqual(['openid', 'email', 'profile'])
    expect(body.idpAlgorithms).toEqual(['RS256'])
  })

  test('a tenant of a preset is written with the scopes of the vendor', async () => {
    const http = new FakeHttp(FakeHttp.json(200, { slug: 'acme' }))
    const { runtime } = runtimeOf(http)
    const status = await run(runtime, [
      'access',
      'tenants',
      'create',
      '--slug',
      'acme',
      '--display-name',
      'Acme Inc',
      '--catalog',
      'entra',
      '--issuer',
      'https://login.microsoftonline.com/the-tenant/v2.0',
      '--idp-client-id',
      'access-acme',
      '--idp-client-secret',
      'the-secret',
      '--client-id',
      'gateway-acme',
      '--client-secret',
      'the-secret',
    ])
    expect(status).toBe(0)
    const body = JSON.parse(http.last.body ?? '{}') as Record<string, unknown>
    expect(body.idpScopes).toEqual(['openid', 'email', 'profile'])
    expect(body.idpAlgorithms).toEqual(['RS256'])
  })
})

/**
 * The routes of the logins.
 *
 * A route names the tenant of a login and the provider the login signs in
 * at, and it waits for its proof: it routes nothing until the owner of
 * the domain publishes the challenge, or the operator of the platform
 * vouches for it.
 */
describe('the routes of the logins', () => {
  test('a route is written with the challenge of the domain', async () => {
    const http = new FakeHttp(
      FakeHttp.json(201, { route: { id: 'the-route', challenge: 'the-challenge' } })
    )
    const { runtime, out } = runtimeOf(http)
    const status = await run(runtime, [
      'access',
      'routes',
      'create',
      '--tenant',
      'acme',
      '--key',
      'acme.example',
      '--provider',
      'okta',
    ])
    expect(status).toBe(0)
    const body = JSON.parse(http.last.body ?? '{}') as Record<string, unknown>
    expect(body.tenant).toBe('acme')
    expect(body.key).toBe('acme.example')
    expect(body.provider).toBe('okta')
    // The challenge is the token the owner of the domain publishes.
    expect(out.join('\n')).toContain('_access.acme.example')
    expect(out.join('\n')).toContain('the-challenge')
  })

  test('the routes of the deployment are listed', async () => {
    const http = new FakeHttp(
      FakeHttp.json(200, { routes: [{ id: 'the-route', key: 'acme.example' }] })
    )
    const { runtime } = runtimeOf(http)
    const status = await run(runtime, ['access', 'routes', 'list', '--tenant', 'acme'])
    expect(status).toBe(0)
    expect(http.last.url).toBe('https://access.example.com/v1/admin/routes?tenant=acme')
  })

  test('a route is proved with the method the operator names', async () => {
    const http = new FakeHttp(
      FakeHttp.json(200, { route: { id: 'the-route', status: 'verified' } })
    )
    const { runtime } = runtimeOf(http)
    const status = await run(runtime, [
      'access',
      'routes',
      'verify',
      '--id',
      'the-route',
      '--verification',
      'dns',
    ])
    expect(status).toBe(0)
    expect(http.last.url).toBe('https://access.example.com/v1/admin/routes/the-route/verify')
    const body = JSON.parse(http.last.body ?? '{}') as Record<string, unknown>
    expect(body.status).toBe('verified')
    expect(body.verification).toBe('dns')
  })

  test('a method of the proof that is neither is refused', async () => {
    const http = new FakeHttp(FakeHttp.json(200, {}))
    const { runtime } = runtimeOf(http)
    await expect(
      run(runtime, ['access', 'routes', 'verify', '--id', 'the-route', '--verification', 'nowhere'])
    ).rejects.toThrow(/dns or operator/)
  })
})
