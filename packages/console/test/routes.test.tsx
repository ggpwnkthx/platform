import { describe, expect, test } from 'bun:test'
import { RouteForm, RouteRow } from '../src/app/components/route-form'
import { ACTIONS, allowanceOf, consoleAbility, SUBJECTS } from '../src/domains/ability'
import type { Provider, Route } from '../src/domains/access'
import { scopeOf } from '../src/domains/operators'

/**
 * The routes of a tenant, as the console draws them.
 *
 * The routes are the domains and the addresses that name the tenant of a
 * login, and they wait for their proof: the row names the record the
 * owner of the domain publishes.
 */

const provider: Provider = {
  id: 'the-provider',
  tenant: 'acme',
  kind: 'oidc',
  slug: 'okta',
  displayName: 'Okta',
  enabled: true,
  issuer: 'https://acme.okta.example',
  idpClientId: 'access-acme',
  idpRedirectUri: 'https://access.example.com/oauth/tenant/callback',
  idpScopes: ['openid', 'email', 'profile'],
  idpAlgorithms: ['RS256'],
  createdAt: '2026-01-08T10:05:00.000Z',
}

const route: Route = {
  id: 'the-route',
  kind: 'domain',
  key: 'acme.example',
  tenant: 'acme',
  provider: 'okta',
  status: 'pending',
  verification: null,
  challenge: 'the-challenge',
  verifiedAt: null,
  verifiedBy: null,
  createdAt: '2026-01-08T10:05:00.000Z',
}

const credentials = { platform: 'the-platform-token-0001', tenants: {} }

/** Whether an operator vouches for a domain: the answer of its ability. */
const vouchOf = (key: string) =>
  allowanceOf(consoleAbility(scopeOf('acme', [key], credentials)), ACTIONS.vouch, SUBJECTS.route)
const allowed = vouchOf('console.platform')
const refused = vouchOf('console.admin')

describe('the routes of a tenant', () => {
  test('the form asks for the key of the route and the provider of the login', async () => {
    const html = String(
      await (<RouteForm action="/operators/tenants/acme" providers={[provider]} />).toString()
    )
    expect(html).toContain('name="key"')
    expect(html).toContain('name="kind"')
    expect(html).toContain('value="okta"')
    expect(html).toContain('the default provider of the tenant')
  })

  test('the row names the record the owner of the domain publishes', async () => {
    const html = String(
      await (<RouteRow route={route} action="/operators/tenants/acme" vouch={allowed} />).toString()
    )
    expect(html).toContain('_access.acme.example')
    expect(html).toContain('the-challenge')
    expect(html).toContain('Check the record')
    expect(html).toContain('Vouch for it')
    expect(html).toContain('value="operator"')
    expect(html).toContain('waits for its proof')
  })

  test('a tenant that is not the operator of the platform may not vouch for a domain', async () => {
    // The act is drawn disabled, with the reason of the rule: the reader
    // learns that the platform vouches, instead of finding an absence.
    const html = String(
      await (<RouteRow route={route} action="/operators/tenants/acme" vouch={refused} />).toString()
    )
    expect(html).toContain('Check the record')
    expect(html).toContain('Vouch for it')
    expect(html).toContain('aria-disabled="true"')
    expect(html).toContain('Only an operator of the platform vouches for a domain')
    // No form sends the proof of the operator: the button sends nothing.
    expect(html).not.toContain('value="operator"')
  })

  test('a proved route offers no proof', async () => {
    const proved: Route = { ...route, status: 'verified', verification: 'dns' }
    const html = String(
      await (
        <RouteRow route={proved} action="/operators/tenants/acme" vouch={allowed} />
      ).toString()
    )
    expect(html).toContain('verified')
    expect(html).not.toContain('Check the record')
    expect(html).not.toContain('Vouch for it')
  })
})
