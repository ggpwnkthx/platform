/**
 * The local provider of a tenant (spec §5.4).
 *
 * A local provider is a provider of the platform: it holds its own
 * identities, and the caller signs in with an e-mail and a password
 * instead of at another provider. Access checks the password against the
 * argon2id verifier of the credential, and the credential is the identity
 * of the caller: the `sub` of a local provider is the id of the row.
 *
 * The provider is a **driver** like any other: the login of the identity
 * domain does not know what it signs a caller in at. What the local
 * driver owns is the exchange with the caller: the page that asks for
 * the password, and the code that the page hands to the callback.
 *
 * The rules that make the guessing expensive live here: the answer of a
 * failed sign-in never says whether the address exists, the failures of
 * an address are counted, and the failures of a credential lock it.
 */

import { createHash, randomBytes } from 'node:crypto'
import { ProviderError } from './provider-client'
import type { ProviderDriver, ProviderIdentity } from './provider-driver'

/** The life of a local code, in seconds. */
export const LOCAL_CODE_TTL_SECONDS = 60

/** The credential of a local provider. */
export interface LocalCredential {
  id: string
  /** The id of the tenant of the credential. */
  tenantId: string
  /** The slug of the provider the credential belongs to. */
  providerSlug: string
  email: string
  /** The argon2id hash of the password. It is never answered. */
  passwordHash: string
  status: 'active' | 'disabled'
  /** The number of the failed sign-ins since the last success. */
  failedAttempts: number
  /** The moment the credential is locked until, when it is locked. */
  lockedUntil: Date | null
}

/** The storage of the credentials of the local providers. */
export interface CredentialLookup {
  /** The credential of an address, at a provider of a tenant. */
  findByEmail(
    tenantSlug: string,
    providerSlug: string,
    email: string
  ): Promise<LocalCredential | null>
  /**
   * Counts a failed sign-in and locks the credential when it has failed
   * too much.
   *
   * The lock grows with the number of the failures and it is capped: a
   * credential that is hammered is locked for a while, and a credential
   * that succeeds is unlocked again.
   */
  recordFailure(id: string): Promise<LocalCredential | null>
  /** Clears the failures of a credential that signed in. */
  clearFailures(id: string): Promise<void>
}

/** The hasher of the passwords. */
export interface PasswordHasher {
  /** The argon2id hash of a password. */
  hash(clear: string): Promise<string>
  /** Reports whether a password is the one of a verifier. */
  verify(hash: string, clear: string): Promise<boolean>
  /**
   * A verification against nothing.
   *
   * It costs what a real verification costs, and it returns false: it is
   * what the service does when the address names no account, so that the
   * answer of a failed sign-in says nothing about the accounts of the
   * tenant.
   */
  verifyNothing(clear: string): Promise<boolean>
}

/** The record of a local code. */
export interface LocalCodeRecord {
  /** The id of the credential that signed in. */
  credentialId: string
  /** The slug of the tenant of the login. */
  tenant: string
  /** The slug of the provider of the login. */
  provider: string
  /** The nonce of the login in flight. */
  nonce: string
  /** The address that signed in. */
  email: string
}

/** The store of the local codes. */
export interface LocalCodeStore {
  /** Stores a code under its hash. */
  put(hash: string, record: LocalCodeRecord, ttlSeconds: number): Promise<void>
  /** Reads a code and deletes it: a code is single use. */
  take(hash: string): Promise<LocalCodeRecord | null>
}

/** The hash of a code: the key of the code in the store. */
export function hashOfLocalCode(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('base64url')
}

/** A fresh local code of 32 bytes. */
export function aLocalCode(): string {
  return randomBytes(32).toString('base64url')
}

/** The driver of a local provider. */
export class LocalProvider implements ProviderDriver {
  readonly kind = 'local' as const

  constructor(
    private readonly options: {
      /** The public url of Access, for the page of the password. */
      publicUrl: string
      /** The store of the local codes. */
      codes: LocalCodeStore
    }
  ) {}

  /**
   * The page that asks for the password.
   *
   * The page is served by Access itself: the caller never leaves the
   * origin of the service, and the state of the login travels in a
   * cookie of its own.
   */
  async authorizationUrl(options: { state: string }): Promise<string> {
    const url = new URL(`${this.options.publicUrl}/oauth/local/authorize`)
    url.searchParams.set('state', options.state)
    return url.toString()
  }

  /**
   * The identity of the code of a local sign-in.
   *
   * The code is the one the page minted: it is single use, it lives a
   * minute, and it is bound to the nonce of the login in flight.
   */
  async exchange(options: { code: string; nonce: string }): Promise<ProviderIdentity> {
    const record = await this.options.codes.take(hashOfLocalCode(options.code))
    if (!record) {
      throw new ProviderError(
        'identity_rejected',
        'the code of the local provider is not one of ours'
      )
    }
    if (record.nonce !== options.nonce) {
      throw new ProviderError(
        'identity_rejected',
        'the code of the local provider is not one of ours'
      )
    }
    return { subject: record.credentialId, email: record.email }
  }
}
