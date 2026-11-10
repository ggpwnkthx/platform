/**
 * The refresh tokens of Access (spec §7.6).
 *
 * A refresh token is the credential a client uses to ask for new tokens
 * without a new login. It is an opaque random string of 32 bytes, stored
 * under a hash of itself, so the store never holds a token that a reader
 * of the store could redeem. It is single use: the first exchange deletes
 * it and issues another one, so a token that was stolen is worth one
 * exchange.
 *
 * The gateway does not use one: it holds no session of the caller. The
 * console does: it keeps the token of the caller on the server and
 * renews it before it expires, so the caller signs in once and reads
 * the data for as long as the session lasts.
 */

import { createHash, randomBytes } from 'node:crypto'
import type { TokenPair } from './tokens'

/** The life of a refresh token, in seconds: twelve hours. */
export const REFRESH_TTL_SECONDS = 43_200

/**
 * The scope a login asks for when it wants a refresh token.
 *
 * The scope is the ordinary way of asking: a client that does not name
 * it gets no refresh token, and the gateway, which names no scope, is
 * not given one.
 */
export const REFRESH_SCOPE = 'offline_access'

/** The record of a refresh token. */
export interface RefreshRecord {
  /** The client id the token was issued to. */
  clientId: string
  /** The id of the principal. */
  subject: string
  /** The slug of the tenant of the principal. */
  tenant: string
  /** The client id, which is the audience of the tokens. */
  audience: string
  /** The scopes of the login. */
  scopes: string[]
  /** The moment the token was created, in milliseconds. */
  createdAt: number
}

/** The store of the refresh tokens. */
export interface RefreshTokenStore {
  /** Stores a token under its hash. */
  put: (hash: string, record: RefreshRecord, ttlSeconds: number) => Promise<void>
  /** Reads a token and deletes it: a token is single use. */
  take: (hash: string) => Promise<RefreshRecord | null>
}

/** A fresh refresh token of 32 bytes. */
function aRefreshToken(): string {
  return randomBytes(32).toString('base64url')
}

/** The hash of a refresh token: the key of the token in the store. */
function hashOfRefresh(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('base64url')
}

/** The failure of an exchange of a refresh token. */
export class RefreshError extends Error {
  constructor(
    /** The code of the failure, as the protocol of the tokens names it. */
    readonly code: 'invalid_request' | 'invalid_grant',
    message: string
  ) {
    super(message)
    this.name = 'RefreshError'
  }
}

/** The principal of a login, as the refresh of a token knows it. */
interface PrincipalOfRefresh {
  id: string
  email: string | null
  displayName: string | null
  /** The slug of the tenant of the principal. */
  tenantSlug: string
  /** The status of the principal. */
  status: 'active' | 'disabled'
}

/** The storage of the principals. */
export interface PrincipalLookup {
  /** The principal of an id. */
  findById: (id: string) => Promise<PrincipalOfRefresh | null>
}

/** The issuer of the tokens. */
export interface RefreshTokenIssuer {
  /** Issues the tokens of a principal. */
  issueTokens: (subject: {
    subject: string
    tenant: string
    audience: string
    email?: string | null
    displayName?: string | null
    nonce?: string | null
    scopes: string[]
  }) => Promise<TokenPair>
}

/**
 * The service of the refresh tokens.
 *
 * It issues the refresh token of a login that asked for one, and it
 * exchanges it for new tokens. The exchange rotates the token: the one
 * that was presented is deleted and another one is issued.
 */
export class RefreshService {
  constructor(
    private readonly options: {
      /** The store of the refresh tokens. */
      store: RefreshTokenStore
      /** The storage of the principals. */
      principals: PrincipalLookup
      /** The issuer of the tokens. */
      tokens: RefreshTokenIssuer
    }
  ) {}

  /**
   * Issues the refresh token of a login.
   *
   * A login that does not ask for the scope of the refresh tokens gets
   * none: the client that holds no refresh token is a client that never
   * renews.
   */
  async issue(options: {
    clientId: string
    subject: string
    tenant: string
    audience: string
    scopes: string[]
  }): Promise<string | null> {
    if (!options.scopes.includes(REFRESH_SCOPE)) return null
    const token = aRefreshToken()
    const record: RefreshRecord = {
      clientId: options.clientId,
      subject: options.subject,
      tenant: options.tenant,
      audience: options.audience,
      scopes: options.scopes,
      createdAt: Date.now(),
    }
    await this.options.store.put(hashOfRefresh(token), record, REFRESH_TTL_SECONDS)
    return token
  }

  /**
   * Exchanges a refresh token for new tokens.
   *
   * The token is taken from the store: taking it deletes it, so the
   * second exchange of the same token finds nothing. The client that
   * presents it is the client it was issued to.
   */
  async exchange(options: { refreshToken: string; clientId: string }): Promise<TokenPair> {
    const record = await this.options.store.take(hashOfRefresh(options.refreshToken))
    if (!record) {
      throw new RefreshError(
        'invalid_grant',
        'the refresh token is unknown, it is used or it has expired'
      )
    }
    if (record.clientId !== options.clientId) {
      throw new RefreshError('invalid_grant', 'the refresh token was not issued to this client')
    }

    const principal = await this.options.principals.findById(record.subject)
    if (!principal) {
      throw new RefreshError('invalid_grant', 'the principal of the refresh token does not exist')
    }
    if (principal.status === 'disabled') {
      throw new RefreshError('invalid_grant', 'the principal is disabled')
    }

    const pair = await this.options.tokens.issueTokens({
      subject: principal.id,
      tenant: principal.tenantSlug,
      audience: record.audience,
      email: principal.email,
      displayName: principal.displayName,
      scopes: record.scopes,
    })
    // The token that was presented is spent: the exchange issues another
    // one, and the client holds it alone.
    const refreshToken = await this.issue({
      clientId: record.clientId,
      subject: record.subject,
      tenant: record.tenant,
      audience: record.audience,
      scopes: record.scopes,
    })
    return refreshToken === null ? pair : { ...pair, refreshToken }
  }
}
