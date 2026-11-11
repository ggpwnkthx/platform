/**
 * The catalog of the providers of the platform.
 *
 * Access speaks OpenID Connect, and every provider of a tenant is an
 * OpenID Connect provider: there is no vendor in the code of the login.
 * The catalog is what the platform supports out of the box, and it is a
 * table of defaults and not a table of drivers: a preset fills the
 * issuer, the scopes and the algorithms of a provider, and it says how
 * the client of Access is registered at the vendor.
 *
 * A tenant that brings its own provider names the free-form entry of the
 * catalog: the preset never constrains what a tenant registers.
 */

import { CliFailure } from './failure'

/**
 * A provider the platform supports out of the box.
 *
 * The preset is data: the login of Access is the same for every vendor,
 * and the differences are in the registration of the client.
 */
export interface CatalogEntry {
  /** The key of the preset: the name the operator names. */
  readonly key: string
  /** The name shown to a human. */
  readonly displayName: string
  /** The slug the provider of a tenant carries. */
  readonly slug: string
  /** The shape of the issuer of the provider. */
  readonly issuer: string
  /** The scopes Access asks the provider for. */
  readonly scopes: readonly string[]
  /** The algorithms a token of the provider may be signed with. */
  readonly algorithms: readonly string[]
  /** The steps of the registration of the client of Access at the vendor. */
  readonly steps: readonly string[]
}

/** The presets of the catalog, in the order they are shown. */
export const CATALOG: readonly CatalogEntry[] = [
  {
    key: 'entra',
    displayName: 'Microsoft Entra ID',
    slug: 'entra',
    issuer: 'https://login.microsoftonline.com/{tenant-id}/v2.0',
    scopes: ['openid', 'email', 'profile'],
    algorithms: ['RS256'],
    steps: [
      'Register an application of type web at Entra ID, with the redirect URI {ACCESS_PUBLIC_URL}/oauth/tenant/callback and no other.',
      'Create a client secret of the application and copy its value: it is shown once.',
      'Grant the delegated permissions openid, email and profile.',
      'The issuer of the tenant is the one of the application: https://login.microsoftonline.com/{tenant-id}/v2.0.',
    ],
  },
  {
    key: 'okta',
    displayName: 'Okta',
    slug: 'okta',
    issuer: 'https://{org}.okta.com',
    scopes: ['openid', 'email', 'profile'],
    algorithms: ['RS256'],
    steps: [
      'Create an OIDC web application at Okta, with the sign-in redirect URI {ACCESS_PUBLIC_URL}/oauth/tenant/callback.',
      'Copy the client id and the client secret of the application.',
      'Assign the application to the group of the people of the tenant.',
      'The issuer of the application is https://{org}.okta.com.',
    ],
  },
  {
    key: 'auth0',
    displayName: 'Auth0',
    slug: 'auth0',
    issuer: 'https://{tenant}.{region}.auth0.com',
    scopes: ['openid', 'email', 'profile'],
    algorithms: ['RS256'],
    steps: [
      'Create an application of type regular web application at Auth0.',
      'Set the allowed callback URL to {ACCESS_PUBLIC_URL}/oauth/tenant/callback and the allowed logout URL to the address of the application.',
      'Copy the client id and the client secret of the application.',
      'The issuer of the tenant is the one of the application: https://{tenant}.{region}.auth0.com.',
    ],
  },
  {
    key: 'keycloak',
    displayName: 'Keycloak',
    slug: 'keycloak',
    issuer: 'https://{host}/realms/{realm}',
    scopes: ['openid', 'email', 'profile'],
    algorithms: ['RS256'],
    steps: [
      'Create a client of type openid connect at the realm of the tenant, with the standard flow turned on.',
      'Set the valid redirect URI to {ACCESS_PUBLIC_URL}/oauth/tenant/callback.',
      'Copy the client id and the client secret of the client.',
      'The issuer of the realm is the one of the client: https://{host}/realms/{realm}.',
    ],
  },
  {
    key: 'google',
    displayName: 'Google Workspace',
    slug: 'google',
    issuer: 'https://accounts.google.com',
    scopes: ['openid', 'email', 'profile'],
    algorithms: ['RS256'],
    steps: [
      'Configure the OAuth consent screen of the project of the tenant.',
      'Create a web client with the authorized redirect URI {ACCESS_PUBLIC_URL}/oauth/tenant/callback.',
      'Copy the client id and the client secret of the client.',
      'The issuer of the client is https://accounts.google.com.',
    ],
  },
  {
    key: 'custom',
    displayName: 'Custom OpenID Connect provider',
    slug: 'custom',
    issuer: 'the issuer of the provider',
    scopes: ['openid', 'email', 'profile'],
    algorithms: ['RS256'],
    steps: [
      'Register a client at the provider, with the redirect URI {ACCESS_PUBLIC_URL}/oauth/tenant/callback.',
      'Copy the client id, the client secret and the issuer of the client.',
      'The provider must support PKCE with S256, and it must sign its tokens with RS256.',
    ],
  },
]

/**
 * The preset of the catalog, when the operator names one.
 *
 * @param key the key of the preset.
 */
export function catalogOf(key: string): CatalogEntry {
  const found = CATALOG.find((entry) => entry.key === key)
  if (!found) {
    const known = CATALOG.map((entry) => entry.key).join(', ')
    throw new CliFailure(
      `the catalog holds no preset named "${key}": it holds ${known}`,
      2,
      'invalid_argument'
    )
  }
  return found
}
