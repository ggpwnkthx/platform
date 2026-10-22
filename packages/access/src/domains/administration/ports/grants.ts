/**
 * The port of the grants.
 *
 * The domain owns the rules of the twelve endpoints; the storage is a port
 * that the composition root fulfils. The domain knows nothing about
 * PostgreSQL and nothing about the shape of the rows.
 */

import type { ChangeAudit } from './audit'

/** A grant of the policy. */
export interface Grant {
  id: string
  /** The slug of the tenant of the grant. */
  tenant: string
  /** The principal of the grant, or null when the grant names a group. */
  userId: string | null
  /** The key of the group of the grant, when it names one. */
  group: string | null
  /** The key of the permission of the grant, when it names one. */
  permission: string | null
  /** The key of the role of the grant, when it names one. */
  role: string | null
  workspaceId: string | null
  routeId: string | null
  expiresAt: Date | null
  revokedAt: Date | null
  /** Who granted it, for the audit log. */
  grantedBy: string | null
  createdAt: Date
}

/** The registration of a grant. */
export interface GrantRegistration {
  /** The slug of the tenant of the grant. */
  tenant: string
  /** The id of the principal of the grant, when it names one. */
  userId?: string | null
  /** The key of the group of the grant, when it names one. */
  group?: string | null
  /** The key of the permission of the grant, when it names one. */
  permission?: string | null
  /** The key of the role of the grant, when it names one. */
  role?: string | null
  workspaceId?: string | null
  routeId?: string | null
  expiresAt?: Date | null
  grantedBy?: string | null
}

/** The filter of the list of the grants. */
export interface GrantFilter {
  /** The id of the tenant, or null for every tenant. */
  tenantId: string | null
  /** The id of the principal, or null for every principal. */
  userId: string | null
  /**
   * True: the grants that are not revoked and not expired. False: the
   * others. Null: every grant.
   */
  live: boolean | null
  /** The size of the page. */
  limit: number
  /** The number of rows that are skipped. */
  offset: number
}

/** A page of grants and the number of the grants that match. */
export interface GrantPage {
  grants: Grant[]
  /** The number of grants that match the filter, the page included. */
  total: number
  /** The size of the page that was asked for. */
  limit: number
  /** The number of rows that were skipped. */
  offset: number
}

/** The storage of the grants. */
export interface GrantStore {
  /** The grant of an id. */
  findById(id: string): Promise<Grant | null>
  /**
   * The live grant of a scope.
   *
   * The grant holds a permission or a role, and not both: the two are
   * the kind of the grant.
   */
  findLive(
    tenantId: string,
    subject: { userId: string | null; groupId: string | null },
    permissionId: string | null,
    roleId: string | null,
    workspaceId: string | null,
    routeId: string | null
  ): Promise<Grant | null>
  /**
   * Creates a grant.
   *
   * The row of the audit of the change is written by the same statement
   * as the grant: a grant that is not audited does not exist.
   */
  create(
    registration: {
      tenantId: string
      userId: string | null
      groupId: string | null
      permissionId: string | null
      roleId: string | null
      workspaceId: string | null
      routeId: string | null
      expiresAt: Date | null
      grantedBy: string | null
    },
    audit: ChangeAudit
  ): Promise<Grant>
  /** Changes the expiry of a grant, and writes the row of its audit with it. */
  update(
    id: string,
    changes: { expiresAt?: Date | null; grantedBy?: string | null },
    audit: ChangeAudit
  ): Promise<Grant | null>
  /** Revokes a grant, and writes the row of its audit with it. */
  revoke(id: string, audit: ChangeAudit): Promise<Grant | null>
  /** The grants that match a filter, and their number. */
  list(filter: GrantFilter): Promise<GrantPage>
}
