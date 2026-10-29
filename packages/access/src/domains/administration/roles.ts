/**
 * The roles of the administration (spec §10.7).
 *
 * A role is a named set of permissions of a tenant. A role may name
 * another role: the permissions of the named role are the permissions of
 * the naming role, and the naming is transitive.
 *
 * The memberships are **replaced**: the permissions of the list are the
 * permissions of the role, and the roles of the list are the roles it
 * names. The permissions that are not in the list are not held by the
 * role any more.
 *
 * A cycle is refused: a role that names itself, directly or through
 * other roles, holds itself forever, and the decision of a principal
 * would never answer.
 */

import type { AdminScope } from './credentials'
import { AdministrationError } from './errors'
import type { AdministrationOptions } from './options'
import type {
  AuditContext,
  Permission,
  Role,
  RoleFilter,
  RolePage,
  RoleRegistration,
} from './ports'
import { change, type AuditEntry } from './audit'
import { platformScope, tenantScope } from './ports'
import { refuseOutsideScope, statementScope, tenantOf } from './scope'
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, wholeNumber } from './values'

/**
 * The query of the list of the roles.
 *
 * The values are the ones of the query of the call: they are read, and
 * a value that is not understood is a refusal.
 */
export interface RoleQuery {
  /** The tenant of the list, or null for every tenant. */
  tenant?: string | null
  /** The key of the roles, or null for every key. */
  key?: string | null
  /** The size of the page, as the query names it. */
  limit?: string | null
  /** The number of rows that are skipped, as the query names it. */
  offset?: string | null
}

/**
 * The roles that match a filter, and their number.
 *
 * A tenant that does not exist is a `404 not_found`, like everywhere
 * else. The roles are paginated like the other lists (spec §10.1).
 */
export async function listRoles(
  options: AdministrationOptions,
  scope: AdminScope,
  query: RoleQuery
): Promise<RolePage> {
  const roles = options.roles
  if (!roles) {
    throw new AdministrationError('forbidden', 'the roles are not enabled in this deployment')
  }
  const limit = wholeNumber(query.limit ?? undefined, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE, 'limit')
  const offset = wholeNumber(query.offset ?? undefined, 0, 0, Number.MAX_SAFE_INTEGER, 'offset')

  const tenant = await tenantOf(options, scope, query.tenant)

  const filter: RoleFilter = {
    tenantId: tenant ? tenant.id : null,
    key: query.key?.trim() || null,
    limit,
    offset,
  }
  const page = await roles.list(filter)
  return { roles: page.roles, total: page.total, limit, offset }
}

/**
 * Creates a role, or updates the role of that key.
 *
 * The permissions are **replaced**: the permissions of the list are the
 * permissions of the role, and the ones that are not in the list are not
 * held by the role any more. The roles the role names are replaced the
 * same way.
 *
 * A permission is created on demand in the scope of the tenant, like the
 * permission of a grant: a key is a name **inside** a tenant, and the
 * catalogue of the platform is shared and reused.
 *
 * The row of the audit is written by the statement that writes the role
 * and the statements that write its memberships (spec §10.1).
 */
export async function upsertRole(
  options: AdministrationOptions,
  scope: AdminScope,
  registration: RoleRegistration,
  context: AuditContext
): Promise<{ role: Role; created: boolean; audit: AuditEntry }> {
  refuseOutsideScope(scope, registration.tenant)
  const tenant = await options.tenants.findBySlug(registration.tenant)
  if (!tenant) {
    throw new AdministrationError('not_found', 'the tenant does not exist')
  }
  const roles = options.roles
  if (!roles) {
    throw new AdministrationError('forbidden', 'the roles are not enabled in this deployment')
  }

  // The permissions of the role: every key names a permission of the
  // tenant, and a permission that does not exist is created.
  const permissionKeys = registration.permissionKeys ?? []
  const permissions: Permission[] = []
  for (const key of permissionKeys) {
    permissions.push(await resolvePermission(options, tenant.id, key))
  }

  // The roles the role names: every key names a role of the same
  // tenant, and a role that does not exist is a `404`.
  const roleKeys = registration.roleKeys ?? []
  const nested: Role[] = []
  for (const key of roleKeys) {
    const child = await roles.findByKey(tenant.id, key)
    if (!child) {
      throw new AdministrationError('not_found', `the role "${key}" does not exist`)
    }
    nested.push(child)
  }

  const existing = await roles.findByKey(tenant.id, registration.key)

  // A role that names a role that names it back holds itself forever:
  // the nesting is refused before anything is written.
  if (existing) {
    for (const child of nested) {
      if (child.id === existing.id) {
        throw new AdministrationError('conflict', 'a role does not name itself')
      }
      const descendants = await roles.descendants(child.id, tenantScope(tenant.id))
      if (descendants.includes(existing.key)) {
        throw new AdministrationError(
          'conflict',
          `the role "${child.key}" names the role "${existing.key}" already`
        )
      }
    }
  }

  let role: Role
  let created = false
  if (!existing) {
    role = await roles.create(
      {
        tenantId: tenant.id,
        key: registration.key,
        displayName: registration.displayName ?? null,
        description: registration.description ?? null,
      },
      change('role.created', tenant.slug, context)
    )
    created = true
  } else {
    const updated = await roles.update(
      existing.id,
      {
        displayName: registration.displayName,
        description: registration.description,
      },
      tenantScope(tenant.id),
      change('role.updated', tenant.slug, context)
    )
    if (!updated) {
      throw new AdministrationError('not_found', 'the role does not exist')
    }
    role = updated
  }

  await replacePermissions(options, role, permissions, tenant, context)
  await replaceNestedRoles(options, role, nested, tenant, context)

  // The role is read again: the answer names the role as it is, with the
  // memberships it holds and not the ones it held.
  const final = await roles.findById(role.id, tenantScope(tenant.id))

  return {
    role: final ?? role,
    created,
    audit: {
      action: created ? 'role.created' : 'role.updated',
      id: role.id,
      tenant: tenant.slug,
    },
  }
}

/**
 * Removes a role.
 *
 * A role that a grant names is not removed: the grants of the policy are
 * kept, and the operator revokes them first. The history of the policy
 * is worth more than the bytes.
 */
export async function removeRole(
  options: AdministrationOptions,
  scope: AdminScope,
  id: string,
  context: AuditContext
): Promise<AuditEntry> {
  const roles = options.roles
  if (!roles) {
    throw new AdministrationError('forbidden', 'the roles are not enabled in this deployment')
  }
  const existing = await roles.findById(id, platformScope())
  if (!existing) {
    throw new AdministrationError('not_found', 'the role does not exist')
  }
  refuseOutsideScope(scope, existing.tenant)
  const statement = await statementScope(options, scope)
  const grants = await roles.countGrants(id, statement)
  if (grants > 0) {
    throw new AdministrationError(
      'conflict',
      'the role is named by a grant: revoke the grants before removing it'
    )
  }
  await roles.remove(id, statement, change('role.removed', existing.tenant, context))
  return { action: 'role.removed', id, tenant: existing.tenant }
}

/**
 * Replaces the permissions of a role.
 *
 * The permissions that are not in the list are taken away, and the ones
 * that are in the list are given. A permission that the role already
 * holds is left alone: the grant of it is not written again.
 */
async function replacePermissions(
  options: AdministrationOptions,
  role: Role,
  permissions: Permission[],
  tenant: { id: string; slug: string },
  context: AuditContext
): Promise<void> {
  const roles = options.roles!
  const held = role.permissionKeys
  const wanted = new Set(permissions.map((permission) => permission.key))
  for (const key of held) {
    if (wanted.has(key)) continue
    const permission = await permissionOf(options, tenant.id, key)
    if (!permission) continue
    await roles.revokePermission(
      role.id,
      permission.id,
      tenantScope(tenant.id),
      change('role.permission.revoked', tenant.slug, context)
    )
  }
  for (const permission of permissions) {
    if (held.includes(permission.key)) continue
    await roles.grantPermission(
      role.id,
      permission.id,
      tenantScope(tenant.id),
      change('role.permission.granted', tenant.slug, context)
    )
  }
}

/**
 * Replaces the roles a role names.
 *
 * A role that is not in the list is not named any more, and a role that
 * is in the list and was not named is named now.
 */
async function replaceNestedRoles(
  options: AdministrationOptions,
  role: Role,
  nested: Role[],
  tenant: { id: string; slug: string },
  context: AuditContext
): Promise<void> {
  const roles = options.roles!
  const held = role.roleKeys
  const wanted = new Set(nested.map((entry) => entry.key))
  for (const key of held) {
    if (wanted.has(key)) continue
    const child = await roles.findByKey(tenant.id, key)
    if (!child) continue
    await roles.unnest(
      role.id,
      child.id,
      tenantScope(tenant.id),
      change('role.role.unnested', tenant.slug, context)
    )
  }
  for (const child of nested) {
    if (held.includes(child.key)) continue
    await roles.nest(
      role.id,
      child.id,
      tenantScope(tenant.id),
      change('role.role.nested', tenant.slug, context)
    )
  }
}

/**
 * The permission of a key, in the scope of a tenant.
 *
 * The key of a permission the role held and does not hold any more is
 * resolved in the tenant and in the catalogue: the permission is never
 * created here, and a permission that does not exist any more is not
 * taken away.
 */
async function permissionOf(
  options: AdministrationOptions,
  tenantId: string,
  key: string
): Promise<Permission | null> {
  const catalogue = await options.permissions.findCataloguePermission(key, tenantScope(tenantId))
  if (catalogue) return catalogue
  return await options.permissions.findByTenantAndKey(tenantId, key)
}

/**
 * The permission of a role.
 *
 * A key is a name **inside** a tenant: the catalogue of the platform is
 * shared and is reused, the permission of the tenant is reused, and the
 * permission that does not exist is created in the scope of the tenant.
 */
async function resolvePermission(
  options: AdministrationOptions,
  tenantId: string,
  key: string
): Promise<Permission> {
  const scope = tenantScope(tenantId)
  const catalogue = await options.permissions.findCataloguePermission(key, scope)
  if (catalogue) return catalogue

  const own = await options.permissions.findByTenantAndKey(tenantId, key)
  if (own) return own

  return await options.permissions.createOrFind({ tenantId, key }, scope)
}
