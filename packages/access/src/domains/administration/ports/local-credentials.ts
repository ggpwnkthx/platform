/**
 * The port of the credentials of the local providers.
 *
 * The domain owns the rules of the credentials; the storage is a port
 * that the composition root fulfils. The domain knows nothing about
 * PostgreSQL and nothing about the shape of the rows.
 *
 * A credential is named by the pair `(tenant, provider, email)`: the
 * address is the name of the account, and the pair is the key of the
 * row. The verifier of the password is written by the storage and it is
 * never answered.
 */

import type { ChangeAudit } from './audit'
import type { Scope } from './scope'

/** The status of a credential. */
type CredentialStatus = 'active' | 'disabled'

/** A credential of a local provider. */
export interface Credential {
  id: string
  /** The slug of the tenant of the credential. */
  tenant: string
  /** The slug of the provider of the credential. */
  provider: string
  email: string
  status: CredentialStatus
  /** The number of the failed sign-ins since the last success. */
  failedAttempts: number
  /** The moment the credential is locked until, when it is locked. */
  lockedUntil: Date | null
  /** The moment the password was written. */
  passwordChangedAt: Date
  createdAt: Date
}

/** The registration of a credential, in clear. */
export interface CredentialRegistration {
  /** The slug of the tenant of the credential. */
  tenant: string
  /** The slug of the provider of the credential. */
  provider: string
  email: string
  /** The password of the credential, in clear. */
  password: string
  status?: CredentialStatus
}

/** The filter of the list of the credentials. */
export interface CredentialFilter {
  /** The id of the tenant, or null for every tenant. */
  tenantId: string | null
  /** The slug of the provider, or null for every provider. */
  providerSlug: string | null
  /** The exact e-mail of the credentials, or null for every e-mail. */
  email: string | null
  /** The size of the page. */
  limit: number
  /** The number of rows that are skipped. */
  offset: number
}

/** A page of credentials and the number of the credentials that match. */
export interface CredentialPage {
  credentials: Credential[]
  /** The number of credentials that match the filter, the page included. */
  total: number
  /** The size of the page that was asked for. */
  limit: number
  /** The number of rows that were skipped. */
  offset: number
}

/**
 * The hasher of the passwords of the credentials.
 *
 * The domain never hashes a password itself: the storage of the secrets
 * is the platform's, and the platform knows the algorithm.
 */
export interface CredentialHasher {
  /** The argon2id hash of a password. */
  hash(clear: string): Promise<string>
}

/** The storage of the credentials of the local providers. */
export interface CredentialStore {
  /** The credential of an address, at a provider of a tenant. */
  findByEmail(tenantSlug: string, providerSlug: string, email: string): Promise<Credential | null>
  /**
   * The credential of an id.
   *
   * The scope is the scope of the call: the credential of another tenant
   * is not a credential the statement may read (spec §3.10).
   */
  findById(id: string, scope: Scope): Promise<Credential | null>
  /** The credentials that match a filter, and their number. */
  list(filter: CredentialFilter): Promise<CredentialPage>
  /**
   * Creates a credential.
   *
   * The row of the audit of the change is written by the same statement
   * as the credential: a credential that is not audited does not exist.
   */
  create(
    registration: {
      tenantId: string
      providerId: string
      email: string
      /** The password of the credential, in clear. The platform hashes it. */
      password: string
      status: CredentialStatus
    },
    audit: ChangeAudit
  ): Promise<Credential>
  /** Changes a credential, and writes the row of its audit with it. */
  update(
    id: string,
    changes: {
      email?: string
      /** The password of the credential, in clear. The platform hashes it. */
      password?: string
      status?: CredentialStatus
    },
    scope: Scope,
    audit: ChangeAudit
  ): Promise<Credential | null>
  /** Removes a credential, and writes the row of its audit with it. */
  remove(id: string, scope: Scope, audit: ChangeAudit): Promise<boolean>
}
