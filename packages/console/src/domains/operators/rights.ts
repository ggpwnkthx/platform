/**
 * The rights of a user.
 *
 * The console speaks the words of an operator: a **user** is a principal
 * of Access, and a **right** is a grant. A user holds a right
 * by itself, or through a group it is a member of: Access
 * evaluates both, and the console shows both, with where each one comes
 * from.
 */

import type { Grant, Group, Principal } from '../access'

/** A right of a user, and where it comes from. */
export interface Right {
  readonly grant: Grant
  /** The key of the group the right comes through, or null when the user holds it. */
  readonly group: string | null
}

/** Reports whether a grant is alive: not revoked and not expired. */
export function isLive(grant: Grant, now = Date.now()): boolean {
  if (grant.revokedAt) return false
  if (grant.expiresAt && Date.parse(grant.expiresAt) <= now) return false
  return true
}

/** The groups a user is a member of. */
export function groupsOf(user: Principal, groups: readonly Group[]): Group[] {
  return groups.filter((group) => group.members.includes(user.externalSubject))
}

/** The rights of a user: its own, and the ones of its groups. */
export function rightsOf(
  user: Principal,
  grants: readonly Grant[],
  groups: readonly Group[]
): Right[] {
  const memberOf = new Set(groupsOf(user, groups).map((group) => group.key))
  const rights: Right[] = []
  for (const grant of grants) {
    if (grant.userId === user.id) rights.push({ grant, group: null })
    else if (grant.group && memberOf.has(grant.group)) rights.push({ grant, group: grant.group })
  }
  return rights.sort(
    (left, right) =>
      (left.grant.permission ?? left.grant.role ?? '').localeCompare(
        right.grant.permission ?? right.grant.role ?? ''
      ) || (left.group ?? '').localeCompare(right.group ?? '')
  )
}

/** The shape of a uuid: the identifier of a workspace of Data. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Reports whether a value is a uuid. */
export function isUuid(value: string): boolean {
  return UUID.test(value)
}

/**
 * The workspaces a user holds a right on.
 *
 * A right on a workspace of Data names its uuid; a right on
 * the route of the console names the tenant, and it is not a workspace.
 * A right on every workspace of the tenant names none, and the console
 * cannot list what it does not name: the caller opens such a workspace
 * by its identifier.
 */
export function workspacesOf(
  rights: readonly Right[],
  consoleRoute: string
): { readonly ids: readonly string[]; readonly everyWorkspace: boolean } {
  const ids = new Set<string>()
  let everyWorkspace = false
  for (const { grant } of rights) {
    if (!isLive(grant) || grant.routeId === consoleRoute) continue
    if (grant.workspaceId === null) everyWorkspace = true
    else if (isUuid(grant.workspaceId)) ids.add(grant.workspaceId.toLowerCase())
  }
  return { ids: [...ids].sort(), everyWorkspace }
}
