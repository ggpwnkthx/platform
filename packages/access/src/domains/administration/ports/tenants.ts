/**
 * The port of the tenants.
 *
 * The domain owns the rules of the fifteen endpoints; the storage is a port
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
  /** The client id of Access at the provider of the tenant. */
  idpClientId: string
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
  /**
   * Whether the first principal of the tenant administers the tenant.
   *
   * The flag is the work of the operator of the tenant: a tenant that
   * provisions its identities may hand the administration of the tenant
   * to the first one of them (spec §6.4).
   */
  autoProvisionAdmin: boolean
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
  /**
   * The provider of the identity of the tenant.
   *
   * A field that is absent is a field that does not change: a call
   * that names no provider keeps the one the tenant has, and a tenant
   * that is created is created with the provider it is given.
   */
  issuer?: string
  /** The client id of Access at the provider. */
  idpClientId?: string
  /** The client secret of Access at the provider, in clear. */
  idpClientSecret?: string
  /** The callback of Access at the provider. */
  idpRedirectUri?: string
  /** The scopes Access asks the provider for. */
  idpScopes?: string[]
  /** The algorithms a token of the provider may be signed with. */
  idpAlgorithms?: string[]
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
  /**
   * Whether the first principal of the tenant administers the tenant.
   *
   * The flag is the work of the operator of the tenant: a tenant that
   * provisions its identities may hand the administration of the tenant
   * to the first one of them (spec §6.4).
   */
  autoProvisionAdmin: boolean
  sharedClient: boolean
  isDefault: boolean
  enabled: boolean
}

/**
 * The registration of a tenant that is created.
 *
 * A tenant is created with the provider of its identity: the issuer,
 * the client and the secret of the provider are needed, and the
 * callback of the provider and the scopes it is asked for have their
 * defaults.
 */
export interface TenantCreation extends TenantRegistration {
  issuer: string
  idpClientId: string
  idpClientSecret: string
  idpRedirectUri: string
  idpScopes: string[]
  idpAlgorithms: string[]
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
  create(registration: TenantCreation, audit: ChangeAudit): Promise<Tenant>
  /** Changes a tenant, and writes the row of its audit with it. */
  update(
    id: string,
    registration: Partial<TenantRegistration>,
    audit: ChangeAudit
  ): Promise<Tenant | null>
}
