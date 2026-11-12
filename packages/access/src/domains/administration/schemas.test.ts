import { describe, expect, test } from 'bun:test'
import { ProviderBody, TenantBody } from './schemas'

/**
 * The bodies of the administration (spec §10.1).
 *
 * A body is validated before the database is touched: an answer that
 * refuses a body never opens a connection.
 */

describe('the bodies of the administration', () => {
  test('a value that is empty is not a name', () => {
    // A field that a call sends empty is a field the call does not
    // name: a change that sends an empty secret keeps the secret the
    // tenant has (spec §10.2).
    const body = TenantBody.parse({
      slug: 'acme',
      displayName: 'Acme Inc',
      issuer: 'https://login.acme.example',
      idpClientId: 'access-acme',
      idpClientSecret: '',
      idpRedirectUri: '',
      emailDomain: '',
      clientId: 'gateway-acme',
      clientSecret: '',
    })
    expect(body.idpClientSecret).toBeUndefined()
    expect(body.idpRedirectUri).toBeUndefined()
    expect(body.emailDomain).toBeUndefined()
    expect(body.clientSecret).toBeUndefined()
    // The fields that are named are the ones that are kept.
    expect(body.issuer).toBe('https://login.acme.example')
    expect(body.idpClientId).toBe('access-acme')
    expect(body.clientId).toBe('gateway-acme')
  })

  test('a value that holds spaces is empty', () => {
    const body = TenantBody.parse({
      slug: 'acme',
      displayName: 'Acme Inc',
      clientId: 'gateway-acme',
      idpClientSecret: '   ',
    })
    expect(body.idpClientSecret).toBeUndefined()
  })

  test('a body of a provider that sends an empty secret names no secret', () => {
    const body = ProviderBody.parse({
      tenant: 'acme',
      slug: 'okta',
      issuer: 'https://login.okta.example',
      idpClientId: 'access-acme-okta',
      idpClientSecret: '',
    })
    expect(body.idpClientSecret).toBeUndefined()
    expect(body.issuer).toBe('https://login.okta.example')
  })

  test('a body that names a secret of nothing is refused', () => {
    // The secret of a provider is a value: a body that sends one that
    // is not a string is a body that is not valid.
    const result = TenantBody.safeParse({
      slug: 'acme',
      displayName: 'Acme Inc',
      clientId: 'gateway-acme',
      idpClientSecret: 42,
    })
    expect(result.success).toBe(false)
  })

  test('a body that names no slug is refused', () => {
    // The slug is the key of the row: a body that names none is a body
    // that names no tenant.
    const result = TenantBody.safeParse({
      displayName: 'Acme Inc',
      clientId: 'gateway-acme',
    })
    expect(result.success).toBe(false)
  })

  test('a body that names no value of the tenant is a body that changes nothing', () => {
    // A change names the values it changes: a body that names none of
    // them keeps every value the tenant has.
    const body = TenantBody.parse({ slug: 'acme' })
    expect(Object.keys(body)).toEqual(['slug'])
  })
})
