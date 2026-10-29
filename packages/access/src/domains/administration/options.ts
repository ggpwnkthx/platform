/**
 * The options of the administration.
 *
 * The service owns the rules; the storage is a port that the composition
 * root fulfils. The options are the ports it is given, and the values of
 * the deployment that the rules need.
 */

import type { AdminCredential } from './credentials'
import type { FailedAuthenticationLimiter } from './limiter'
import type {
  AuditStore,
  GrantStore,
  GroupStore,
  PermissionStore,
  PrincipalStore,
  RoleStore,
  TenantStore,
} from './ports'

export interface AdministrationOptions {
  /** The storage of the tenants. */
  tenants: TenantStore
  /** The storage of the principals. */
  principals: PrincipalStore
  /** The storage of the groups. */
  groups?: GroupStore
  /** The storage of the roles. */
  roles?: RoleStore
  /** The storage of the permissions. */
  permissions: PermissionStore
  /** The storage of the grants. */
  grants: GrantStore
  /** The bearer token of the administration. */
  token?: string
  /**
   * The credentials of the tenants (spec §10.1).
   *
   * A credential of a tenant may only act for that tenant, and it may
   * carry the name of its operator: the audit of a change names the
   * operator and not the secret it used.
   */
  credentials?: AdminCredential[]
  /**
   * The token that the current one replaced.
   *
   * It is accepted until the deployment removes it: a rotation of the
   * token of the administration is then a rolling change and not a
   * simultaneous one (spec §4.3).
   */
  previousToken?: string
  /** The public url of Access, for the default callback of a tenant. */
  publicUrl: string
  /**
   * The limiter of the failed authentications.
   *
   * It is required: the composition root holds the count of the failures
   * (the shared store of the deployment, or the memory of the process of
   * a single node), and the domain never chooses where the count lives.
   */
  limiter: FailedAuthenticationLimiter
  /** The storage of the audit of the administration. */
  audit?: AuditStore
}
