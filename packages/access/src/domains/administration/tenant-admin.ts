/**
 * The administration of a tenant, as a role.
 *
 * Every tenant holds a role that administers it: the role `admin` holds
 * the permissions an administration needs, and the first identity of the
 * tenant is given the role instead of the permission (spec §6.4).
 *
 * The role is a name and not a power of its own: the operator of the
 * tenant gives it the other rights its administrators need (§3.6), and
 * the right that opens the administration is the role's own.
 */

import type { AdministrationOptions } from './options'
import type { AuditContext, Role } from './ports'
import { change } from './audit'
import { resolvePermission } from './grants'
import { tenantScope } from './ports'

/**
 * The permission that opens the administration of a tenant.
 *
 * The key is the one of the console, and the deployment may name
 * another one: the key is what the console reads in the context of
 * its caller.
 */
export const TENANT_ADMIN_PERMISSION = 'console.admin'

/**
 * The key of the role that administers a tenant.
 *
 * The key is the name of the role inside its tenant, like every other
 * role of the platform (§3.6).
 */
export const TENANT_ADMIN_ROLE = 'admin'

/** The name shown for the role of the administration. */
const ADMIN_ROLE_NAME = 'Administrators'

/** What the role of the administration is for. */
const ADMIN_ROLE_DESCRIPTION =
  'The administration of the tenant: its users, its groups, its rights, its roles, and the model and the audit of its workspaces.'

/**
 * The key of the permission that opens the administration of a tenant.
 *
 * The deployment names it: the key of `ACCESS_TENANT_ADMIN_PERMISSION`,
 * or the one of the console (§4.6).
 */
export function tenantAdminPermission(options: AdministrationOptions): string {
  return options.tenantAdminPermission ?? TENANT_ADMIN_PERMISSION
}

/**
 * The keys of the permissions the role of the administration holds.
 *
 * The role is the administration of a tenant, and an administration
 * needs more than the right to open a page:
 *
 * - the permission that opens the administration of the tenant, which
 *   the console reads in the context of its caller (§4.6);
 * - the detail of the status of the services, which an administrator
 *   reads when a call is refused and the tenant does not know why;
 * - the capabilities that administer a workspace: its model and its
 *   audit. They are workspace-scoped, and they only reach the
 *   workspaces where the role is granted on them.
 * - the capability that creates a workspace of the tenant, which is
 *   the right of the tenant and not of a workspace: it is held by the
 *   role of the administration, and an operator of the tenant may give
 *   it to anybody else.
 *
 * The keys of the console and of Data are the ones those services read,
 * and they are fixed in their code. The capabilities of the records of a
 * workspace are the deployment's own: the policy bundle names them, and
 * the operator of the tenant gives them to the role.
 */
function tenantAdminPermissions(options: AdministrationOptions): string[] {
  return [
    tenantAdminPermission(options),
    'console.status',
    'data.model.read',
    'data.model.write',
    'data.audit.read',
    'data.workspace.create',
  ]
}

/**
 * The role that administers a tenant, created when it does not exist.
 *
 * The role holds the permissions an administration needs, and it holds
 * them again when they are taken away: the role of the administration
 * is the administration of the tenant. The role is created with the
 * tenant, and it is created again when it is missing: a tenant that
 * existed before the rule, and a tenant whose role was removed, get it
 * when it is needed.
 *
 * `null` when the deployment has no roles: a tenant of such a
 * deployment is administered by grants of the permission itself.
 *
 * @param options what the administration is built with.
 * @param tenant the tenant whose role is read or created.
 * @param context the facts of the call, for the rows of the audit.
 */
export async function ensureTenantAdminRole(
  options: AdministrationOptions,
  tenant: { id: string; slug: string },
  context: AuditContext
): Promise<Role | null> {
  const roles = options.roles
  if (!roles) return null
  const existing = await roles.findByKey(tenant.id, TENANT_ADMIN_ROLE)
  const role =
    existing ??
    (await roles.create(
      {
        tenantId: tenant.id,
        key: TENANT_ADMIN_ROLE,
        displayName: ADMIN_ROLE_NAME,
        description: ADMIN_ROLE_DESCRIPTION,
      },
      change('role.created', tenant.slug, context)
    ))

  // The role holds the permissions an administration needs, and it
  // holds them again when they are taken away: the role of the
  // administration is the administration of the tenant.
  const held = new Set(role.permissionKeys)
  for (const key of tenantAdminPermissions(options)) {
    if (held.has(key)) continue
    const permission = await resolvePermission(options, tenant.id, key)
    await roles.grantPermission(
      role.id,
      permission.id,
      tenantScope(tenant.id),
      change('role.permission.granted', tenant.slug, context)
    )
  }

  // The role is read again: the answer names the role with the
  // memberships it holds.
  return (await roles.findByKey(tenant.id, TENANT_ADMIN_ROLE)) ?? role
}
