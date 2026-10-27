/**
 * The sign-in of the console at the access service.
 *
 * The console is a client of the tenant, like the gateway is: it sends
 * the browser to the authorization endpoint of the access service with
 * PKCE (`S256`), a `state` and a `nonce`, it exchanges the code with its
 * own credential, and it verifies the id token against the keys of the
 * service. The access token that comes with it is the credential the
 * gateway accepts for the calls of the data.
 *
 * The browser reaches the access service at the endpoints of the
 * discovery document; the console reaches it at its own url. The two
 * may differ: the service of a composition has an internal name.
 */

import { createHash, randomBytes } from 'node:crypto'
import { createRemoteJWKSet, customFetch, type JWTPayload, jwtVerify } from 'jose'
import { bodyOf, call, type Fetch } from '../transport'

/** The discovery document of the access service, as far as the console reads it. */
export interface Discovery {
  readonly issuer: string
  readonly authorizationEndpoint: string
}

/** The tokens of a login. */
export interface Tokens {
  readonly accessToken: string
  readonly idToken: string
  /** The moment the access token expires, in milliseconds. */
  readonly expiresAt: number
}

/** The identity the id token names. */
export interface Identity {
  readonly subject: string
  readonly tenant: string
  readonly email: string | null
  readonly name: string | null
  readonly roles: readonly string[]
}

/** A login that the access service refused, or that did not hold. */
export class LoginError extends Error {
  override readonly name = 'LoginError'
  /** The code of the refusal. */
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

/** Creates a random value of 32 bytes, for a state, a nonce or a verifier. */
export function randomValue(): string {
  return randomBytes(32).toString('base64url')
}

/** The challenge of a verifier: `S256`. */
export function challengeOf(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

/**
 * Answers the target of a redirect when it is a path of the console.
 *
 * The target of the redirect after a login is a value of the caller, so
 * it is always a relative path: a crafted value cannot turn the login
 * into an open redirect.
 */
export function safeRedirect(target: string | null | undefined): string {
  if (!target?.startsWith('/') || target.startsWith('//')) return '/'
  // A backslash, or a character of control, is read by some browsers as
  // the start of another host.
  if (target.includes('\\') || [...target].some((character) => character.charCodeAt(0) < 0x20)) {
    return '/'
  }
  if (target.startsWith('/auth/')) return '/'
  return target
}

/** The options of the provider. */
export interface ProviderOptions {
  /** The url the console reaches the access service at. */
  readonly accessUrl: string
  readonly clientId: string
  readonly clientSecret: string
  readonly timeoutMs: number
  readonly fetch?: Fetch
}

/** The access service, as the provider of the sign-in of the console. */
export class AccessProvider {
  readonly #options: ProviderOptions
  readonly #fetch: Fetch
  #discovery: { value: Discovery; at: number } | null = null
  readonly #keys: ReturnType<typeof createRemoteJWKSet>

  constructor(options: ProviderOptions) {
    this.#options = options
    this.#fetch = options.fetch ?? fetch
    const fetcher = this.#fetch
    this.#keys = createRemoteJWKSet(new URL(`${options.accessUrl}/oauth/jwks`), {
      timeoutDuration: options.timeoutMs,
      [customFetch]: (url, init) => fetcher(url, init),
    })
  }

  /** The discovery document, read once and kept for ten minutes. */
  async discovery(): Promise<Discovery> {
    const now = Date.now()
    if (this.#discovery && now - this.#discovery.at < 10 * 60 * 1000) {
      return this.#discovery.value
    }
    const response = await call(
      'access service',
      this.#fetch,
      `${this.#options.accessUrl}/.well-known/openid-configuration`,
      { headers: { accept: 'application/json' } },
      this.#options.timeoutMs
    )
    const body = (await bodyOf(response)) as Record<string, unknown> | null
    if (
      !response.ok ||
      typeof body?.issuer !== 'string' ||
      typeof body.authorization_endpoint !== 'string'
    ) {
      throw new LoginError(
        'discovery_failed',
        'the access service did not answer its discovery document'
      )
    }
    const value = { issuer: body.issuer, authorizationEndpoint: body.authorization_endpoint }
    this.#discovery = { value, at: now }
    return value
  }

  /** The url of the authorization endpoint the browser is sent to. */
  async authorizationUrl(options: {
    redirectUri: string
    state: string
    nonce: string
    verifier: string
  }): Promise<string> {
    const discovery = await this.discovery()
    const url = new URL(discovery.authorizationEndpoint)
    url.searchParams.set('client_id', this.#options.clientId)
    url.searchParams.set('redirect_uri', options.redirectUri)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', 'openid profile email groups')
    url.searchParams.set('state', options.state)
    url.searchParams.set('nonce', options.nonce)
    url.searchParams.set('code_challenge', challengeOf(options.verifier))
    url.searchParams.set('code_challenge_method', 'S256')
    return url.toString()
  }

  /** Exchanges the code of a login for the tokens of the caller. */
  async exchange(options: {
    code: string
    redirectUri: string
    verifier: string
  }): Promise<Tokens> {
    const credential = Buffer.from(
      `${encodeURIComponent(this.#options.clientId)}:${encodeURIComponent(this.#options.clientSecret)}`
    ).toString('base64')
    const response = await call(
      'access service',
      this.#fetch,
      `${this.#options.accessUrl}/oauth/token`,
      {
        method: 'POST',
        headers: {
          authorization: `Basic ${credential}`,
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: options.code,
          redirect_uri: options.redirectUri,
          code_verifier: options.verifier,
        }).toString(),
      },
      this.#options.timeoutMs
    )
    const body = (await bodyOf(response)) as Record<string, unknown> | null
    if (!response.ok) {
      const code = typeof body?.error === 'string' ? body.error : 'token_refused'
      const description =
        typeof body?.error_description === 'string'
          ? body.error_description
          : `the access service refused the code with the status ${response.status}`
      throw new LoginError(code, description)
    }
    if (typeof body?.access_token !== 'string' || typeof body.id_token !== 'string') {
      throw new LoginError('token_refused', 'the access service answered no token')
    }
    const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : 300
    return {
      accessToken: body.access_token,
      idToken: body.id_token,
      expiresAt: Date.now() + expiresIn * 1000,
    }
  }

  /** Verifies the id token of a login against the keys of the access service. */
  async verify(idToken: string, nonce: string): Promise<Identity> {
    const discovery = await this.discovery()
    let payload: JWTPayload
    try {
      const verified = await jwtVerify(idToken, this.#keys, {
        issuer: discovery.issuer,
        audience: this.#options.clientId,
        clockTolerance: 5,
      })
      payload = verified.payload
    } catch (error) {
      throw new LoginError(
        'identity_rejected',
        `the id token does not hold: ${(error as Error).message}`
      )
    }
    if (payload.nonce !== nonce) {
      throw new LoginError('identity_rejected', 'the id token was not issued for this login')
    }
    if (typeof payload.sub !== 'string' || typeof payload.tid !== 'string') {
      throw new LoginError('identity_rejected', 'the id token names no principal and no tenant')
    }
    return {
      subject: payload.sub,
      tenant: payload.tid,
      email: typeof payload.email === 'string' ? payload.email : null,
      name: typeof payload.name === 'string' ? payload.name : null,
      roles: Array.isArray(payload.roles)
        ? payload.roles.filter((role): role is string => typeof role === 'string')
        : [],
    }
  }
}
