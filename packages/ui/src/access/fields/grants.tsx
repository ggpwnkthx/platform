import type { RoleInfo, TableInfo } from '@platform/data'
import type { Held, Wanted } from '@platform/vocabulary'
import { Badge } from '../../ui/bits.tsx'
import { perField, heldOf } from '../model.ts'
import { Legend, Mark, RoleLabel } from '../rights.tsx'

/**
 * Who holds one field of one collection, and the boxes that change it: a privilege held on
 * the whole collection covers the field with it.
 */
export function FieldGrantsTable({
  info,
  roles,
  grantees,
  column,
  owner,
  held,
  wanted,
  holds,
  toggle,
}: {
  /** The collection the field is of, when the reader may see it. */
  info?: TableInfo
  roles: RoleInfo[]
  grantees: string[]
  column: string
  /** Whether the reader may change what is held: the collection's owner may. */
  owner: boolean
  /** What one grantee holds, by privilege. */
  held: (grantee: string) => Record<string, Held>
  wanted: (grantee: string, privilege: string) => Wanted
  holds: (grantee: string, privilege: string) => boolean
  toggle: (grantee: string, privilege: string, on: boolean) => void
}) {
  return (
    <div class="grid-wrap">
      <table class="grid grid-tight">
        <thead>
          <tr>
            <th>Role</th>
            {perField.map((privilege) => (
              <th key={privilege} class="matrix-cell mono">
                {privilege}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {info && (
            <tr>
              <td>
                <RoleLabel name={info.owner} roles={roles} plain />
                <Badge tone="outline">owner</Badge>
              </td>
              {perField.map((privilege) => (
                <td key={privilege} class="matrix-cell">
                  <Mark hold="all" label={`${privilege}: the owner holds every privilege`} />
                </td>
              ))}
            </tr>
          )}
          {grantees.map((grantee) => (
            <tr key={grantee}>
              <td>
                <RoleLabel name={grantee} roles={roles} plain />
              </td>
              {perField.map((privilege) => {
                const whole = heldOf(held(grantee), privilege).whole
                const on = holds(grantee, privilege)
                return (
                  <td key={privilege} class="matrix-cell">
                    {owner ? (
                      <input
                        type="checkbox"
                        aria-label={`${privilege} on ${column} for ${grantee}`}
                        checked={on}
                        onChange={(e) => toggle(grantee, privilege, e.currentTarget.checked)}
                      />
                    ) : (
                      <Mark
                        hold={on ? 'all' : 'none'}
                        label={`${privilege}: ${on ? 'held' : 'not held'}`}
                      />
                    )}
                    {whole && wanted(grantee, privilege) === 'all' && (
                      <small class="cell-caption">whole collection</small>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {!owner && (
        <div class="grid-note">
          <Legend of="field" />
        </div>
      )}
    </div>
  )
}
