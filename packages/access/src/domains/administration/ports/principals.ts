/**
 * The port of the principals.
 *
 * The domain owns the rules of the twenty-one endpoints; the storage is a port
 * that the composition root fulfils. The domain knows nothing about
 * PostgreSQL and nothing about the shape of the rows.
 */

import type { ChangeAudit } from './audit'
import type { Scope } from './scope'

/** The status of a principal. */
export type PrincipalStatus = 'active' | 'disabled'

/** A principal of a tenant. */
export interface Principal {
  id: string
  /** The slug of the tenant of the principal. */
  tenant: string
  /**
   * The slug of the provider the principal belongs to.
   *
   * The key of the mapping is the triple `(tenant, provider, subject)`
   * (spec §6.2), and the answer names the provider of the principal.
   */
  provider: string
  /** The `sub` of the provider of the tenant. */
  externalSubject: string
  email: string | null
  displayName: string | null
  status: PrincipalStatus
  lastLoginAt: Date | null
  createdAt: Date
}

/** The registration of a principal. */
export interface PrincipalRegistration {
  /** The slug of the tenant of the principal. */
  tenant: string
  /**
   * The slug of the provider the principal belongs to.
   *
   * A registration that names none is a registration of the default
   * provider of the tenant (spec §6.2).
   */
  provider?: string
  externalSubject: string
  email?: string | null
  displayName?: string | null
  status?: PrincipalStatus
}

/** The filter of the list of the principals. */
export interface PrincipalFilter {
  /** The id of the tenant, or null for every tenant. */
  tenantId: string | null
  /** The status of the principals, or null for every status. */
  status: PrincipalStatus | null
  /** The exact e-mail of the principals, or null for every one. */
  email: string | null
  /** The size of the page. */
  limit: number
  /** The number of rows that are skipped. */
  offset: number
}

/** A page of principals and the number of the principals that match. */
export interface PrincipalPage {
  principals: Principal[]
  /** The number of principals that match the filter, the page included. */
  total: number
  /** The size of the page that was asked for. */
  limit: number
  /** The number of rows that were skipped. */
  offset: number
}

/** The storage of the principals. */
export interface PrincipalStore {
  /**
   * The principal of an id.
   *
   * The scope is the scope of the call: the principal of another tenant
   * is not a principal the statement may read (spec §3.10).
   */
  findById(id: string, scope: Scope): Promise<Principal | null>
  /**
   * The principal of an external identity of a provider of a tenant.
   *
   * The key is the triple `(tenant, provider, subject)` (spec §6.2).
   */
  findByExternalSubject(
    tenantId: string,
    providerSlug: string,
    externalSubject: string
  ): Promise<Principal | null>
  /**
   * Creates a principal.
   *
   * The row of the audit of the change is written by the same statement
   * as the principal: a principal that is not audited does not exist.
   */
  create(
    registration: {
      tenantId: string
      /** The slug of the provider the principal belongs to. */
      providerSlug: string
      externalSubject: string
      email?: string | null
      displayName?: string | null
      status?: PrincipalStatus
    },
    audit: ChangeAudit
  ): Promise<Principal>
  /** Changes a principal, and writes the row of its audit with it. */
  update(
    id: string,
    changes: { email?: string | null; displayName?: string | null; status?: PrincipalStatus },
    scope: Scope,
    audit: ChangeAudit
  ): Promise<Principal | null>
  /** The principals that match a filter, and their number. */
  list(filter: PrincipalFilter): Promise<PrincipalPage>
  /**
   * The number of the principals that were created at a provider.
   *
   * The count is what tells a provider that holds principals from one
   * that holds none (spec §10.16).
   */
  countByProvider(tenantId: string, providerSlug: string): Promise<number>
}
