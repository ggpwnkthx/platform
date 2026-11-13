import { describe, expect, test } from 'bun:test'
import { tenantInputOf } from '../src/app/components/tenant-form'
import type { Tenant } from '../src/domains/access'
import type { SentForm } from '../src/app/middleware/forms'

/**
 * The form of a tenant, as the console reads it.
 *
 * The console names the values the operator wrote and leaves the ones
 * it does not: a value that is not named is a value that does not
 * change, and the tenant keeps the one it has.
 */

/** A form that carries the given fields. */
function formOf(fields: Record<string, string>): SentForm {
  return {
    get: (name) => fields[name] ?? '',
    all: (name) => (fields[name] === undefined ? [] : [fields[name] as string]),
    has: (name) => fields[name] !== undefined,
    fields,
  }
}

/** The tenant of the form: the row the console reads. */
const TENANT: Tenant = {
  id: 'the-id',
  slug: 'acme',
  displayName: 'Acme Inc',
  issuer: 'https://login.acme.example',
  idpClientId: 'access-acme',
  emailDomain: 'acme.example',
  clientId: 'gateway-acme',
  clientRedirectUris: ['https://gateway-acme.example.com/auth/callback'],
  autoProvision: false,
  autoProvisionAdmin: true,
  sharedClient: false,
  default: false,
  enabled: true,
  createdAt: '2026-01-08T10:05:00.000Z',
}

/** The fields of the form of a tenant. */
const FIELDS = {
  slug: 'acme',
  displayName: 'Acme Inc',
  issuer: 'https://login.acme.example',
  idpClientId: 'access-acme',
  idpClientSecret: '',
  idpRedirectUri: '',
  idpScopes: 'openid, email',
  emailDomain: 'acme.example',
  clientId: 'gateway-acme',
  clientSecret: '',
  clientRedirectUris: 'https://gateway-acme.example.com/auth/callback',
  autoProvision: 'false',
  autoProvisionAdmin: 'true',
  sharedClient: 'false',
  default: 'false',
  enabled: 'true',
}

describe('the form of a tenant', () => {
  test('the console names the values the operator wrote', () => {
    const input = tenantInputOf(formOf(FIELDS), true)
    expect(input.slug).toBe('acme')
    expect(input.displayName).toBe('Acme Inc')
    expect(input.issuer).toBe('https://login.acme.example')
    expect(input.idpClientId).toBe('access-acme')
    expect(input.idpScopes).toEqual(['openid', 'email'])
    expect(input.emailDomain).toBe('acme.example')
    expect(input.clientId).toBe('gateway-acme')
    expect(input.clientRedirectUris).toEqual(['https://gateway-acme.example.com/auth/callback'])
    expect(input.autoProvision).toBe(false)
    expect(input.autoProvisionAdmin).toBe(true)
    expect(input.enabled).toBe(true)
  })

  test('the console names no secret the operator did not write', () => {
    // A secret that is not named is a secret that does not change: the
    // tenant keeps the one it has (spec §10.2).
    const input = tenantInputOf(formOf(FIELDS), true)
    expect(input.idpClientSecret).toBeUndefined()
    expect(input.clientSecret).toBeUndefined()
  })

  test('the console clears the domain of the addresses when the operator empties it', () => {
    const input = tenantInputOf(formOf({ ...FIELDS, emailDomain: '' }), true)
    expect(input.emailDomain).toBeNull()
  })

  test('a credential of a tenant may not change the flags of the platform', () => {
    // The flags of the platform are the work of the operator of the
    // platform: the console sends what the row holds.
    const input = tenantInputOf(
      formOf({ ...FIELDS, sharedClient: 'true', default: 'true' }),
      false,
      TENANT
    )
    expect(input.sharedClient).toBe(false)
    expect(input.default).toBe(false)
  })
})
