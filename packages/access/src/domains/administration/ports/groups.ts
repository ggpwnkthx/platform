/**
 * The port of the groups.
 *
 * The domain owns the rules of the twelve endpoints; the storage is a port
 * that the composition root fulfils. The domain knows nothing about
 * PostgreSQL and nothing about the shape of the rows.
 */

import type { ChangeAudit } from './audit'
import type { Scope } from './scope'

/** The filter of the list of the groups. */
export interface GroupFilter {
  /** The id of the tenant, or null for every tenant. */
  tenantId: string | null
  /** The key of the group, or null for every key. */
  key: string | null
  /** The size of the page. */
  limit: number
  /** The number of rows that are skipped. */
  offset: number
}

/** A page of groups and the number of the groups that match. */
export interface GroupPage {
  groups: Group[]
  /** The number of groups that match the filter, the page included. */
  total: number
  /** The size of the page that was asked for. */
  limit: number
  /** The number of rows that were skipped. */
  offset: number
}

/** A group of principals (spec §3.5). */
export interface Group {
  id: string
  /** The slug of the tenant of the group. */
  tenant: string
  /** The name of the group. */
  key: string
  displayName: string | null
  /** The external subjects of the principals of the group. */
  members: string[]
  createdAt: Date
}

/** The registration of a group. */
export interface GroupRegistration {
  /** The slug of the tenant of the group. */
  tenant: string
  /** The name of the group. */
  key: string
  displayName?: string | null
  /** The external subjects of the principals of the group. */
  members: string[]
}

/** The storage of the groups. */
export interface GroupStore {
  /** The group of a key, in the scope of a tenant. */
  findByKey(tenantId: string, key: string): Promise<Group | null>
  /** The groups that match a filter, and their number. */
  list(filter: GroupFilter): Promise<GroupPage>
  /**
   * Creates a group.
   *
   * The row of the audit of the change is written by the same statement
   * as the group: a group that is not audited does not exist.
   */
  create(
    registration: {
      tenantId: string
      key: string
      displayName?: string | null
      /** The ids of the principals of the group. */
      memberIds: string[]
    },
    audit: ChangeAudit
  ): Promise<Group>
  /** Changes a group, and writes the row of its audit with it. */
  update(
    id: string,
    changes: { displayName?: string | null; memberIds?: string[] },
    scope: Scope,
    audit: ChangeAudit
  ): Promise<Group | null>
}
