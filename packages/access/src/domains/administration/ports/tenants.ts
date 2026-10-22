/**
 * The port of the tenants.
 *
 * The domain owns the rules of the twelve endpoints; the storage is a port
 * that the composition root fulfils. The domain knows nothing about
 * PostgreSQL and nothing about the shape of the rows.
 */

import type { ChangeAudit } from './audit'

/** A tenant of the platform, as the administration knows it. */
export interface Tenant {
  id: string
  slug: string
  displayName: string
  /** The issuer of the provider of the tenant. */
  issuer: string
  emailDomain: string | null
  /** The client id of the gateway of the tenant at access. */
  clientId: string
  /**
   * The urls the gateway of the tenant is registered with.
   *
   * The browser is sent back to one of them with the code of the login.
   */
  clientRedirectUris: string[]
  autoProvision: boolean
  sharedClient: boolean
  isDefault: boolean
  enabled: boolean
  createdAt: Date
}

/** A tenant with the numbers of its principals and of its grants. */
export interface TenantSummary extends Tenant {
  userCount: number
  grantCount: number
}

/** The registration of a tenant, in clear. */
export interface TenantRegistration {
  slug: string
  displayName: string
  issuer: string
  idpClientId: string
  /** The client secret of the access service at the provider, in clear. */
  idpClientSecret: string
  idpRedirectUri: string
  idpScopes: string[]
  idpAlgorithms: string[]
  emailDomain: string | null
  clientId: string
  /**
   * The urls the gateway of the tenant is registered with.
   *
   * The browser is sent back to one of them with the code of the login.
   */
  clientRedirectUris: string[]
  /** The secret of the gateway of the tenant, in clear. */
  clientSecret: string
  autoProvision: boolean
  sharedClient: boolean
  isDefault: boolean
  enabled: boolean
}

/** The storage of the tenants. */
export interface TenantStore {
  /** The tenant of a slug: the slug is the key of the row. */
  findBySlug(slug: string): Promise<Tenant | null>
  /** The tenant of a client id of a gateway. */
  findByClientId(clientId: string): Promise<Tenant | null>
  /** The tenants of the platform, with their numbers. */
  list(): Promise<TenantSummary[]>
  /**
   * Creates a tenant.
   *
   * The row of the audit of the change is written by the same statement
   * as the tenant: a tenant that is not audited does not exist.
   */
  create(registration: TenantRegistration, audit: ChangeAudit): Promise<Tenant>
  /** Changes a tenant, and writes the row of its audit with it. */
  update(
    id: string,
    registration: Partial<TenantRegistration>,
    audit: ChangeAudit
  ): Promise<Tenant | null>
}
