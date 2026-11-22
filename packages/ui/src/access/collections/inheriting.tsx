import type { GrantInfo, MembershipInfo, ReachInfo, RoleInfo } from '@platform/data'
import { HoldCell, PrivilegeHeads } from '../grants/marks.tsx'
import { drawn, reachOf, throughOf } from '../model.ts'
import { RoleLabel } from '../rights.tsx'

/**
 * The roles that reach a collection without being named in its ACL: through a group. What
 * they may do changes with the group's grants and with their membership.
 */
export function InheritingTable({
  table,
  grants,
  memberships,
  roles,
  rows,
}: {
  table: string
  grants: GrantInfo[]
  memberships: MembershipInfo[]
  /** The roles the reader may see. */
  roles: RoleInfo[]
  rows: ReachInfo[]
}) {
  return (
    <div class="grid-wrap">
      <table class="grid matrix">
        <thead>
          <tr>
            <th>Role</th>
            <PrivilegeHeads />
            <th>Through</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const through = throughOf(row.role, table, grants, memberships)
            return (
              <tr key={row.role}>
                <td>
                  <RoleLabel name={row.role} roles={roles} />
                </td>
                {drawn.map((privilege) => (
                  <HoldCell key={privilege} hold={reachOf(row, privilege)} privilege={privilege} />
                ))}
                <td class="cell-muted">
                  {through.length ? (
                    <span class="mono">{through.join(', ')}</span>
                  ) : (
                    'a group you may not see'
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
