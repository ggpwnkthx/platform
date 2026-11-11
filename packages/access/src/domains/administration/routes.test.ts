import { describe, expect, test } from 'bun:test'
import { PLATFORM_SCOPE } from './credentials'
import { createFakes, serviceOf, type Fakes } from './fakes'
import { keyOf } from './routes'
import { AdministrationError } from './errors'

/**
 * The routes of the logins (spec §3.13, §10.18).
 *
 * A route names the tenant of a login and the provider the login signs in
 * at, and it routes nothing until the platform proves it: the proof is
 * the record the owner of the domain publishes, or the operator of the
 * platform that vouches for it.
 */

/** The scope of a credential of a tenant. */
const TENANT_SCOPE = { tenant: 'acme', operator: 'the-operator-of-acme' }

/** The tenant of the tests. */
async function tenantOfTheTests(fakes: Fakes): Promise<void> {
  await fakes.tenants.create(
    {
      slug: 'acme',
      displayName: 'Acme Inc',
      issuer: 'https://login.acme.example',
      idpClientId: 'access-acme',
      emailDomain: 'acme.example',
      clientId: 'gateway-acme',
      clientRedirectUris: [],
      autoProvision: false,
      sharedClient: false,
      isDefault: false,
      enabled: true,
    },
    undefined
  )
}

describe('the key of a route', () => {
  test('a domain is lowercased', () => {
    expect(keyOf('domain', 'ACME.example')).toBe('acme.example')
  })

  test('a domain that is not a name is refused', () => {
    expect(() => keyOf('domain', 'not a domain')).toThrow(AdministrationError)
    expect(() => keyOf('domain', '')).toThrow(AdministrationError)
  })

  test('an address that is not an address is refused', () => {
    expect(() => keyOf('address', 'alice')).toThrow(AdministrationError)
    expect(() => keyOf('address', 'alice@partner.example')).not.toThrow()
  })
})

describe('the routes of the administration', () => {
  test('a route that is created waits for its proof', async () => {
    const fakes = createFakes()
    await tenantOfTheTests(fakes)
    const service = serviceOf(fakes)
    const result = await service.upsertRoute(
      PLATFORM_SCOPE,
      { tenant: 'acme', kind: 'domain', key: 'acme.example' },
      { operator: 'the-operator', address: '10.0.0.1', requestId: 'the-request' }
    )
    expect(result.created).toBe(true)
    expect(result.route.status).toBe('pending')
    expect(result.route.challenge).toBeTruthy()
    expect(result.audit.action).toBe('route.created')
  })

  test('a route that is changed waits for its proof again', async () => {
    const fakes = createFakes()
    await tenantOfTheTests(fakes)
    const service = serviceOf(fakes)
    await fakes.providers.create(
      {
        tenantId: fakes.tenants.rows[0]!.id,
        kind: 'oidc',
        slug: 'okta',
        displayName: 'Okta',
        enabled: true,
        issuer: 'https://login.okta.example',
        idpClientId: 'access-acme-okta',
        idpClientSecret: 'the-secret',
        idpRedirectUri: 'https://access.example.com/oauth/tenant/callback',
        idpScopes: ['openid', 'email', 'profile'],
        idpAlgorithms: ['RS256'],
      },
      undefined
    )
    const context = { operator: 'the-operator', address: '10.0.0.1', requestId: 'the-request' }
    await service.upsertRoute(PLATFORM_SCOPE, { tenant: 'acme', key: 'acme.example' }, context)
    const verified = await service.verifyRoute(
      PLATFORM_SCOPE,
      fakes.routes.rows[0]!.id,
      { status: 'verified', verification: 'operator' },
      context
    )
    expect(verified.route.status).toBe('verified')

    const changed = await service.upsertRoute(
      PLATFORM_SCOPE,
      { tenant: 'acme', key: 'acme.example', provider: 'okta' },
      context
    )
    expect(changed.created).toBe(false)
    expect(changed.route.status).toBe('pending')
    expect(changed.route.provider).toBe('okta')
  })

  test('a tenant may not take the route of another tenant', async () => {
    const fakes = createFakes()
    await tenantOfTheTests(fakes)
    const service = serviceOf(fakes)
    const context = { operator: 'the-operator', address: '10.0.0.1', requestId: 'the-request' }
    await service.upsertRoute(PLATFORM_SCOPE, { tenant: 'acme', key: 'acme.example' }, context)
    await expect(
      service.upsertRoute(TENANT_SCOPE, { tenant: 'other', key: 'acme.example' }, context)
    ).rejects.toThrow(/may not act for this tenant/)
  })

  test('the proof of a domain is the record its owner publishes', async () => {
    const fakes = createFakes()
    await tenantOfTheTests(fakes)
    const service = serviceOf(fakes)
    const context = { operator: 'the-operator', address: '10.0.0.1', requestId: 'the-request' }
    const created = await service.upsertRoute(
      PLATFORM_SCOPE,
      { tenant: 'acme', key: 'acme.example' },
      context
    )
    const challenge = created.route.challenge
    // The owner of the domain has not published the record yet.
    await expect(
      service.verifyRoute(
        PLATFORM_SCOPE,
        created.route.id,
        { status: 'verified', verification: 'dns' },
        context
      )
    ).rejects.toThrow(/challenge/)
    expect(fakes.proof.asked).toEqual(['_access.acme.example'])

    fakes.proof.records['_access.acme.example'] = [challenge]
    const verified = await service.verifyRoute(
      PLATFORM_SCOPE,
      created.route.id,
      { status: 'verified', verification: 'dns' },
      context
    )
    expect(verified.route.status).toBe('verified')
    expect(verified.route.verification).toBe('dns')
  })

  test('a tenant may not vouch for a domain', async () => {
    const fakes = createFakes()
    await tenantOfTheTests(fakes)
    const service = serviceOf(fakes)
    const context = { operator: 'the-operator', address: '10.0.0.1', requestId: 'the-request' }
    const created = await service.upsertRoute(
      TENANT_SCOPE,
      { tenant: 'acme', key: 'acme.example' },
      context
    )
    await expect(
      service.verifyRoute(
        TENANT_SCOPE,
        created.route.id,
        { status: 'verified', verification: 'operator' },
        context
      )
    ).rejects.toThrow(/operator of the platform/)
  })

  test('an address publishes no record', async () => {
    const fakes = createFakes()
    await tenantOfTheTests(fakes)
    const service = serviceOf(fakes)
    const context = { operator: 'the-operator', address: '10.0.0.1', requestId: 'the-request' }
    const created = await service.upsertRoute(
      PLATFORM_SCOPE,
      { tenant: 'acme', kind: 'address', key: 'alice@partner.example' },
      context
    )
    await expect(
      service.verifyRoute(
        PLATFORM_SCOPE,
        created.route.id,
        { status: 'verified', verification: 'dns' },
        context
      )
    ).rejects.toThrow(/domain/)
  })

  test('the domain of a tenant is a route of the logins', async () => {
    const fakes = createFakes()
    await tenantOfTheTests(fakes)
    const service = serviceOf(fakes)
    const context = { operator: 'the-operator', address: '10.0.0.1', requestId: 'the-request' }
    // The operator of the platform vouches for the domain of the tenant.
    await service.upsertTenant(
      PLATFORM_SCOPE,
      {
        slug: 'acme',
        displayName: 'Acme Inc',
        issuer: 'https://login.acme.example',
        idpClientId: 'access-acme',
        idpClientSecret: 'the-secret',
        idpRedirectUri: 'https://access.example.com/oauth/tenant/callback',
        emailDomain: 'acme.example',
        clientId: 'gateway-acme',
        clientSecret: 'the-secret',
        clientRedirectUris: [],
        autoProvision: false,
        autoProvisionAdmin: false,
        sharedClient: false,
        isDefault: false,
        enabled: true,
      },
      context
    )
    expect(fakes.routes.rows).toHaveLength(1)
    expect(fakes.routes.rows[0]!.key).toBe('acme.example')
    expect(fakes.routes.rows[0]!.status).toBe('verified')
  })

  test('the domain of a tenant that a credential wrote waits for its proof', async () => {
    const fakes = createFakes()
    await tenantOfTheTests(fakes)
    const service = serviceOf(fakes)
    const context = { operator: 'the-operator', address: '10.0.0.1', requestId: 'the-request' }
    await service.upsertTenant(
      TENANT_SCOPE,
      {
        slug: 'acme',
        displayName: 'Acme Inc',
        issuer: 'https://login.acme.example',
        idpClientId: 'access-acme',
        idpClientSecret: 'the-secret',
        idpRedirectUri: 'https://access.example.com/oauth/tenant/callback',
        emailDomain: 'claimed.example',
        clientId: 'gateway-acme',
        clientSecret: 'the-secret',
        clientRedirectUris: [],
        autoProvision: false,
        autoProvisionAdmin: false,
        sharedClient: false,
        isDefault: false,
        enabled: true,
      },
      context
    )
    expect(fakes.routes.rows).toHaveLength(1)
    expect(fakes.routes.rows[0]!.status).toBe('pending')
  })

  test('a route of another tenant is not read by a tenant credential', async () => {
    const fakes = createFakes()
    await tenantOfTheTests(fakes)
    const service = serviceOf(fakes)
    const context = { operator: 'the-operator', address: '10.0.0.1', requestId: 'the-request' }
    const created = await service.upsertRoute(
      PLATFORM_SCOPE,
      { tenant: 'acme', key: 'acme.example' },
      context
    )
    await expect(
      service.verifyRoute(
        { tenant: 'other', operator: 'the-operator-of-other' },
        created.route.id,
        { status: 'verified', verification: 'operator' },
        context
      )
    ).rejects.toThrow(/forbidden|does not exist/)
  })
})
