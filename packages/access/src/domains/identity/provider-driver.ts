/**
 * The driver of a provider of a tenant (spec §5.4).
 *
 * A provider of a tenant is something Access sends a browser to, and
 * something that gives an identity back. The OpenID Connect provider of a
 * tenant is one kind of it, and the local provider of the platform is
 * another: the login of the identity domain does not know which one it
 * signs a caller in at.
 *
 * The driver owns the whole exchange with the provider: the url of the
 * authorization, the exchange of the code and the validation of the
 * identity. The identity domain owns the rest: the state of the login,
 * the tenant and the mapping of the identity to a principal.
 */

/** The kind of a provider. */
type ProviderKind = 'oidc' | 'local'

/**
 * The identity a provider carries.
 *
 * The subject is the key of the mapping (spec §6.2): it is the `sub` of
 * an OpenID Connect provider and the id of the credential of a local one.
 * The e-mail and the name are display values and never a key.
 */
export interface ProviderIdentity {
  /** The subject of the provider: the key of the mapping. */
  subject: string
  /** The e-mail the provider publishes, when it publishes one. */
  email?: string
  /** The name the provider publishes, when it publishes one. */
  name?: string
}

/** The options of the beginning of an authorization at a provider. */
export interface AuthorizationUrlOptions {
  /** The state Access sends to the provider. */
  state: string
  /** The nonce of the login in flight. */
  nonce: string
  /** The challenge of the PKCE of the provider. */
  challenge: string
  /** The scopes Access asks the provider for. */
  scopes: string[]
}

/** The options of the exchange of a code of a provider. */
export interface ExchangeOptions {
  /** The code the provider gave. */
  code: string
  /** The verifier of the PKCE of the provider. */
  verifier: string
  /** The nonce of the login in flight. */
  nonce: string
}

/**
 * The driver of a provider.
 *
 * The failure of a driver is the failure of a provider: it is a
 * `ProviderError`, and the identity domain turns it into a refusal of
 * the login (spec §5.6).
 */
export interface ProviderDriver {
  /** The kind of the provider. */
  readonly kind: ProviderKind
  /**
   * The url the browser is sent to.
   *
   * The driver builds the url with the state, the nonce and the challenge
   * it is given: the state of the login is bound to them.
   */
  authorizationUrl(options: AuthorizationUrlOptions): Promise<string>
  /**
   * Exchanges the code of the provider for its identity.
   *
   * The driver validates what it gets: an OpenID Connect driver verifies
   * the token of the provider before it answers (spec §6.1), and a
   * driver never answers an identity it did not check.
   */
  exchange(options: ExchangeOptions): Promise<ProviderIdentity>
}
