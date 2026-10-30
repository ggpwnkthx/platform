/**
 * What a user may do in effect.
 *
 * A grant names a permission or a role, and a role names permissions and
 * other roles. An operator who reads "the role editor" does not read what
 * it holds: the console expands the roles of the tenant, the way the
 * decision of Access does, and says where every permission comes from —
 * the user itself or one of its groups, then the chain of roles.
 *
 * The expansion is a mirror and never an authority: the answer of
 * whether a user may use a workspace is the answer of Access (the access
 * context), and the console only explains it.
 */

import type { Grant, Role } from '../access'
import { isLive, type Right } from './rights'

/** Where a permission of a user comes from. */
export interface PermissionSource {
  readonly grant: Grant
  /** The key of the group the grant is held through, or null when the user holds it. */
  readonly group: string | null
  /** The roles the permission comes through, the granted role first; empty for a permission granted as it is. */
  readonly roles: readonly string[]
}

/** A permission a user holds in effect, and every place it comes from. */
export interface EffectivePermission {
  readonly permission: string
  readonly sources: readonly PermissionSource[]
}

/** The permissions a role holds, with the chain of roles each one comes through. */
export function expandRole(
  key: string,
  roles: readonly Role[]
): { permission: string; path: string[] }[] {
  const byKey = new Map(roles.map((role) => [role.key, role]))
  const found: { permission: string; path: string[] }[] = []
  const walk = (current: string, path: string[]) => {
    const role = byKey.get(current)
    if (!role) return
    for (const permission of role.permissions) found.push({ permission, path })
    for (const named of role.roles) {
      // Access refuses a cycle; a list that holds one anyway ends here.
      if (path.includes(named)) continue
      walk(named, [...path, named])
    }
  }
  walk(key, [key])
  return found
}

/** The permissions a role holds, sorted and once each. */
export function permissionsOfRole(key: string, roles: readonly Role[]): string[] {
  return [...new Set(expandRole(key, roles).map((entry) => entry.permission))].sort()
}

/** The roles that name a role, directly or through others. */
export function rolesIncluding(key: string, roles: readonly Role[]): Role[] {
  return roles.filter(
    (role) => role.key !== key && expandRole(role.key, roles).some((e) => e.path.includes(key))
  )
}

/** The permissions a user holds in effect: its live rights, with the roles expanded. */
export function effectivePermissionsOf(
  rights: readonly Right[],
  roles: readonly Role[]
): EffectivePermission[] {
  const byPermission = new Map<string, PermissionSource[]>()
  const add = (permission: string, source: PermissionSource) => {
    const sources = byPermission.get(permission) ?? []
    sources.push(source)
    byPermission.set(permission, sources)
  }
  for (const { grant, group } of rights) {
    if (!isLive(grant)) continue
    if (grant.permission) add(grant.permission, { grant, group, roles: [] })
    else if (grant.role) {
      for (const entry of expandRole(grant.role, roles)) {
        add(entry.permission, { grant, group, roles: entry.path })
      }
    }
  }
  return [...byPermission]
    .map(([permission, sources]) => ({ permission, sources }))
    .sort((left, right) => left.permission.localeCompare(right.permission))
}

/** Reports whether a live grant holds for a workspace and a route. */
export function grantAppliesTo(grant: Grant, workspaceId: string, routeId: string): boolean {
  if (!isLive(grant)) return false
  const workspace =
    grant.workspaceId === null || grant.workspaceId.toLowerCase() === workspaceId.toLowerCase()
  const route = grant.routeId === null || grant.routeId === routeId
  return workspace && route
}

/** The permissions a tenant names: in its grants, and in its roles. */
export function knownPermissionsOf(grants: readonly Grant[], roles: readonly Role[]): string[] {
  const keys = new Set<string>()
  for (const grant of grants) if (grant.permission) keys.add(grant.permission)
  for (const role of roles) for (const permission of role.permissions) keys.add(permission)
  return [...keys].sort()
}
