import {
  type Catalog,
  type GrantInfo,
  type MembershipInfo,
  type ReachInfo,
  type TableInfo,
  columnsOf,
} from '@platform/data'
import { schemaPrivileges } from '@platform/vocabulary'
import { href } from '../../url.ts'
import { Badge, Notice } from '../../ui/bits.tsx'
import { Button } from '../../ui/button.tsx'
import { EditIcon, GrantIcon } from '../../ui/icons.tsx'
import { HoldCell, PrivilegeHeads } from '../grants/marks.tsx'
import { drawn, heldBy, heldOf, holdsAny, others, reaches, reachOf, throughOf } from '../model.ts'
import { Legend, Mark } from '../rights.tsx'

/** Where what a role may do with a collection comes from: its own grants, and whose. */
function ComesFrom({
  own,
  through,
  reached,
}: {
  own: boolean
  through: string[]
  reached: boolean
}) {
  if (!own && !through.length) return reached ? <>a group you may not see</> : null
  return (
    <>
      {own && 'its own grants'}
      {own && through.length > 0 && ', '}
      {through.length > 0 && <span class="mono">{through.join(', ')}</span>}
    </>
  )
}

/** What the role holds on the workspace itself: its usage, and its right to create. */
export function WorkspaceRights({
  ws,
  name,
  workspace,
  mayAlter,
  holdsHere,
  onChange,
}: {
  ws: string
  name: string
  workspace: { usage: boolean; create: boolean } | undefined
  mayAlter: boolean
  holdsHere: boolean
  onChange: () => void
}) {
  if (!workspace) return null
  return (
    <>
      <p class="reach-line">
        <span>
          The workspace <span class="mono">{ws}</span>
        </span>
        {schemaPrivileges.map((privilege) => {
          const held = privilege === 'USAGE' ? workspace.usage : workspace.create
          return (
            <span key={privilege} class="right">
              <Mark
                hold={held ? 'all' : 'none'}
                label={`${privilege}: ${held ? 'held' : 'not held'}`}
              />
              <span class="right-name">{privilege}</span>
              <span class="sr-only">{held ? 'held' : 'not held'}</span>
            </span>
          )
        })}
        {mayAlter && (
          <Button small icon={<GrantIcon size={14} />} onClick={onChange}>
            Change
          </Button>
        )}
      </p>
      {!workspace.usage && holdsHere && (
        <Notice tone="warning" title={`${name} may not use ${ws}`}>
          It holds privileges on collections here, and the database refuses every statement on them
          until it holds USAGE on the workspace.
        </Notice>
      )}
    </>
  )
}

/** What the role may do in the workspace: the database's own answer, collection by collection. */
export function ReachTable({
  ws,
  name,
  tables,
  acl,
  answers,
  memberships,
  catalog,
  onGrant,
}: {
  ws: string
  name: string
  tables: TableInfo[]
  acl: GrantInfo[]
  answers: ReachInfo[]
  memberships: MembershipInfo[]
  catalog: Catalog
  onGrant: (table: string) => void
}) {
  return (
    <div class="grid-wrap">
      <table class="grid matrix">
        <thead>
          <tr>
            <th>Collection</th>
            <PrivilegeHeads />
            <th>Also</th>
            <th>Comes from</th>
            <th class="grid-actions">
              <span class="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {tables.map((t) => {
            const answer = answers.find((row) => row.table === t.name)
            const held = heldBy(acl, t.name, name)
            const own = holdsAny(held)
            const through = throughOf(name, t.name, acl, memberships)
            const owns = t.owner === name
            const columns = columnsOf(catalog, ws, t.name)
            return (
              <tr key={t.name}>
                <td>
                  <a
                    class="grid-open strong"
                    href={href('/model/collection', { ws, c: t.name, tab: 'access' })}
                  >
                    <span class="mono">{t.name}</span>
                  </a>
                  {owns && <Badge tone="outline">owner</Badge>}
                </td>
                {drawn.map((privilege) => (
                  <HoldCell
                    key={privilege}
                    hold={owns ? 'all' : reachOf(answer, privilege)}
                    privilege={privilege}
                    // The ACL says which fields only where nothing else adds to them.
                    fields={through.length ? undefined : heldOf(held, privilege).columns}
                    of={columns.length}
                  />
                ))}
                <td class="mono cell-muted">
                  {others.filter((p) => reachOf(answer, p) !== 'none').join(', ')}
                </td>
                <td class="cell-muted">
                  {owns ? (
                    'owner'
                  ) : (
                    <ComesFrom
                      own={own}
                      through={through}
                      reached={Boolean(answer && reaches(answer))}
                    />
                  )}
                </td>
                <td class="grid-actions">
                  {t.can_alter && !owns && (
                    <button
                      type="button"
                      class="icon-button"
                      aria-label={`Change what ${name} holds on ${t.name}`}
                      title="Change its own grants"
                      onClick={() => onGrant(t.name)}
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
      </div>
    </div>
  )
}
