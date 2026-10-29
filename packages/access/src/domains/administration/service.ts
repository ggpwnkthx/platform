/**
 * The administration of Access (spec §10).
 *
 * Five endpoints, and they are the whole surface of the administration:
 * a tenant, a principal and a grant are created and revoked with them and
 * with nothing else. The service owns the rules; the storage is a port
 * that the composition root fulfils.
 *
 * The rules live in one file per resource: the tenants, the principals,
 * the groups, the grants and the audit. This class is the face of the
 * administration: it holds the options of the deployment and it calls
 * the rules.
 */

import type { AdminScope } from './credentials'
import type { AdministrationOptions } from './options'
import type {
  AuditContext,
  AuditPage,
  Grant,
  GrantPage,
  GrantRegistration,
  Group,
  GroupPage,
  GroupRegistration,
  Principal,
  PrincipalPage,
  PrincipalRegistration,
  Role,
  RolePage,
  RoleRegistration,
  Tenant,
  TenantRegistration,
  TenantSummary,
} from './ports'
import { listAudit, type AuditEntry, type AuditQuery } from './audit'
import { authenticate } from './authentication'
import {
  listGrants,
  revokeGrant,
  upsertGrant,
  upsertGrants,
  type GrantOutcome,
  type GrantQuery,
} from './grants'
import { listGroups, upsertGroup, type GroupQuery } from './groups'
import { listRoles, removeRole, upsertRole, type RoleQuery } from './roles'
import {
  listPrincipals,
  upsertPrincipal,
  upsertPrincipals,
  type PrincipalOutcome,
  type PrincipalQuery,
} from './principals'
import { listTenants, upsertTenant } from './tenants'

export type { AdministrationOptions } from './options'
export type { AuditEntry } from './audit'

/** The administration of Access. */
export class AdministrationService {
  constructor(private readonly options: AdministrationOptions) {}

  /**
   * Authenticates a call of the administration.
   *
   * The token is compared in constant time. A failure is counted: a burst
   * of them is refused with `429`, so the token cannot be guessed by
   * hammering the endpoint.
   *
   * The budget of an address is spent by the calls that **fail**. A call
   * that authenticates itself is answered, whatever the address presented
   * before: an address that used up its budget cannot lock out the
   * operator that holds the token.
   *
   * Two tokens are accepted during a rotation: the one of the deployment
   * and the one it replaced.
   *
   * The call answers the **scope** of the credential it presented: the
   * tenant it may act for and the operator it is. The token of the
   * platform is the scope of the platform (spec §10.1).
   */
  async authenticate(header: string | undefined, address: string): Promise<AdminScope> {
    return await authenticate(this.options, header, address)
  }

  /**
   * Creates a tenant, or updates the tenant of that slug.
   *
   * The slug is the key of the row: the call is an upsert. A client id
   * belongs to one tenant and a default belongs to one tenant: both are
   * a conflict.
   *
   * The context carries the facts of the call that the domain cannot
   * know: the operator, the address and the request. The row of the audit
   * is written by the statement that writes the tenant (spec §10.1).
   */
  async upsertTenant(
    scope: AdminScope,
    registration: TenantRegistration,
    context: AuditContext
  ): Promise<{ tenant: Tenant; created: boolean; audit: AuditEntry }> {
    return await upsertTenant(this.options, scope, registration, context)
  }

  /** The tenants of the platform, with their numbers. */
  async listTenants(scope: AdminScope): Promise<TenantSummary[]> {
    return await listTenants(this.options, scope)
  }

  /**
   * The principals that match a filter, and their number.
   *
   * The page is read from the table of the principals: the filter of the
   * tenant is optional, and a tenant that does not exist is a
   * `404 not_found`.
   */
  async listPrincipals(scope: AdminScope, query: PrincipalQuery): Promise<PrincipalPage> {
    return await listPrincipals(this.options, scope, query)
  }

  /**
   * The groups that match a filter, and their number.
   *
   * A tenant that does not exist is a `404 not_found`, like everywhere
   * else. The groups are paginated like the other lists (spec §10.1).
   */
  async listGroups(scope: AdminScope, query: GroupQuery): Promise<GroupPage> {
    return await listGroups(this.options, scope, query)
  }

  /**
   * The grants that match a filter, and their number.
   *
   * A tenant that does not exist is a `404 not_found`, and a principal
   * that does not exist is an empty list: the id of a principal of
   * another tenant is not a way to read the grants of this one.
   */
  async listGrants(scope: AdminScope, query: GrantQuery): Promise<GrantPage> {
    return await listGrants(this.options, scope, query)
  }

  /**
   * The roles that match a filter, and their number.
   *
   * A tenant that does not exist is a `404 not_found`, like everywhere
   * else. The roles are paginated like the other lists (spec §10.1).
   */
  async listRoles(scope: AdminScope, query: RoleQuery): Promise<RolePage> {
    return await listRoles(this.options, scope, query)
  }

  /**
   * Creates a role, or updates the role of that key.
   *
   * The permissions and the roles the role names are **replaced**: the
   * lists are the memberships of the role, and the ones that are not in
   * the lists are not held by the role any more.
   *
   * A role that names itself, directly or through other roles, is
   * refused: it would hold itself forever.
   *
   * The row of the audit is written by the statement that writes the
   * role and the statements that write its memberships (spec §10.1).
   */
  async upsertRole(
    scope: AdminScope,
    registration: RoleRegistration,
    context: AuditContext
  ): Promise<{ role: Role; created: boolean; audit: AuditEntry }> {
    return await upsertRole(this.options, scope, registration, context)
  }

  /**
   * Removes a role.
   *
   * A role that a grant names is not removed: the operator revokes the
   * grants first.
   */
  async removeRole(scope: AdminScope, id: string, context: AuditContext): Promise<AuditEntry> {
    return await removeRole(this.options, scope, id, context)
  }

  /**
   * Creates a principal, or updates the principal of that
   * `(tenant, externalSubject)` pair.
   *
   * The row of the audit is written by the statement that writes the
   * principal (spec §10.1).
   */
  async upsertPrincipal(
    scope: AdminScope,
    registration: PrincipalRegistration,
    context: AuditContext
  ): Promise<{ principal: Principal; created: boolean; audit: AuditEntry }> {
    return await upsertPrincipal(this.options, scope, registration, context)
  }

  /**
   * Writes a batch of principals.
   *
   * A batch is the call that onboards a tenant: one call writes a
   * hundred principals instead of a hundred calls.
   *
   * **Every item is written on its own.** The change of an item and the
   * row of its audit are one statement, so an item that is written is
   * audited, and an item that fails leaves nothing behind. The answer
   * names the outcome of every item: an item that failed does not stop
   * the others, because an operator that onboards a tenant wants to know
   * *which* identities were refused.
   *
   * The call is **idempotent**: the same batch again writes the same
   * principals, and the ones that exist are updated instead of created.
   */
  async upsertPrincipals(
    scope: AdminScope,
    registrations: PrincipalRegistration[],
    context: AuditContext
  ): Promise<PrincipalOutcome[]> {
    return await upsertPrincipals(this.options, scope, registrations, context)
  }

  /**
   * Writes a batch of grants.
   *
   * The rules are the ones of the batch of the principals: every grant is
   * written on its own, and the answer names the outcome of every one of
   * them.
   */
  async upsertGrants(
    scope: AdminScope,
    registrations: GrantRegistration[],
    context: AuditContext
  ): Promise<GrantOutcome[]> {
    return await upsertGrants(this.options, scope, registrations, context)
  }

  /**
   * Creates a group, or updates the group of that key.
   *
   * The membership is **replaced**: the principals of the list are the
   * members of the group, and the principals that are not in the list are
   * not in the group any more. The members are the external identities of
   * the principals: a member that is not a principal of the tenant is a
   * `404 not_found`.
   *
   * The row of the audit is written by the statement that writes the
   * group (spec §10.1).
   */
  async upsertGroup(
    scope: AdminScope,
    registration: GroupRegistration,
    context: AuditContext
  ): Promise<{ group: Group; created: boolean; audit: AuditEntry }> {
    return await upsertGroup(this.options, scope, registration, context)
  }

  /**
   * Creates a grant, or updates the grant of that
   * `(tenant, subject, permission, workspace, route)` tuple.
   *
   * The permission is created on demand in the scope of the tenant. A
   * permission of the catalogue of the platform is reused, and a
   * permission of another tenant is refused.
   *
   * The row of the audit is written by the statement that writes the
   * grant (spec §10.1).
   */
  async upsertGrant(
    scope: AdminScope,
    registration: GrantRegistration,
    context: AuditContext
  ): Promise<{ grant: Grant; audit: AuditEntry }> {
    return await upsertGrant(this.options, scope, registration, context)
  }

  /**
   * Revokes a grant.
   *
   * The call is idempotent: a grant that is already revoked answers the
   * same way. A grant that does not exist is a `404`.
   */
  async revokeGrant(scope: AdminScope, id: string, context: AuditContext): Promise<AuditEntry> {
    return await revokeGrant(this.options, scope, id, context)
  }

  /**
   * The rows of the audit that match a filter, and their number.
   *
   * The filter is the tenant, the action and the page. A tenant that
   * does not exist is a `404 not_found`, like everywhere else.
   */
  async listAudit(scope: AdminScope, query: AuditQuery): Promise<AuditPage> {
    return await listAudit(this.options, scope, query)
  }
}
