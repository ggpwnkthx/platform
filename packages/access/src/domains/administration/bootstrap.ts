/**
 * The administration of a tenant, handed to its first identity
 * (spec §6.4).
 *
 * A tenant that provisions the identities that sign in may hand the
 * administration of the tenant to the first one of them: the principal
 * that is created first is given the right to administer the tenant, and
 * the ones that come after are given nothing.
 *
 * The flag of the tenant is the work of its operator, and the flag is
 * on by default: the first person who signs in at the provider of a
 * tenant is its administrator, unless the tenant says otherwise.
 *
 * The grant is written by the same statement as the row of its audit: a
 * grant that is not audited does not exist (spec §10.1).
 */

import type { AdministrationOptions } from './options'
import type { AuditContext, Grant } from './ports'
import { change } from './audit'
import { platformScope } from './ports'
import { resolvePermission } from './grants'

/**
 * The permission that opens the administration of a tenant.
 *
 * The key is the one of the console, and the deployment may name
 * another one: the key is what the console reads in the context of its
 * caller.
 */
export const TENANT_ADMIN_PERMISSION = 'console.admin'

/**
 * Hands the administration of a tenant to its first principal.
 *
 * The grant is not written when the tenant does not hand its
 * administration to its first identity, when the tenant already has an
 * administrator, when the tenant shares its provider with another
 * tenant, or when the principal is not of the tenant.
 *
 * @param options what the administration is built with.
 * @param principal the principal that signed in for the first time.
 * @param context the facts of the call.
 */
export async function bootstrapAdministrator(
  options: AdministrationOptions,
  principal: { id: string; tenant: string; operator?: string },
  context: AuditContext
): Promise<Grant | null> {
  const tenant = await options.tenants.findBySlug(principal.tenant)
  if (!tenant) return null
  // The flag of the tenant is the work of its operator.
  if (!tenant.autoProvisionAdmin) return null

  // The principal is the one of the tenant: a grant may never name a
  // principal of another tenant.
  const owner = await options.principals.findById(principal.id, platformScope())
  if (!owner || owner.tenant !== tenant.slug) return null

  const permission = options.tenantAdminPermission ?? TENANT_ADMIN_PERMISSION

  // The provider of a tenant that another tenant shares is not the
  // provider of the tenant alone: the first identity that signs in is
  // the first identity of the directory, and not of the tenant. A
  // tenant that shares its provider with another one is given no
  // administrator by its first identity, and the operator of the
  // platform grants the administration by hand.
  const sharing = (await options.tenants.list()).filter(
    (other) => other.id !== tenant.id && other.issuer === tenant.issuer
  )
  if (sharing.length > 0) return null

  // The tenant that already has an administrator keeps it: the first
  // identity of a tenant that has one is not its administrator.
  const held = await options.grants.findLiveByPermission(tenant.id, permission, tenant.slug)
  if (held.length > 0) return null

  const created = await options.grants.create(
    {
      tenantId: tenant.id,
      userId: principal.id,
      groupId: null,
      permissionId: (await resolvePermission(options, tenant.id, permission)).id,
      roleId: null,
      // The workspace of the grant is the tenant itself: the console
      // asks for the context of the tenant of its caller, and the slug of
      // the tenant is the workspace it names. The route is left out: the
      // grant is the administration of the tenant, and it is not the
      // administration of one route of it.
      workspaceId: tenant.slug,
      routeId: null,
      expiresAt: null,
      // The principal that signs in first is the one that gives the
      // administration of the tenant to itself.
      grantedBy: principal.operator ?? principal.id,
    },
    change('grant.created', tenant.slug, context)
  )
  return created
}
