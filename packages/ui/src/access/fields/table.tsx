import type { GrantInfo, TableInfo } from '@platform/data'
import { columnsOf } from '@platform/data'
import { useSession } from '../../session.tsx'
import { KeyIcon } from '../../ui/icons.tsx'
import { granteesOf, heldBy, heldOf, holdsField, perField } from '../model.ts'

/**
 * Who reads and writes each field, as the collection's ACL records it. A role that holds a
 * privilege on the whole collection holds it on every field, and is drawn quieter than one
 * granted the field by name; a field nobody is listed against is its owner's alone.
 */
export function FieldAccessTable({
  table,
  grants,
  onOpen,
}: {
  table: TableInfo
  grants: GrantInfo[]
  onOpen: (column: string) => void
}) {
  const { catalog } = useSession()
  const columns = columnsOf(catalog, table.schema, table.name)
  const grantees = granteesOf(grants, table.name, table.owner)
  const holdings = grantees.map((grantee) => ({
    grantee,
    held: heldBy(grants, table.name, grantee),
  }))
  return (
    <div class="grid-wrap">
      <table class="grid">
        <thead>
          <tr>
            <th>Field</th>
            {perField.map((privilege) => (
              <th key={privilege} class="mono">
                {privilege}
              </th>
            ))}
            <th class="grid-actions">
              <span class="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {columns.map((column) => (
            <tr key={column.name}>
              <td class="mono strong">{column.name}</td>
              {perField.map((privilege) => {
                const who = holdings.filter((h) =>
                  holdsField(heldOf(h.held, privilege), column.name)
                )
                return (
                  <td key={privilege}>
                    {who.length ? (
                      <span class="who">
                        {who.map((h) => (
                          <span
                            key={h.grantee}
                            class={
                              heldOf(h.held, privilege).whole ? 'who-role is-whole' : 'who-role'
                            }
                            title={
                              heldOf(h.held, privilege).whole
                                ? `${h.grantee} holds ${privilege} on the whole collection`
                                : `${h.grantee} is granted ${privilege} on this field`
                            }
                          >
                            {h.grantee}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span class="cell-muted">owner only</span>
                    )}
                  </td>
                )
              })}
              <td class="grid-actions">
                <button
                  type="button"
                  class="icon-button"
                  aria-label={`Access to ${column.name}`}
                  title={table.can_alter ? 'Change who holds this field' : 'Who holds this field'}
                  onClick={() => onOpen(column.name)}
                >
                  <KeyIcon size={16} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p class="grid-note">
        <span class="who">
          <span class="who-role">role</span> granted the field by name
        </span>
        <span class="who">
          <span class="who-role is-whole">role</span> holds the whole collection
        </span>
      </p>
    </div>
  )
}
