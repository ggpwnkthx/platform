/**
 * The roles of a tenant against its permissions: a grid.
 *
 * The page of a role says what one role holds. An operator who compares
 * the roles, or gives one permission to several of them, reads a grid
 * instead: a row for every permission the tenant names, a column for
 * every role, and in each cell whether the role holds the permission
 * itself, through a role it includes, or not at all.
 *
 * Access replaces the permissions of a role with the list it is sent.
 * The grid is read as what the operator changed — the cells that were
 * ticked and the cells that were cleared — and the change is applied to
 * what the role holds when it is written: a permission another operator
 * gave the role in the meantime is not taken away by a grid that never
 * showed it.
 */

import type { Role } from '../access'
import { familyOf } from './catalog'
import { expandRole } from './effective'

/** A cell of the grid: how a role holds a permission. */
export interface MatrixCell {
  /** Whether the role holds the permission itself. */
  readonly own: boolean
  /**
   * The roles the permission comes through, when the role includes one
   * that holds it: one chain per way, the included role first.
   */
  readonly through: readonly (readonly string[])[]
}

/** A row of the grid: one permission, and its cell for every role. */
export interface MatrixRow {
  readonly permission: string
  /** The cells of the row, by the key of the role. */
  readonly cells: Readonly<Record<string, MatrixCell>>
}

/** The rows of one family of permissions. */
export interface MatrixFamily {
  readonly family: string
  readonly rows: readonly MatrixRow[]
}

/**
 * The grid of the roles of a tenant.
 *
 * @param roles the roles of the tenant: the columns.
 * @param permissions the permissions the tenant names: the rows.
 */
export function matrixOf(roles: readonly Role[], permissions: readonly string[]): MatrixFamily[] {
  const held = new Map(roles.map((role) => [role.key, expandRole(role.key, roles)]))
  const families = new Map<string, MatrixRow[]>()
  for (const permission of [...new Set(permissions)].sort()) {
    const cells: Record<string, MatrixCell> = {}
    for (const role of roles) {
      const ways = (held.get(role.key) ?? []).filter((entry) => entry.permission === permission)
      cells[role.key] = {
        own: ways.some((entry) => entry.path.length === 1),
        through: ways.filter((entry) => entry.path.length > 1).map((entry) => entry.path.slice(1)),
      }
    }
    const family = familyOf(permission)
    families.set(family, [...(families.get(family) ?? []), { permission, cells }])
  }
  return [...families]
    .map(([family, rows]) => ({ family, rows }))
    .sort((left, right) => left.family.localeCompare(right.family))
}

/** The cells of one role, as a grid was drawn and as it came back. */
export interface MatrixColumn {
  /** The permissions whose cells were ticked when the grid was drawn. */
  readonly shown: readonly string[]
  /** The permissions whose cells are ticked now. */
  readonly ticked: readonly string[]
}

/** What a grid changes in one role. */
export interface RoleChange {
  readonly role: Role
  readonly added: readonly string[]
  readonly removed: readonly string[]
  /** The permissions the role holds once the change is applied. */
  readonly permissions: readonly string[]
}

/**
 * The changes of a grid, role by role.
 *
 * A role the grid does not change is not in the answer, and neither is
 * a role whose change is already what it holds: nothing is written for
 * it.
 *
 * @param roles the roles of the tenant, as they are now.
 * @param columns the cells of the grid, by the key of the role.
 */
export function matrixChangesOf(
  roles: readonly Role[],
  columns: Readonly<Record<string, MatrixColumn>>
): RoleChange[] {
  const changes: RoleChange[] = []
  for (const role of roles) {
    const column = columns[role.key]
    if (!column) continue
    const shown = new Set(column.shown)
    const ticked = new Set(column.ticked)
    const current = new Set(role.permissions)
    const added = [...ticked].filter((key) => !shown.has(key) && !current.has(key)).sort()
    const removed = [...shown].filter((key) => !ticked.has(key) && current.has(key)).sort()
    if (added.length === 0 && removed.length === 0) continue
    const permissions = [...role.permissions.filter((key) => !removed.includes(key)), ...added]
    changes.push({ role, added, removed, permissions: permissions.sort() })
  }
  return changes
}
