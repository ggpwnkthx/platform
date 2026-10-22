/**
 * The grants of the administration (spec §10.2, §10.6).
 *
 * A grant names one subject — a principal or a group — one permission,
 * and the scope of the access it gives: a workspace and a route.
 */

import type { AdminScope } from './credentials'
import { AdministrationError } from './errors'
import type { AdministrationOptions } from './options'
import type {
  AuditContext,
  Grant,
  GrantFilter,
  GrantPage,
  GrantRegistration,
  Permission,
  Role,
} from './ports'
import { change, type AuditEntry } from './audit'
import { refuseOutsideScope, tenantOf } from './scope'
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, liveOf, wholeNumber } from './values'

/**
 * The outcome of one grant of a batch.
 *
 * The rules are the ones of the outcome of a principal.
 */
export interface GrantOutcome {
  /** The tenant of the grant. */
  tenant: string
  /** The id of the grant, or null when the item failed. */
  id: string | null
  /** True when the grant was created, false when it was updated. */
  created: boolean
  /** The code of the refusal, when the item failed. */
  error?: string
  /** The message of the refusal, when the item failed. */
  message?: string
}

/**
 * The query of the list of the grants.
 *
 * The values are the ones of the query of the call: they are read, and
 * a value that is not understood is a refusal.
 */
export interface GrantQuery {
  /** The tenant of the list, or null for every tenant. */
  tenant?: string | null
  /** The principal of the list, or null for every principal. */
  userId?: string | null
  /** True for the live grants, false for the others, null for every one. */
  live?: string | null
  /** The size of the page, as the query names it. */
  limit?: string | null
  /** The number of rows that are skipped, as the query names it. */
  offset?: string | null
}

/**
 * The grants that match a filter, and their number.
 *
 * A tenant that does not exist is a `404 not_found`, and a principal
 * that does not exist is an empty list: the id of a principal of
 * another tenant is not a way to read the grants of this one.
 */
export async function listGrants(
  options: AdministrationOptions,
  scope: AdminScope,
  query: GrantQuery
): Promise<GrantPage> {
  const limit = wholeNumber(query.limit ?? undefined, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE, 'limit')
  const offset = wholeNumber(query.offset ?? undefined, 0, 0, Number.MAX_SAFE_INTEGER, 'offset')
  const live = liveOf(query.live ?? undefined)

  const tenant = await tenantOf(options, scope, query.tenant)

  const userId = query.userId?.trim() || null
  const filter: GrantFilter = {
    tenantId: tenant ? tenant.id : null,
    userId,
    live,
    limit,
    offset,
  }
  const page = await options.grants.list(filter)
  return { grants: page.grants, total: page.total, limit, offset }
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
export async function upsertGrant(
  options: AdministrationOptions,
  scope: AdminScope,
  registration: GrantRegistration,
  context: AuditContext
): Promise<{ grant: Grant; audit: AuditEntry }> {
  refuseOutsideScope(scope, registration.tenant)
  const tenant = await options.tenants.findBySlug(registration.tenant)
  if (!tenant) {
    throw new AdministrationError('not_found', 'the tenant does not exist')
  }

  // A grant names exactly one subject: a principal or a group.
  const userId = registration.userId ?? null
  const groupKey = registration.group ?? null
  if ((userId === null) === (groupKey === null)) {
    throw new AdministrationError(
      'invalid_request',
      'the grant names a principal or a group, and not both'
    )
  }

  // A grant names exactly one kind: a permission or a role. A grant of a
  // role holds the permissions of the role, and the decision expands it.
  const permissionKey = registration.permission ?? null
  const roleKey = registration.role ?? null
  if ((permissionKey === null) === (roleKey === null)) {
    throw new AdministrationError(
      'invalid_request',
      'the grant names a permission or a role, and not both'
    )
  }

  let subjectId: string
  if (userId !== null) {
    const principal = await options.principals.findById(userId)
    if (!principal) {
      throw new AdministrationError('not_found', 'the principal does not exist')
    }
    if (principal.tenant !== tenant.slug) {
      throw new AdministrationError('forbidden', 'the principal belongs to another tenant')
    }
    subjectId = principal.id
  } else {
    const groups = options.groups
    if (!groups) {
      throw new AdministrationError('forbidden', 'the groups are not enabled in this deployment')
    }
    const group = await groups.findByKey(tenant.id, groupKey!)
    if (!group) {
      throw new AdministrationError('not_found', 'the group does not exist')
    }
    subjectId = group.id
  }

  const permission = permissionKey
    ? await resolvePermission(options, tenant.id, permissionKey)
    : null
  const role = roleKey ? await resolveRole(options, tenant.id, roleKey) : null

  const workspaceId = registration.workspaceId ?? null
  const routeId = registration.routeId ?? null
  const existing = await options.grants.findLive(
    tenant.id,
    { userId: userId, groupId: userId === null ? subjectId : null },
    permission ? permission.id : null,
    role ? role.id : null,
    workspaceId,
    routeId
  )
  if (!existing) {
    const grant = await options.grants.create(
      {
        tenantId: tenant.id,
        userId: userId,
        groupId: userId === null ? subjectId : null,
        permissionId: permission ? permission.id : null,
        roleId: role ? role.id : null,
        workspaceId,
        routeId,
        expiresAt: registration.expiresAt ?? null,
        grantedBy: registration.grantedBy ?? null,
      },
      change('grant.created', tenant.slug, context)
    )
    return {
      grant,
      audit: { action: 'grant.created', id: grant.id, tenant: tenant.slug },
    }
  }

  const grant = await options.grants.update(
    existing.id,
    {
      expiresAt: registration.expiresAt,
      grantedBy: registration.grantedBy,
    },
    change('grant.updated', tenant.slug, context)
  )
  if (!grant) {
    throw new AdministrationError('not_found', 'the grant does not exist')
  }
  return {
    grant,
    audit: { action: 'grant.updated', id: grant.id, tenant: tenant.slug },
  }
}

/**
 * Writes a batch of grants.
 *
 * The rules are the ones of the batch of the principals: every grant is
 * written on its own, and the answer names the outcome of every one of
 * them.
 */
export async function upsertGrants(
  options: AdministrationOptions,
  scope: AdminScope,
  registrations: GrantRegistration[],
  context: AuditContext
): Promise<GrantOutcome[]> {
  const outcomes: GrantOutcome[] = []
  for (const registration of registrations) {
    try {
      const result = await upsertGrant(options, scope, registration, context)
      outcomes.push({
        tenant: result.grant.tenant,
        id: result.grant.id,
        created: result.audit.action === 'grant.created',
      })
    } catch (error) {
      if (error instanceof AdministrationError) {
        outcomes.push({
          tenant: registration.tenant,
          id: null,
          created: false,
          error: error.code,
          message: error.message,
        })
        continue
      }
      throw error
    }
  }
  return outcomes
}

/**
 * Revokes a grant.
 *
 * The call is idempotent: a grant that is already revoked answers the
 * same way. A grant that does not exist is a `404`.
 */
export async function revokeGrant(
  options: AdministrationOptions,
  scope: AdminScope,
  id: string,
  context: AuditContext
): Promise<AuditEntry> {
  const existing = await options.grants.findById(id)
  if (!existing) {
    throw new AdministrationError('not_found', 'the grant does not exist')
  }
  // A credential of a tenant revokes the grants of that tenant and
  // nothing else.
  refuseOutsideScope(scope, existing.tenant)
  await options.grants.revoke(id, change('grant.revoked', existing.tenant, context))
  return { action: 'grant.revoked', id, tenant: existing.tenant }
}

/**
 * The permission of a grant.
 *
 * A key is a name **inside** a tenant: the catalogue of the platform
 * is shared and is reused, the permission of the tenant is reused, and
 * the permission that does not exist is created in the scope of the
 * tenant. Two tenants may hold a permission of the same key: the
 * unique index is on `(tenant, key)`, and a key that another tenant
 * owns never becomes a permission of this one — the tenant creates
 * its own row, and the grant names that row.
 */
async function resolvePermission(
  options: AdministrationOptions,
  tenantId: string,
  key: string
): Promise<Permission> {
  const catalogue = await options.permissions.findCataloguePermission(key)
  if (catalogue) return catalogue

  const own = await options.permissions.findByTenantAndKey(tenantId, key)
  if (own) return own

  return await options.permissions.createOrFind({ tenantId, key })
}

/**
 * The role of a grant.
 *
 * A role belongs to a tenant: the key of a role of another tenant never
 * becomes a role of this one, and the role that does not exist is a
 * `404` and not a role that is created.
 */
async function resolveRole(
  options: AdministrationOptions,
  tenantId: string,
  key: string
): Promise<Role> {
  const roles = options.roles
  if (!roles) {
    throw new AdministrationError('forbidden', 'the roles are not enabled in this deployment')
  }
  const role = await roles.findByKey(tenantId, key)
  if (!role) {
    throw new AdministrationError('not_found', `the role "${key}" does not exist`)
  }
  return role
}
