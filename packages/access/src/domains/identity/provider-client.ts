/**
 * The client of an OpenID Connect provider of a tenant (spec §5.4).
 *
 * The client speaks to the provider of a tenant: it reads the discovery
 * document, it builds the url of the authorization, it exchanges the code
 * and it verifies the id token. The discovery document and the keys are
 * cached for ten minutes: a login does not call the provider of a tenant
 * on every request.
 *
 * The client is the **driver** of an OpenID Connect provider: it owns the
 * whole exchange with it, and it answers an identity it has validated
 * (spec §6.1). The identity domain never sees a token of a provider.
 */

import { createLocalJWKSet, decodeProtectedHeader, jwtVerify } from 'jose'
import { IdentityError, validateProviderToken } from './token'
import type {
  AuthorizationUrlOptions,
  ExchangeOptions,
  ProviderDriver,
  ProviderIdentity,
} from './provider-driver'

/** The answer of an outbound call. */
export interface TransportResponse {
  status: number
  body: string
}

/**
 * The target of an outbound call.
 *
 * The target carries the address the call is made to and the name of the
 * host it is made for: the `Host` header and the name the certificate is
 * checked against. The address is the one the guard of the addresses
 * checked, so that the call and the check speak of the same address.
 */
export interface CallTarget {
  /** The url the call is made to. */
  url: string
  /** The value of the `Host` header of the call. */
  host: string
  /**
   * The name the certificate of the call is checked against.
   *
   * It is empty when the host of the url is an address: the certificate
   * is then checked against that address.
   */
  servername: string
  /** True when the call is over https. */
  secure: boolean
}

/** The transport of the outbound calls. */
export interface HttpTransport {
  /** Calls a url. */
  call: (
    url: string,
    init: {
      method: string
      headers: Record<string, string>
      body?: string
      timeoutMs: number
      /** The address of the call; the url is used when there is none. */
      target?: CallTarget
    }
  ) => Promise<TransportResponse>
}

/**
 * The guard of the addresses of the providers.
 *
 * A tenant registers the issuer of its provider: the address is checked
 * before the call, so a tenant cannot make Access call a service of the
 * deployment. The guard returns the address of the call: the call is made
 * to the address that was checked, and not to the address the name
 * resolves to a second time.
 */
export interface AddressGuard {
  /** Checks the address of a url and pins the address of the call. */
  resolve: (url: string) => Promise<CallTarget>
}

/** The failure of a call to the provider of a tenant. */
export class ProviderError extends Error {
  constructor(
    /** The code of the failure. */
    readonly code: 'upstream_unavailable' | 'identity_rejected' | 'provider_error',
    message: string
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

/** The discovery document of a provider. */
export interface ProviderDiscovery {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  jwks_uri: string
}

/**
 * The reason of the refusal of a provider, as its answer names it.
 *
 * The answer of a provider that refuses an exchange carries a code —
 * `invalid_grant`, `invalid_client` — and a description. The code names
 * the failure, and the description of Entra ID names it a second time
 * with a code of its own (`AADSTS7000218`). Nothing else of the answer
 * is kept: a description is the answer of the provider, and it may
 * carry anything.
 *
 * @param body the body of the answer of the provider.
 * @returns the codes of the refusal, or `unknown`.
 */
export function refusalOfProvider(body: string): string {
  let parsed: { error?: unknown; error_description?: unknown }
  try {
    parsed = JSON.parse(body) as { error?: unknown; error_description?: unknown }
  } catch {
    return 'unknown'
  }
  const names: string[] = []
  const code = typeof parsed.error === 'string' ? parsed.error.trim() : ''
  if (/^[A-Za-z0-9_.-]{1,64}$/.test(code)) names.push(code)
  const description = typeof parsed.error_description === 'string' ? parsed.error_description : ''
  const own = description.match(/AADSTS\d+/i)?.[0]
  if (own) names.push(own.toUpperCase())
  return names.length > 0 ? names.join(', ') : 'unknown'
}

/**
 * The reason of a refusal of the signature of a token.
 *
 * The library of the tokens names the failure of the verification, and
 * the name says which one it was: a token signed with a key the
 * provider does not publish is not a token with a bad signature.
 *
 * @param error the failure of the verification.
 * @returns the reason of the refusal.
 */
export function reasonOfVerification(error: unknown): string {
  const code = (error as { code?: unknown })?.code
  switch (code) {
    case 'ERR_JWKS_NO_MATCHING_KEY':
      return 'the provider does not publish the key that signed the token'
    case 'ERR_JWKS_MULTIPLE_MATCHING_KEYS':
      return 'the provider publishes several keys that could have signed the token'
    case 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED':
      return 'the signature of the token is not the one of the provider'
    case 'ERR_JWT_EXPIRED':
      return 'the token has expired'
    case 'ERR_JWT_INVALID':
    case 'ERR_JWS_INVALID':
      return 'the token is not a valid token of the provider'
    default:
      return 'the token of the provider was refused'
  }
}

/** The client of an OpenID Connect provider of a tenant. */
export class ProviderClient implements ProviderDriver {
  readonly kind = 'oidc' as const
  private discoveryCache: { document: ProviderDiscovery; at: number } | null = null
  private jwksCache: { keys: unknown; at: number } | null = null
  /** The moment of the last refresh of the keys of the provider. */
  private jwksRefreshedAt: number | null = null

  constructor(
    private readonly options: {
      issuer: string
      clientId: string
      clientSecret: string
      redirectUri: string
      scopes: string[]
      algorithms: string[]
      transport: HttpTransport
      /** The guard of the addresses; without it every address is allowed. */
      guard?: AddressGuard
      cacheTtlMs?: number
      /** How long two refreshes of the keys are apart, in milliseconds. */
      refreshIntervalMs?: number
      now?: () => number
      /** How long a call to the provider may take, in milliseconds. */
      timeoutMs?: number
      /** How long the clock of the token is tolerated, in seconds. */
      clockSkewSeconds?: number
    }
  ) {}

  /** How long the discovery document and the keys are cached. */
  private get ttl(): number {
    return this.options.cacheTtlMs ?? 600_000
  }

  /** How long two refreshes of the keys are apart. */
  private get refreshInterval(): number {
    return this.options.refreshIntervalMs ?? 30_000
  }

  /** The moment of the cache. */
  private get now(): number {
    return (this.options.now ?? (() => Date.now()))()
  }

  /**
   * Calls the provider.
   *
   * A provider that cannot be reached is a refusal of the login: the
   * reason of the failure of the network never reaches the caller.
   */
  private async call(
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string }
  ): Promise<TransportResponse> {
    try {
      // The guard checks the address and pins it: the call is made to the
      // address that was checked, and the name of the host does not
      // resolve it a second time.
      const target = await this.options.guard?.resolve(url)
      return await this.options.transport.call(url, {
        ...init,
        timeoutMs: this.options.timeoutMs ?? 5_000,
        ...(target ? { target } : {}),
      })
    } catch (error) {
      if (error instanceof ProviderError) throw error
      throw new ProviderError('upstream_unavailable', 'the provider of the tenant is not reachable')
    }
  }

  /**
   * The discovery document of the provider.
   *
   * The issuer of the document has to be exactly the issuer of the
   * tenant: a provider that names another issuer is refused, for the same
   * reason the gateway refuses it.
   */
  async discovery(): Promise<ProviderDiscovery> {
    if (this.discoveryCache && this.now - this.discoveryCache.at < this.ttl) {
      return this.discoveryCache.document
    }
    const url = `${this.options.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`
    const response = await this.call(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
    })
    if (response.status !== 200) {
      throw new ProviderError(
        'upstream_unavailable',
        'the discovery document of the provider could not be read'
      )
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(response.body)
    } catch {
      throw new ProviderError(
        'provider_error',
        'the discovery document of the provider is not json'
      )
    }
    const document = parsed as Partial<ProviderDiscovery>
    if (
      typeof document.issuer !== 'string' ||
      typeof document.authorization_endpoint !== 'string' ||
      typeof document.token_endpoint !== 'string' ||
      typeof document.jwks_uri !== 'string'
    ) {
      throw new ProviderError(
        'provider_error',
        'the discovery document of the provider is incomplete'
      )
    }
    if (document.issuer !== this.options.issuer) {
      // The two issuers are in the reason: a tenant that registered the
      // issuer with a trailing slash, or in another case, or with the
      // name of the domain instead of the identifier of the tenant, is
      // refused here — and the reason says which of the two is which.
      throw new ProviderError(
        'identity_rejected',
        `the issuer of the provider is not the issuer of the tenant (the document names ${document.issuer}, the tenant names ${this.options.issuer})`
      )
    }
    const complete: ProviderDiscovery = {
      issuer: document.issuer,
      authorization_endpoint: document.authorization_endpoint,
      token_endpoint: document.token_endpoint,
      jwks_uri: document.jwks_uri,
    }
    this.discoveryCache = { document: complete, at: this.now }
    return complete
  }

  /** The keys of the provider. */
  async jwks(options: { refresh?: boolean } = {}): Promise<unknown> {
    const fresh = this.jwksCache !== null && this.now - this.jwksCache.at < this.ttl
    if (fresh && !options.refresh) {
      return this.jwksCache!.keys
    }
    // A refresh is not done on every call: a provider that is hammered
    // with tokens it did not sign is not hammered with calls (spec §6.6).
    // The first refresh of a rotation is always allowed.
    if (
      options.refresh &&
      this.jwksRefreshedAt !== null &&
      this.now - this.jwksRefreshedAt < this.refreshInterval
    ) {
      return this.jwksCache!.keys
    }
    const discovery = await this.discovery()
    const response = await this.call(discovery.jwks_uri, {
      method: 'GET',
      headers: { accept: 'application/json' },
    })
    if (response.status !== 200) {
      throw new ProviderError('upstream_unavailable', 'the keys of the provider could not be read')
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(response.body)
    } catch {
      throw new ProviderError('provider_error', 'the keys of the provider are not json')
    }
    this.jwksCache = { keys: parsed, at: this.now }
    if (options.refresh) {
      this.jwksRefreshedAt = this.now
    }
    return parsed
  }

  /**
   * The url of the authorization of the provider.
   *
   * Access sends a fresh state and a fresh nonce, and the challenge of the
   * PKCE: the verifier stays in the state cookie of the login.
   */
  async authorizationUrl(options: AuthorizationUrlOptions): Promise<string> {
    const discovery = await this.discovery()
    const url = new URL(discovery.authorization_endpoint)
    url.searchParams.set('client_id', this.options.clientId)
    url.searchParams.set('redirect_uri', this.options.redirectUri)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', options.scopes.join(' '))
    url.searchParams.set('state', options.state)
    url.searchParams.set('nonce', options.nonce)
    url.searchParams.set('code_challenge', options.challenge)
    url.searchParams.set('code_challenge_method', 'S256')
    return url.toString()
  }

  /**
   * Exchanges the code of the provider for the identity of the caller.
   *
   * The client authenticates itself with its secret and it presents the
   * verifier of the PKCE: a provider that does not support the PKCE is
   * refused at the registration of the tenant.
   *
   * The token of the provider is validated before it is answered: the
   * issuer, the audience, the nonce, the algorithm, the clock and the
   * subject (spec §6.1). A token that does not pass every check is
   * refused, and the reason is never in the answer of the browser.
   */
  async exchange(options: ExchangeOptions): Promise<ProviderIdentity> {
    const discovery = await this.discovery()
    const authorization = Buffer.from(
      `${this.options.clientId}:${this.options.clientSecret}`
    ).toString('base64')
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: options.code,
      redirect_uri: this.options.redirectUri,
      client_id: this.options.clientId,
      code_verifier: options.verifier,
    })
    const response = await this.call(discovery.token_endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
        authorization: `Basic ${authorization}`,
      },
      body: body.toString(),
    })
    if (response.status !== 200) {
      // The reason of the refusal of the provider is in the log and
      // never in the answer of the browser: the code of the answer of
      // the provider names the failure (`invalid_grant`, `invalid_client`),
      // and Entra ID names it a second time in its own code
      // (`AADSTS7000218`). Nothing else of the answer is kept.
      throw new ProviderError(
        'provider_error',
        `the provider refused the exchange of the code (${refusalOfProvider(response.body)})`
      )
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(response.body)
    } catch {
      throw new ProviderError('provider_error', 'the answer of the provider is not json')
    }
    const idToken = (parsed as { id_token?: unknown }).id_token
    if (typeof idToken !== 'string' || idToken.length === 0) {
      throw new ProviderError('provider_error', 'the answer of the provider has no id token')
    }
    return await this.identityOf(idToken, options.nonce)
  }

  /**
   * The identity the token of the provider carries.
   *
   * The signature is verified with the keys of the provider, and the
   * claims are validated with the rules of the tenant (spec §6.1).
   */
  private async identityOf(idToken: string, nonce: string): Promise<ProviderIdentity> {
    const claims = await this.verify(idToken)
    try {
      return validateProviderToken({
        token: {
          issuer: claims.issuer,
          audience: claims.audience,
          authorizedParty: claims.authorizedParty,
          subject: claims.subject,
          nonce: claims.nonce,
          algorithm: claims.algorithm,
          expiresAt: claims.expiresAt,
          issuedAt: claims.issuedAt,
          email: claims.email,
          name: claims.name,
        },
        expectedIssuer: this.options.issuer,
        expectedAudience: this.options.clientId,
        expectedNonce: nonce,
        allowedAlgorithms: this.options.algorithms,
        skewSeconds: this.options.clockSkewSeconds ?? 60,
      })
    } catch (error) {
      if (error instanceof IdentityError) {
        // The message of the failure names the check that failed: it is
        // the reason of the refusal, and it is in the log.
        throw new ProviderError('identity_rejected', error.message)
      }
      throw error
    }
  }

  /** Verifies the signature of the id token of the provider. */
  private async verify(idToken: string): Promise<{
    issuer?: string
    audience?: string | string[]
    authorizedParty?: string
    subject?: string
    nonce?: string
    algorithm?: string
    expiresAt?: number
    issuedAt?: number
    email?: string
    name?: string
  }> {
    const jwks = await this.keysFor(idToken)
    try {
      const verified = await jwtVerify(idToken, createLocalJWKSet(jwks as { keys: [] }))
      const header = verified.protectedHeader
      const payload = verified.payload
      return {
        issuer: typeof payload.iss === 'string' ? payload.iss : undefined,
        audience: payload.aud as string | string[] | undefined,
        authorizedParty: typeof payload.azp === 'string' ? payload.azp : undefined,
        subject: typeof payload.sub === 'string' ? payload.sub : undefined,
        nonce: typeof payload.nonce === 'string' ? payload.nonce : undefined,
        algorithm: header.alg,
        expiresAt: typeof payload.exp === 'number' ? payload.exp : undefined,
        issuedAt: typeof payload.iat === 'number' ? payload.iat : undefined,
        email: typeof payload.email === 'string' ? payload.email : undefined,
        name: typeof payload.name === 'string' ? payload.name : undefined,
      }
    } catch (error) {
      throw new ProviderError('identity_rejected', reasonOfVerification(error))
    }
  }

  /**
   * The keys that verify a token of a provider.
   *
   * A provider that rotates its signing key publishes a new one, and the
   * keys of the provider are cached for ten minutes. A token that names a
   * key that the cache does not have is therefore the sign of a rotation
   * and not a bad token: the keys are read again once, and the token is
   * verified against them (spec §6.6).
   */
  private async keysFor(idToken: string): Promise<{ keys: [] }> {
    const jwks = (await this.jwks()) as { keys: { kid?: string }[] }
    let kid: string | undefined
    try {
      kid = decodeProtectedHeader(idToken).kid
    } catch {
      kid = undefined
    }
    // A token without an identifier of a key is verified against the keys
    // of the provider: a provider that signs with one key does not name
    // it.
    if (!kid) return jwks as { keys: [] }
    const known = (jwks.keys ?? []).some((key) => key.kid === kid)
    if (known) return jwks as { keys: [] }
    return (await this.jwks({ refresh: true })) as { keys: [] }
  }
}
