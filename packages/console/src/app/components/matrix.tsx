/**
 * The grid of the roles of a tenant against its permissions.
 *
 * A row for every permission the tenant names, a column for every role.
 * A cell is a box the operator ticks or clears, and the grid is saved
 * whole: the page reads it as what changed, and writes the roles that
 * did.
 *
 * The grid is a form of the page and needs no script: the sheet marks
 * the cells that are not saved yet. A cell the operator may not change
 * is drawn closed, with the reason: a permission that is the platform's
 * to give, a role that holds one, and the permission that opens the
 * administration to the operator itself.
 */

import type { Role } from '../../domains/access'
import {
  KEY_PATTERN,
  knownPermission,
  type MatrixCell,
  type MatrixFamily,
} from '../../domains/operators'
import { tenantPath } from './operators'
import { Lock } from './why'

/** The name of the action of the grid, in the form of the page of the roles. */
export const MATRIX_ACTION = 'matrix'

/** What the operator may not change in the grid, and why. */
export interface MatrixLocks {
  /** The roles that are closed: by the key of the role. */
  readonly roles: ReadonlyMap<string, string>
  /** The permissions that are closed: by their key. */
  readonly permissions: ReadonlyMap<string, string>
  /** The cells that are closed on their own: by `cellKey`. */
  readonly cells: ReadonlyMap<string, string>
}

/** The name of a cell of the grid. */
export function cellKey(role: string, permission: string): string {
  return `${role}\n${permission}`
}

/** Why a cell is closed to the operator, or null when it is the operator's to change. */
export function lockOf(locks: MatrixLocks, role: string, permission: string): string | null {
  return (
    locks.cells.get(cellKey(role, permission)) ??
    locks.permissions.get(permission) ??
    locks.roles.get(role) ??
    null
  )
}

/** The roles a permission comes through, as a cell says them. */
function throughWords(cell: MatrixCell): string {
  return cell.through.map((chain) => chain.join(' → ')).join(', ')
}

/** One cell of the grid. */
function Cell(props: { role: Role; permission: string; cell: MatrixCell; lock: string | null }) {
  const { role, permission, cell, lock } = props
  const name = role.displayName ?? role.key
  const inherited =
    cell.through.length > 0 ? (
      <span class="matrix-through" title={`Held through ${throughWords(cell)}`}>
        <span aria-hidden="true">✓</span> via {cell.through[0]?.at(-1)}
      </span>
    ) : null
  if (lock) {
    return (
      <td class="matrix-cell closed" title={lock}>
        <span class="matrix-closed">
          {cell.own ? <span aria-hidden="true">✓</span> : null}
          <Lock />
          <span class="sr-only">
            {cell.own ? `${name} holds ${permission}.` : `${name} does not hold ${permission}.`}{' '}
            {lock}
          </span>
        </span>
        {inherited}
      </td>
    )
  }
  return (
    <td class="matrix-cell">
      <input
        type="checkbox"
        class="matrix-tick"
        name={`perm:${role.key}`}
        value={permission}
        checked={cell.own}
        data-was={cell.own ? 'on' : 'off'}
        aria-label={`${name} holds ${permission}`}
      />
      {inherited}
    </td>
  )
}

/** The grid of the roles, as a form. */
export function RoleMatrix(props: {
  tenant: string
  /** Where the grid is sent. */
  action: string
  families: readonly MatrixFamily[]
  roles: readonly Role[]
  locks: MatrixLocks
}) {
  const { roles, locks } = props
  const base = tenantPath(props.tenant)
  const width = roles.length + 1
  // What a role is shown to hold itself, in the cells the operator may
  // change: the grid comes back as what changed among them.
  const shown = (role: Role) =>
    role.permissions.filter((permission) => lockOf(locks, role.key, permission) === null)
  return (
    <form method="post" action={props.action} class="matrix-form">
      <input type="hidden" name="_action" value={MATRIX_ACTION} />
      {roles.map((role) => (
        <>
          <input type="hidden" name="role" value={role.key} />
          <input type="hidden" name={`shown:${role.key}`} value={shown(role).join('\n')} />
        </>
      ))}
      <div class="table-wrap matrix-wrap">
        <table class="matrix">
          <caption class="sr-only">The permissions each role of the tenant holds</caption>
          <thead>
            <tr>
              <th scope="col" class="matrix-head matrix-corner">
                Permission
              </th>
              {roles.map((role) => (
                <th scope="col" class="matrix-head">
                  <a
                    class="matrix-role-name"
                    href={`${base}/roles/${encodeURIComponent(role.key)}`}
                  >
                    {role.displayName ?? role.key}
                  </a>
                  <div class="small muted mono">{role.key}</div>
                  {role.roles.length > 0 ? (
                    <div class="small muted" title={`Includes ${role.roles.join(', ')}`}>
                      + {role.roles.join(', ')}
                    </div>
                  ) : null}
                  {locks.roles.has(role.key) ? (
                    <div class="small muted" title={locks.roles.get(role.key)}>
                      <Lock /> closed to you
                    </div>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          {props.families.map((family) => (
            <tbody>
              <tr>
                <th colspan={width} scope="colgroup" class="matrix-family-name">
                  {family.family}
                </th>
              </tr>
              {family.rows.map((row) => (
                <tr>
                  <th scope="row" class="matrix-permission">
                    <code>{row.permission}</code>
                    {knownPermission(row.permission) ? (
                      <div class="small muted">{knownPermission(row.permission)?.title}</div>
                    ) : null}
                    <a
                      class="small matrix-who"
                      href={`${base}/rights?right=${encodeURIComponent(row.permission)}`}
                    >
                      who holds it
                    </a>
                  </th>
                  {roles.map((role) => (
                    <Cell
                      role={role}
                      permission={row.permission}
                      cell={row.cells[role.key] ?? { own: false, through: [] }}
                      lock={lockOf(locks, role.key, row.permission)}
                    />
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
          <tbody>
            <tr>
              <th colspan={width} scope="colgroup" class="matrix-family-name">
                A permission the tenant does not name yet
              </th>
            </tr>
            <tr>
              <th scope="row" class="matrix-permission">
                <input
                  name="new"
                  class="mono matrix-new-key"
                  pattern={KEY_PATTERN}
                  title="Lower-case letters, digits, dots, dashes and underscores"
                  placeholder="content.archive"
                  autocomplete="off"
                  aria-label="The key of a new permission"
                />
              </th>
              {roles.map((role) =>
                locks.roles.has(role.key) ? (
                  <td class="matrix-cell closed" title={locks.roles.get(role.key)}>
                    <span class="matrix-closed">
                      <Lock />
                    </span>
                  </td>
                ) : (
                  <td class="matrix-cell">
                    <input
                      type="checkbox"
                      class="matrix-tick"
                      name={`new:${role.key}`}
                      value="yes"
                      data-was="off"
                      aria-label={`${role.displayName ?? role.key} holds the new permission`}
                    />
                  </td>
                )
              )}
            </tr>
          </tbody>
        </table>
      </div>
      <div class="matrix-save">
        <button type="submit" class="button">
          Save the changes
        </button>
        <a class="button quiet" href={props.action}>
          Discard
        </a>
        <span class="small muted matrix-clean">
          Tick a cell to give a permission to a role, clear it to take it away, then save.
        </span>
        <span class="small matrix-dirty" role="status">
          The marked cells are not saved yet.
        </span>
      </div>
    </form>
  )
}
