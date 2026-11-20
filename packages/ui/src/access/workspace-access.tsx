import { useState } from 'preact/hooks'
import {
  type RoleInfo,
  type SchemaInfo,
  columnsOf,
  grants as readGrants,
  policies as readPolicies,
  roles as readRoles,
  schemaGrants,
  schemaReach,
  tablesIn,
} from '@platform/data'
import { schemaPrivileges } from '@platform/vocabulary'
import { describe, useLoad, useSession } from '../session.tsx'
import { Page, useWorkspace, WorkspaceSelect } from '../shell.tsx'
import { href } from '../url.ts'
import { Badge, Empty, Loading, Notice } from '../ui/bits.tsx'
import { Action, Button } from '../ui/button.tsx'
import {
  ChevronRightIcon,
  CollectionIcon,
  EditIcon,
  GrantIcon,
  KeyIcon,
  PlusIcon,
} from '../ui/icons.tsx'
import { HoldCell, PrivilegeHeads } from './collection-access.tsx'
import { GrantDrawer, type GrantTarget, SchemaGrantDrawer } from './grant-editor.tsx'
import { alsoHeld, drawn, everyone, granteesOf, heldBy, heldOf, holdOf } from './model.ts'
import { Legend, Mark, RoleLabel } from './rights.tsx'

/**
 * Who may use a workspace: the roles its schema's ACL names, with USAGE and CREATE drawn as
 * every other privilege is. The workspace's owner changes it here.
 */
export function WorkspaceGrants({
  schema,
  roles,
  more,
}: {
  schema: SchemaInfo
  roles: RoleInfo[]
  /** A way on to the rest of the workspace's access, where this is not that page. */
  more?: boolean
}) {
  const { catalog } = useSession()
  const ws = schema.name
  const grants = useLoad((db) => schemaGrants(db, ws), [ws, catalog])
  const reach = useLoad((db) => schemaReach(db, ws), [ws, catalog])
  const [editing, setEditing] = useState<{ grantee?: string } | null>(null)
  const owner = schema.can_alter
  const list = grants.data ?? []
  const grantees = [...new Set(list.map((g) => g.grantee))]
    .filter((name) => name !== schema.owner)
    .sort((a, b) => (a === everyone ? -1 : b === everyone ? 1 : a.localeCompare(b)))
  // The roles the database lets in that the ACL does not name: members of one it does.
  const inheriting = (reach.data ?? []).filter(
    (row) =>
      row.usage &&
      row.role !== 'public' &&
      row.role !== schema.owner &&
      !grantees.includes(row.role) &&
      !roles.find((role) => role.name === row.role)?.superuser
  )
  return (
    <section class="panel">
      <header class="panel-head">
        <div>
          <h2>Who may use this workspace</h2>
          <p>
            USAGE lets a role reach the collections inside, each under its own grants and row
            policies; without it the database refuses them all. CREATE lets it make collections here.
          </p>
        </div>
        {owner && (
          <Button icon={<GrantIcon size={16} />} onClick={() => setEditing({})}>
            Grant to a role
          </Button>
        )}
      </header>
      {grants.error ? (
        <Notice tone="danger" title={describe(grants.error).title} />
      ) : !grants.data ? (
        <Loading />
      ) : (
        <table class="grid grid-plain matrix">
          <thead>
            <tr>
              <th>Role</th>
              {schemaPrivileges.map((privilege) => (
                <th key={privilege} class="matrix-cell mono">
                  {privilege}
                </th>
              ))}
              <th class="grid-actions">
                <span class="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <RoleLabel name={schema.owner} roles={roles} />
                <Badge tone="outline">owner</Badge>
              </td>
              {schemaPrivileges.map((privilege) => (
                <td key={privilege} class="matrix-cell">
                  <Mark hold="all" label={`${privilege}: the owner holds it`} />
                </td>
              ))}
              <td class="grid-actions" />
            </tr>
            {grantees.map((grantee) => (
              <tr key={grantee}>
                <td>
                  <RoleLabel name={grantee} roles={roles} />
                  {grantee === everyone && <Badge>everyone</Badge>}
                </td>
                {schemaPrivileges.map((privilege) => {
                  const held = list.some((g) => g.grantee === grantee && g.privilege === privilege)
                  return (
                    <td key={privilege} class="matrix-cell">
                      <Mark
                        hold={held ? 'all' : 'none'}
                        label={`${privilege}: ${held ? 'held' : 'not held'}`}
                      />
                      <span class="sr-only">{held ? 'held' : 'not held'}</span>
                    </td>
                  )
                })}
                <td class="grid-actions">
                  {owner && (
                    <button
                      type="button"
                      class="icon-button"
                      aria-label={`Change what ${grantee} holds on ${ws}`}
                      title="Change"
                      onClick={() => setEditing({ grantee })}
                    >
                      <EditIcon size={16} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {grants.data && (
        <div class="panel-foot">
          <Legend of="workspace" />
          {inheriting.length > 0 && (
            <span>
              Through those roles it is also used by{' '}
              <span class="mono">{inheriting.map((row) => row.role).join(', ')}</span>.
            </span>
          )}
          {more && (
            <a class="link-more" href={href('/access/grants', { ws })}>
              Every collection’s permissions <ChevronRightIcon size={14} aria-hidden="true" />
            </a>
          )}
        </div>
      )}
      <SchemaGrantDrawer
        schema={ws}
        target={editing}
        grants={list}
        roles={roles}
        onClose={() => setEditing(null)}
        onDone={() => {
          grants.reload()
          reach.reload()
        }}
      />
    </section>
  )
}

/**
 * The permissions of one workspace at a glance: who may use it, and for every collection
 * the roles its ACL names and what each holds. Each row opens the grant it draws.
 */
export function Grants() {
  const { catalog } = useSession()
  const ws = useWorkspace()
  const schema = catalog.schemas.find((s) => s.name === ws)
  const grants = useLoad(ws ? (db) => readGrants(db, ws) : null, [ws, catalog])
  const found = useLoad((db) => readRoles(db), [catalog])
  const policies = useLoad((db) => readPolicies(db), [catalog])
  const [granting, setGranting] = useState<GrantTarget | null>(null)
  const tables = tablesIn(catalog, ws)
  const owned = tables.filter((t) => t.can_alter)
  const roles = found.data?.roles ?? []
  const all = grants.data ?? []
  return (
    <Page
      title="Permissions"
      icon={<KeyIcon size={22} />}
      crumbs={[{ label: 'Access', href: href('/access') }]}
      subtitle="What has been granted in this workspace, read from its ACLs. A row is one role on one collection."
      actions={
        owned.length ? (
          <Action label="New grant" icon={<PlusIcon size={22} />} onClick={() => setGranting({})} />
        ) : undefined
      }
      toolbar={<WorkspaceSelect path="/access/grants" />}
    >
      {!schema ? (
        <Notice tone="warning" title={`The database shows you no workspace named ${ws}`} />
      ) : (
        <>
          <WorkspaceGrants schema={schema} roles={roles} />
          <section class="section">
            <header class="section-head">
              <div>
                <h2>Collections</h2>
                <p>
                  Three checks stand between a role and a row: USAGE on the workspace, a privilege
                  on the collection or its fields, and — where row security is on — a policy that
                  applies to the role. None stands in for another.
                </p>
              </div>
            </header>
            {grants.error ? (
              <Notice tone="danger" title={describe(grants.error).title} />
            ) : !grants.data ? (
              <Loading />
            ) : tables.length ? (
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
                    const mine = (policies.data ?? []).filter(
                      (p) => p.schema === ws && p.table === table.name
                    )
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
                                {drawn.map((privilege) => (
                                  <HoldCell
                                    key={privilege}
                                    hold={holdOf(held[privilege])}
                                    privilege={privilege}
                                    fields={heldOf(held, privilege).columns}
                                    of={columns.length}
                                  />
                                ))}
                                <td class="mono cell-muted">{alsoHeld(held).join(', ')}</td>
                                <td class="grid-actions">
                                  {table.can_alter && (
                                    <button
                                      type="button"
                                      class="icon-button"
                                      aria-label={`Change what ${grantee} holds on ${table.name}`}
                                      title="Change"
                                      onClick={() => setGranting({ table: table.name, grantee })}
                                    >
                                      <EditIcon size={16} />
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
                                  onClick={() => setGranting({ table: table.name })}
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
            ) : (
              <Empty icon={<KeyIcon size={24} />} title="No collection here you may reach" />
            )}
          </section>
        </>
      )}
      <GrantDrawer
        schema={ws}
        target={granting}
        grants={all}
        roles={roles}
        memberships={found.data?.memberships ?? []}
        onClose={() => setGranting(null)}
        onDone={grants.reload}
      />
    </Page>
  )
}
