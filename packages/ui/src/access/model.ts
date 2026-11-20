import type { GrantInfo, Hold, MembershipInfo, PolicyInfo, ReachInfo } from '@platform/data'
import {
  type Held,
  narrows,
  type PolicyCommand,
  type PolicyDraft,
  policyCommands,
  type Wanted,
} from '@platform/vocabulary'

/**
 * How the access pages read what the database said: an ACL turned into what each role holds,
 * and a membership list turned into where a right comes from. Nothing here decides a right;
 * it only arranges the answers so that the same grant reads the same way on every page.
 */

/** The privileges every access table draws a mark for. */
export const drawn = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] as const

/** The privileges named in words beside them: held more rarely, and never per field here. */
export const others = ['TRUNCATE', 'REFERENCES', 'TRIGGER'] as const

/** The privileges a field may carry in the interface. */
export const perField = ['SELECT', 'INSERT', 'UPDATE'] as const

/** Everyone, as an ACL writes it. */
export const everyone = 'PUBLIC'

/** PUBLIC as the database's privilege functions take it. */
export const asked = (grantee: string): string => (grantee === everyone ? 'public' : grantee)

const nothing: Held = { whole: false, columns: [] }

/** What one role holds on one collection, by privilege, as the ACL records it. */
export function heldBy(grants: GrantInfo[], table: string, grantee: string): Record<string, Held> {
  const held: Record<string, Held> = {}
  for (const grant of grants) {
    if (grant.table !== table || grant.grantee !== grantee) continue
    const entry = held[grant.privilege] ?? { whole: false, columns: [] }
    held[grant.privilege] = entry
    if (grant.column === null) entry.whole = true
    else entry.columns.push(grant.column)
  }
  return held
}

/** One privilege of a holding. */
export const heldOf = (held: Record<string, Held>, privilege: string): Held =>
  held[privilege] ?? nothing

/** A holding as a mark: the whole collection, some of its fields, or nothing. */
export const holdOf = (held: Held | undefined): Hold =>
  held?.whole ? 'all' : held?.columns.length ? 'some' : 'none'

/** A holding as the editor starts from it. */
export const wantedOf = (held: Held | undefined): Wanted =>
  held?.whole ? 'all' : held?.columns.length ? [...held.columns] : 'none'

/** Does the role hold the privilege on this field, through the collection or the field? */
export const holdsField = (held: Held | undefined, column: string): boolean =>
  Boolean(held?.whole || held?.columns.includes(column))

/** Does a holding grant anything at all? */
export const holdsAny = (held: Record<string, Held>): boolean =>
  Object.values(held).some((one) => one.whole || one.columns.length > 0)

/** The roles a collection's ACL names, its owner apart: PUBLIC first, then by name. */
export function granteesOf(grants: GrantInfo[], table: string, owner: string): string[] {
  const names = new Set<string>()
  for (const grant of grants)
    if (grant.table === table && grant.grantee !== owner) names.add(grant.grantee)
  return [...names].sort((a, b) => (a === everyone ? -1 : b === everyone ? 1 : a.localeCompare(b)))
}

/** The privileges of a holding that no mark is drawn for, in the database's order. */
export const alsoHeld = (held: Record<string, Held>): string[] =>
  others.filter((privilege) => holdOf(held[privilege]) !== 'none')

/** One privilege of the database's answer for a role. */
export function reachOf(reach: ReachInfo | undefined, privilege: string): Hold {
  if (!reach) return 'none'
  switch (privilege) {
    case 'SELECT':
      return reach.select
    case 'INSERT':
      return reach.insert
    case 'UPDATE':
      return reach.update
    case 'REFERENCES':
      return reach.references
    case 'DELETE':
      return reach.delete ? 'all' : 'none'
    case 'TRUNCATE':
      return reach.truncate ? 'all' : 'none'
    case 'TRIGGER':
      return reach.trigger ? 'all' : 'none'
    default:
      return 'none'
  }
}

/** Does the database's answer for a role let it do anything with the collection? */
export const reaches = (reach: ReachInfo): boolean =>
  [...drawn, ...others].some((privilege) => reachOf(reach, privilege) !== 'none')

const rank: Record<Hold, number> = { none: 0, some: 1, all: 2 }

/** Does the role reach more of a privilege than its own grants give it? */
export const reachesMore = (reach: Hold, own: Hold): boolean => rank[reach] > rank[own]

/**
 * The groups whose rights a role inherits, as far as the reader may see its memberships:
 * its own groups, and theirs in turn. A membership granted without INHERIT passes nothing on.
 */
export function groupsOf(role: string, memberships: MembershipInfo[]): string[] {
  const found: string[] = []
  const visit = (member: string) => {
    for (const membership of memberships) {
      if (membership.member !== member || !membership.inherit_option) continue
      if (found.includes(membership.role) || membership.role === role) continue
      found.push(membership.role)
      visit(membership.role)
    }
  }
  visit(role)
  return found
}

/**
 * Where a role's reach on a collection comes from besides its own grants: the groups it
 * inherits from that the ACL names, and PUBLIC when the ACL names it.
 */
export function throughOf(
  role: string,
  table: string,
  grants: GrantInfo[],
  memberships: MembershipInfo[]
): string[] {
  if (role === everyone) return []
  const named = new Set(grants.filter((g) => g.table === table).map((g) => g.grantee))
  const groups = groupsOf(role, memberships).filter((group) => named.has(group))
  return named.has(everyone) ? [...groups, everyone] : groups
}

/** What a role is to hold once one privilege on one field is given or taken. */
export function toggleField(
  current: Wanted,
  privilege: string,
  column: string,
  on: boolean,
  every: string[]
): Wanted {
  if (!narrows(privilege)) return current
  if (on) {
    if (current === 'all') return current
    const columns = current === 'none' ? [] : current
    return columns.includes(column) ? columns : [...columns, column]
  }
  // Taking one field from the whole collection leaves the others, by name.
  const columns = current === 'all' ? every : current === 'none' ? [] : current
  const left = columns.filter((name) => name !== column)
  return left.length ? left : 'none'
}

/** Are two wishes the same? */
export const sameWanted = (a: Wanted, b: Wanted): boolean =>
  typeof a === 'string' || typeof b === 'string'
    ? a === b
    : a.length === b.length && a.every((column) => b.includes(column))

/** A policy as the editor starts from it: the database's own record, turned back into a draft. */
export function draftOf(policy: PolicyInfo): PolicyDraft {
  const command = policyCommands.includes(policy.command as PolicyCommand)
    ? (policy.command as PolicyCommand)
    : 'ALL'
  return {
    schema: policy.schema,
    table: policy.table,
    name: policy.name,
    permissive: policy.permissive === 'PERMISSIVE',
    command,
    roles: policy.roles.filter((role) => role !== 'public'),
    using: policy.using ?? '',
    check: policy.check ?? '',
  }
}

/** Does a policy apply to a role: by its name, through a group it inherits from, or as PUBLIC? */
export const policyReaches = (policy: PolicyInfo, role: string, groups: string[]): boolean =>
  policy.roles.some((named) => named === 'public' || named === role || groups.includes(named))

/** "1 field", "3 fields". */
export const count = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`
