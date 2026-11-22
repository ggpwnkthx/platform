import type { Catalog, GrantInfo, PolicyInfo, RoleInfo, TableInfo } from '@platform/data'
import { columnsOf } from '@platform/data'
import { href } from '../../url.ts'
import { Badge } from '../../ui/bits.tsx'
import { CollectionIcon, PlusIcon } from '../../ui/icons.tsx'
import { HoldCells, PrivilegeHeads } from '../grants/marks.tsx'
import { drawn, everyone, granteesOf, heldBy } from '../model.ts'
import { Legend, RoleLabel } from '../rights.tsx'

/**
 * Every collection of the workspace, and for each the roles its ACL names: one row for one
 * role, the collection itself drawn once beside them.
 */
export function CollectionGrantsTable({
  ws,
  tables,
  all,
  roles,
  policies,
  catalog,
  onGrant,
}: {
  ws: string
  tables: TableInfo[]
  all: GrantInfo[]
  roles: RoleInfo[]
  policies: PolicyInfo[]
  catalog: Catalog
  onGrant: (target: { table: string; grantee?: string }) => void
}) {
  return (
    <div class="grid-wrap">
      <table class="grid matrix grouped">
        <thead>
          <tr>
            <th>Collection</th>
            <th>Role</th>
            <PrivilegeHeads />
            <th>Also</th>
            <th class="grid-actions">
              <span class="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        {tables.map((table) => {
          const grantees = granteesOf(all, table.name, table.owner)
          const columns = columnsOf(catalog, ws, table.name)
          const mine = policies.filter((p) => p.schema === ws && p.table === table.name)
          const rows = Math.max(grantees.length, 1)
          const about = (
            <td rowSpan={rows} class="group-cell">
              <a
                class="grid-open strong"
                href={href('/model/collection', { ws, c: table.name, tab: 'access' })}
              >
                <CollectionIcon size={16} aria-hidden="true" />
                <span class="mono">{table.name}</span>
              </a>
              <span class="group-facts">
                <span>
                  owner <span class="mono">{table.owner}</span>
                </span>
                {table.kind === 'v' ? (
                  <span>view</span>
                ) : (
                  <span>
                    row security {table.rls ? 'on' : 'off'}
                    {table.rls || mine.length
                      ? `, ${mine.length} ${mine.length === 1 ? 'policy' : 'policies'}`
                      : ''}
                  </span>
                )}
              </span>
            </td>
          )
          return (
            <tbody key={table.name}>
              {grantees.length ? (
                grantees.map((grantee, index) => {
                  const held = heldBy(all, table.name, grantee)
                  return (
                    <tr key={grantee}>
                      {index === 0 && about}
                      <td>
                        <RoleLabel name={grantee} roles={roles} />
                        {grantee === everyone && <Badge>everyone</Badge>}
                      </td>
                      <HoldCells held={held} privileges={drawn} of={columns.length} />
                      <td class="grid-actions">
                        {table.can_alter && (
                          <button
                            type="button"
                            class="icon-button"
                            aria-label={`Change what ${grantee} holds on ${table.name}`}
                            title="Change"
                            onClick={() => onGrant({ table: table.name, grantee })}
                          >
                            <PlusIcon size={16} />
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })
              ) : (
                <tr>
                  {about}
                  <td class="cell-muted" colSpan={drawn.length + 2}>
                    No role is granted anything: only its owner reaches it.
                  </td>
                  <td class="grid-actions">
                    {table.can_alter && (
                      <button
                        type="button"
                        class="icon-button"
                        aria-label={`Grant on ${table.name}`}
                        title="Grant to a role"
                        onClick={() => onGrant({ table: table.name })}
                      >
                        <PlusIcon size={16} />
                      </button>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          )
        })}
      </table>
      <div class="grid-note">
        <Legend />
        <span>An owner holds every privilege on what it owns and is not listed.</span>
      </div>
    </div>
  )
}
