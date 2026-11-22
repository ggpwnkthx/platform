import type { GrantInfo, ReachInfo, RoleInfo, TableInfo } from '@platform/data'
import { Badge } from '../../ui/bits.tsx'
import { Button } from '../../ui/button.tsx'
import { EditIcon, GrantIcon } from '../../ui/icons.tsx'
import { HoldCell, HoldCells, PrivilegeHeads } from '../grants/marks.tsx'
import { asked, drawn, everyone, granteesOf, heldBy } from '../model.ts'
import { Legend, RoleLabel } from '../rights.tsx'

/**
 * The roles a collection's ACL names, and what each may do with it. A group is granted once
 * for all its members; the owner is not listed, because it holds everything already.
 */
export function CollectionGrants({
  table,
  grants,
  roles,
  answers,
  fields,
  onGrant,
  onEdit,
}: {
  table: TableInfo
  grants: GrantInfo[]
  roles: RoleInfo[]
  /** The database's own answer for each role that reaches the collection. */
  answers: ReachInfo[]
  /** How many fields the collection has. */
  fields: number
  onGrant: () => void
  onEdit: (grantee: string) => void
}) {
  const owner = table.can_alter
  const schema = table.schema
  const grantees = granteesOf(grants, table.name, table.owner)
  const answerFor = (grantee: string) => answers.find((row) => row.role === asked(grantee))
  return (
    <section class="section">
      <header class="section-head">
        <div>
          <h2>Grants</h2>
          <p>
            The roles the ACL of <span class="mono">{table.name}</span> names, and what each may do
            with it. A group is granted once for all its members.
          </p>
        </div>
        {owner && (
          <Button icon={<GrantIcon size={16} />} onClick={onGrant}>
            Grant to a role
          </Button>
        )}
      </header>
      <div class="grid-wrap">
        <table class="grid matrix">
          <thead>
            <tr>
              <th>Role</th>
              <PrivilegeHeads />
              <th>Also</th>
              <th class="grid-actions">
                <span class="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <RoleLabel name={table.owner} roles={roles} />
                <Badge tone="outline">owner</Badge>
              </td>
              {drawn.map((privilege) => (
                <HoldCell key={privilege} hold="all" privilege={privilege} />
              ))}
              <td class="cell-muted">every privilege, and its row policies do not filter it</td>
              <td class="grid-actions" />
            </tr>
            {grantees.map((grantee) => {
              const answer = answerFor(grantee)
              return (
                <tr key={grantee}>
                  <td>
                    <RoleLabel name={grantee} roles={roles} />
                    {grantee === everyone && <Badge>everyone</Badge>}
                    {answer && !answer.usage && (
                      <Badge
                        tone="warning"
                        title={`Without USAGE on ${schema} the database refuses every statement on a collection inside`}
                      >
                        no USAGE on {schema}
                      </Badge>
                    )}
                  </td>
                  <HoldCells
                    held={heldBy(grants, table.name, grantee)}
                    privileges={drawn}
                    of={fields}
                  />
                  <td class="grid-actions">
                    {owner && (
                      <button
                        type="button"
                        class="icon-button"
                        aria-label={`Change what ${grantee} holds on ${table.name}`}
                        title="Change"
                        onClick={() => onEdit(grantee)}
                      >
                        <EditIcon size={16} />
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div class="grid-note">
          <Legend />
          {!grantees.length && <span>No role is granted anything: only the owner reaches it.</span>}
        </div>
      </div>
      {!owner && (
        <p class="panel-note">
          The database gives grants on {table.name} to its owner, {table.owner}, and its members.
        </p>
      )}
    </section>
  )
}
