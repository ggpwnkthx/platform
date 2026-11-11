/**
 * The tenant of a login (spec §5.2).
 *
 * The tenant of a login is resolved in this order: the client of the
 * request, the parameter of the tenant, the hint of the e-mail and the
 * tenant that is the default. The parameter and the hint are only usable
 * when the tenant of the client is shared: a shared client is a
 * deliberate weakening and it is refused by default.
 */

/**
 * A provider of a tenant, as the identity domain knows it.
 *
 * A tenant signs its people in at one or more providers, and the slug of
 * the provider is the handle a login names (spec §5.2). The slug never
 * changes: a principal carries the slug of the provider it was created
 * at (spec §6.2).
 */
export interface ProviderOfLogin {
  /** The name of the provider inside its tenant. */
  slug: string
  /** The kind of the provider: an OpenID Connect one, or the local one. */
  kind: 'oidc' | 'local'
  /** The name shown to a human. */
  displayName: string
  /** False when the provider is not asked to sign anybody in. */
  enabled: boolean
  /** The issuer of an OpenID Connect provider. */
  issuer: string
  /** The client id of Access at an OpenID Connect provider. */
  idpClientId: string
  /** The url of Access at an OpenID Connect provider. */
  idpRedirectUri: string
  /** The scopes Access asks an OpenID Connect provider for. */
  scopes: string[]
  /** The algorithms a token of an OpenID Connect provider may use. */
  algorithms: string[]
}

/** The tenant of a login, as the identity domain knows it. */
export interface TenantOfLogin {
  id: string
  slug: string
  enabled: boolean
  sharedClient: boolean
  isDefault: boolean
  /** Whether an unknown external identity creates a principal row. */
  autoProvision: boolean
  /** The domain of the tenant; a hint, never an authorization. */
  emailDomain: string | null
  /** The client id of the gateway of the tenant. */
  clientId: string
  /**
   * The urls the gateway of the tenant is registered with.
   *
   * The browser is sent back to one of them with the code of the login:
   * a url that is not in this list is never sent a code.
   */
  clientRedirectUris: string[]
  /** The providers the tenant signs its people in at. */
  providers: ProviderOfLogin[]
}

/** The request of an authorization, as the resolution reads it. */
export interface AuthorizationRequest {
  /** The client id of the request. */
  clientId: string
  /**
   * The url the browser is to be sent back to.
   *
   * It is a value the caller controls, so it is checked against the ones
   * the gateway of the client is registered with.
   */
  redirectUri: string
  /** The tenant that the request names, when it names one. */
  tenant?: string
  /** The hint of the caller, when there is one. */
  loginHint?: string
}

/** The failure of the resolution of a tenant. */
export class TenantResolutionError extends Error {
  constructor(
    /** The code of the failure. */
    readonly code: 'invalid_request' | 'tenant_disabled',
    message: string
  ) {
    super(message)
    this.name = 'TenantResolutionError'
  }
}

/** The storage of the tenants of the identity. */
export interface TenantLookup {
  /** The tenant of a client id of a gateway. */
  findByClientId(clientId: string): Promise<TenantOfLogin | null>
  /** The tenant of a slug. */
  findBySlug(slug: string): Promise<TenantOfLogin | null>
  /** The tenant of a domain of the e-mail. */
  findByEmailDomain(emailDomain: string): Promise<TenantOfLogin | null>
  /** The tenant that is the default of the platform. */
  findDefault(): Promise<TenantOfLogin | null>
}

/**
 * The slug of the default provider of a tenant (spec §3.11).
 *
 * The default provider is the one the tenant row carries: it is the
 * registration of the tenant, and it is written with it. The slug never
 * changes, and a principal carries it (spec §6.2).
 */
export const DEFAULT_PROVIDER_SLUG = 'default'

/**
 * The resolution of the tenant of a login.
 *
 * A tenant of the login is the tenant of the request. A resolution that
 * asks for the address of the caller is the resolution of a shared client
 * that names no tenant: the address of the caller is what names the
 * tenant of the login (spec §5.2).
 */
export type TenantResolution =
  | {
      /** The tenant of the login. */
      readonly tenant: TenantOfLogin
      /** The tenant that owns the client of the request. */
      readonly client: TenantOfLogin
      /** The login names its tenant. */
      readonly discovery: false
    }
  | {
      /** The tenant of the login is not known yet. */
      readonly tenant?: undefined
      /** The tenant that owns the client of the request. */
      readonly client: TenantOfLogin
      /** The caller has to be asked for the address of the login. */
      readonly discovery: true
    }

/**
 * Resolves the tenant of a login.
 *
 * The first match wins. A client that names no tenant is an
 * `invalid_request` and a tenant that is disabled is a
 * `tenant_disabled`.
 *
 * The redirect uri of the request is checked against the ones the
 * gateway of the client is registered with, before the tenant is
 * resolved: the url the browser comes back to belongs to the gateway
 * that presented the client id, and it is a value the caller controls.
 */
export async function resolveTenant(
  lookup: TenantLookup,
  request: AuthorizationRequest
): Promise<TenantResolution> {
  const client = await lookup.findByClientId(request.clientId)
  if (!client) {
    throw new TenantResolutionError(
      'invalid_request',
      'the client id of the request names no tenant of the platform'
    )
  }

  // The redirect uri is the url the code of the login is sent to: it is
  // checked against the registered ones before anything else happens, so
  // that a url that is not registered is never sent a code.
  if (!client.clientRedirectUris.includes(request.redirectUri)) {
    throw new TenantResolutionError(
      'invalid_request',
      'the redirect uri of the request is not registered for the client'
    )
  }

  let tenant = client

  // The parameter of the tenant and the hint are only usable when the
  // client is shared: a parameter that a caller controls may not move a
  // login to another tenant.
  if (client.sharedClient) {
    if (request.tenant) {
      const named = await lookup.findBySlug(request.tenant)
      if (!named) {
        throw new TenantResolutionError(
          'invalid_request',
          'the tenant of the request does not exist'
        )
      }
      tenant = named
    } else if (request.loginHint) {
      const domain = domainOf(request.loginHint)
      const hinted = domain ? await lookup.findByEmailDomain(domain) : null
      if (hinted) {
        tenant = hinted
      } else {
        // An address that names no tenant is not a refusal: the login
        // goes on with the default tenant of the platform (spec §5.2).
        const fallback = await lookup.findDefault()
        if (fallback) tenant = fallback
      }
    } else {
      // A shared client that names no tenant is a client that serves
      // several tenants: the address of the caller is what names the one
      // (spec §5.2.2).
      return { client, discovery: true }
    }
  }

  if (!tenant.enabled) {
    throw new TenantResolutionError('tenant_disabled', 'the tenant of the login is disabled')
  }
  return { tenant, client, discovery: false }
}

/** The domain of an e-mail, when the value is one. */
export function domainOf(hint: string): string | null {
  const at = hint.lastIndexOf('@')
  if (at <= 0 || at === hint.length - 1) return null
  return hint.slice(at + 1).toLowerCase()
}
