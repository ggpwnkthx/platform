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
import { KNOWN_PERMISSIONS } from './catalog'
import { isLive, type Right } from './rights'
import { CONSOLE_KEYS, isPlatformKey } from './scope'

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

/**
 * The permissions a role holds in effect once it is written: the ones it
 * is written with, and the ones of the roles it is written to include.
 *
 * A role that comes to include another gives what the other holds to
 * everybody who holds the first: the write of a role is checked against
 * all of it, and not against its own permissions alone.
 *
 * @param write the permissions and the included roles the role is written with.
 * @param roles the roles of the tenant, as they are before the write.
 */
export function permissionsOfWrite(
  write: { readonly permissions?: readonly string[]; readonly roles?: readonly string[] },
  roles: readonly Role[]
): string[] {
  return [
    ...new Set([
      ...(write.permissions ?? []),
      ...(write.roles ?? []).flatMap((key) => permissionsOfRole(key, roles)),
    ]),
  ].sort()
}

/** The permissions a grant gives: its permission, or the ones its role holds in effect. */
export function permissionsOfGrant(grant: Grant, roles: readonly Role[]): string[] {
  if (grant.permission) return [grant.permission]
  return grant.role ? permissionsOfRole(grant.role, roles) : []
}

/**
 * The capabilities of the platform a group gives to its members.
 *
 * A member of a group holds what the group is granted: a group whose
 * live rights give a capability of the platform — as it is, or in a
 * role — hands it to whoever joins. Access reads the same rights when a
 * member is added, wherever they hold (Access spec §3.3.1).
 *
 * @param group the key of the group.
 * @param grants the rights of the tenant.
 * @param roles the roles of the tenant.
 */
export function platformKeysOfGroup(
  group: string,
  grants: readonly Grant[],
  roles: readonly Role[]
): string[] {
  const keys = new Set<string>()
  for (const grant of grants) {
    if (grant.group !== group || !isLive(grant)) continue
    for (const key of permissionsOfGrant(grant, roles)) if (isPlatformKey(key)) keys.add(key)
  }
  return [...keys].sort()
}

/** A list the console read of a tenant, and whether it is all of it. */
export interface Listing<Row> {
  readonly rows: readonly Row[]
  /** False when the tenant holds more rows than the console reads, or when the list was refused. */
  readonly complete: boolean
}

/**
 * Reports whether the console read everything that says what a group
 * gives: every live right of the tenant, and every role of it when a
 * right of the group names one.
 *
 * The console reads a bounded number of rows of a tenant. A group whose
 * rights it did not read whole may give a capability of the platform
 * that `platformKeysOfGroup` does not name: the caller of this function
 * does not take an empty answer for "nothing".
 *
 * @param group the key of the group.
 * @param grants the live rights the console read of the tenant.
 * @param roles the roles the console read of the tenant.
 */
export function groupIsReadWhole(
  group: string,
  grants: Listing<Grant>,
  roles: Listing<Role>
): boolean {
  if (!grants.complete) return false
  const throughRoles = grants.rows.some(
    (grant) => grant.group === group && isLive(grant) && Boolean(grant.role)
  )
  return roles.complete || !throughRoles
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

/**
 * The permissions a tenant names: in its grants, and in its roles.
 *
 * The permissions the console knows the meaning of are named too, the
 * capabilities of the platform among them: a reader finds the key it
 * looks for, with what it opens or the reason it is refused, rather than
 * an absence.
 */
export function knownPermissionsOf(grants: readonly Grant[], roles: readonly Role[]): string[] {
  const keys = new Set<string>()
  for (const grant of grants) if (grant.permission) keys.add(grant.permission)
  for (const role of roles) for (const permission of role.permissions) keys.add(permission)
  for (const permission of KNOWN_PERMISSIONS) keys.add(permission.key)
  return [...keys].sort()
}

/** The place the console asks Access about: the tenant itself, on the route of the console. */
export interface ConsolePlace {
  /** The slug of the tenant: the workspace the console names. */
  readonly tenant: string
  /** The route of the console at Access. */
  readonly consoleRoute: string
}

/** How a right opens the administration of a tenant. */
export interface Administration {
  /** The key that opens it: `console.platform`, or `console.admin`. */
  readonly key: string
  /** The roles the key comes through, the granted role first; empty for a permission granted as it is. */
  readonly roles: readonly string[]
}

/**
 * How a grant opens the administration of a tenant, or null when it
 * does not.
 *
 * The console asks Access about the tenant itself, on its own route: a
 * live grant that holds there and gives `console.admin` or
 * `console.platform` — as it is, or through a role — opens the
 * administration to its holder. The answer is a mirror: whether the
 * administration opens is the answer of Access.
 */
export function administrationOf(
  grant: Grant,
  roles: readonly Role[],
  place: ConsolePlace
): Administration | null {
  if (!grantAppliesTo(grant, place.tenant, place.consoleRoute)) return null
  // The key of the platform first: it opens more than the key of a tenant.
  const keys: readonly string[] = [CONSOLE_KEYS.platform, CONSOLE_KEYS.admin]
  if (grant.permission) {
    return keys.includes(grant.permission) ? { key: grant.permission, roles: [] } : null
  }
  if (!grant.role) return null
  const held = expandRole(grant.role, roles)
  for (const key of keys) {
    const found = held.find((entry) => entry.permission === key)
    if (found) return { key, roles: found.path }
  }
  return null
}

/**
 * The rights that open the administration of a tenant, and would stop
 * opening it once a role is written.
 *
 * A role that holds `console.admin` opens the administration to
 * everybody who holds the role on the tenant itself. Written without
 * the key, it closes it to all of them at once, the operator who writes
 * it among them: the console asks before it sends such a write.
 *
 * @param grants the rights of the tenant.
 * @param roles the roles of the tenant, as they are before the write.
 * @param written the role as it would be once written.
 * @param place the place the console asks Access about.
 */
export function administrationLostBy(
  grants: readonly Grant[],
  roles: readonly Role[],
  written: Pick<Role, 'key' | 'permissions' | 'roles'>,
  place: ConsolePlace
): Grant[] {
  const after = roles.map((role) =>
    role.key === written.key
      ? { ...role, permissions: written.permissions, roles: written.roles }
      : role
  )
  return grants.filter(
    (grant) =>
      administrationOf(grant, roles, place) !== null &&
      administrationOf(grant, after, place) === null
  )
}
