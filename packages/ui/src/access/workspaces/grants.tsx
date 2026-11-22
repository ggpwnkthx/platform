import { useState } from 'preact/hooks'
import { type RoleInfo, type SchemaInfo, schemaGrants, schemaReach } from '@platform/data'
import { schemaPrivileges } from '@platform/vocabulary'
import { describe, useLoad, useSession } from '../../session.tsx'
import { href } from '../../url.ts'
import { Badge, Loading, Notice } from '../../ui/bits.tsx'
import { Button } from '../../ui/button.tsx'
import { ChevronRightIcon, EditIcon, GrantIcon } from '../../ui/icons.tsx'
import { everyone } from '../model.ts'
import { Legend, Mark, RoleLabel } from '../rights.tsx'
import { SchemaGrantDrawer } from '../grants/schema.tsx'

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
            policies; without it the database refuses them all. CREATE lets it make collections
            here.
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
