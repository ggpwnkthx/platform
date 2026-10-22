/**
 * The port of the roles.
 *
 * The domain owns the rules of the roles; the storage is a port that the
 * composition root fulfils. The domain knows nothing about PostgreSQL
 * and nothing about the shape of the rows.
 *
 * The memberships of a role are named by their **keys**: the operator
 * names a role by its key, and the storage resolves the key in the
 * tenant. The domain never holds an identifier of a role, except the
 * one it reads and writes.
 */

import type { ChangeAudit } from './audit'

/** A role of the policy. */
export interface Role {
  id: string
  /** The slug of the tenant of the role. */
  tenant: string
  /** The name of the role. */
  key: string
  displayName: string | null
  description: string | null
  /** The keys of the permissions the role names. */
  permissionKeys: string[]
  /** The keys of the roles the role names. */
  roleKeys: string[]
  createdAt: Date
}

/** The registration of a role. */
export interface RoleRegistration {
  /** The slug of the tenant of the role. */
  tenant: string
  /** The name of the role. */
  key: string
  displayName?: string | null
  description?: string | null
  /** The keys of the permissions the role names. */
  permissionKeys?: readonly string[]
  /** The keys of the roles the role names. */
  roleKeys?: readonly string[]
}

/** The filter of the list of the roles. */
export interface RoleFilter {
  /** The id of the tenant, or null for every tenant. */
  tenantId: string | null
  /** The key of the role, or null for every key. */
  key: string | null
  /** The size of the page. */
  limit: number
  /** The number of rows that are skipped. */
  offset: number
}

/** A page of roles and the number of the roles that match. */
export interface RolePage {
  roles: Role[]
  /** The number of roles that match the filter, the page included. */
  total: number
  /** The size of the page that was asked for. */
  limit: number
  /** The number of rows that were skipped. */
  offset: number
}

/** The storage of the roles. */
export interface RoleStore {
  /** The role of a key, in the scope of a tenant. */
  findByKey(tenantId: string, key: string): Promise<Role | null>
  /** The role of an id. */
  findById(id: string): Promise<Role | null>
  /** The roles that match a filter, and their number. */
  list(filter: RoleFilter): Promise<RolePage>
  /**
   * Creates a role.
   *
   * The row of the audit of the change is written by the same statement
   * as the role: a role that is not audited does not exist.
   */
  create(
    registration: {
      tenantId: string
      key: string
      displayName?: string | null
      description?: string | null
    },
    audit: ChangeAudit
  ): Promise<Role>
  /** Changes a role, and writes the row of its audit with it. */
  update(
    id: string,
    changes: { displayName?: string | null; description?: string | null },
    audit: ChangeAudit
  ): Promise<Role | null>
  /** Removes a role, and writes the row of its audit with it. */
  remove(id: string, audit: ChangeAudit): Promise<boolean>
  /**
   * Gives a permission to a role.
   *
   * The permission is named by its identifier: the domain resolves the
   * key of the permission in the tenant, and creates it when it does not
   * exist.
   */
  grantPermission(roleId: string, permissionId: string, audit: ChangeAudit): Promise<boolean>
  /** Takes a permission away from a role. */
  revokePermission(roleId: string, permissionId: string, audit: ChangeAudit): Promise<boolean>
  /** Makes a role name another role. */
  nest(roleId: string, childRoleId: string, audit: ChangeAudit): Promise<boolean>
  /** Makes a role name another role no more. */
  unnest(roleId: string, childRoleId: string, audit: ChangeAudit): Promise<boolean>
  /**
   * The keys of the roles the role names, the nested ones included.
   *
   * The domain refuses a nesting that would close a cycle: a role that
   * names itself holds itself forever, and the decision would never
   * answer.
   */
  descendants(roleId: string): Promise<string[]>
  /**
   * The keys of the permissions the role holds, the nested ones included.
   */
  expand(roleId: string): Promise<string[]>
  /** The number of the grants that name the role. */
  countGrants(roleId: string): Promise<number>
}
