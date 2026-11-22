import { useState } from 'preact/hooks'
import {
  type RoleInfo,
  grants as readGrants,
  policies as readPolicies,
  roles as readRoles,
  tablesIn,
} from '@platform/data'
import { describe, useLoad, useSession } from '../../session.tsx'
import { Page } from '../../shell/page.tsx'
import { useWorkspace } from '../../workspace/view.ts'
import { WorkspaceSelect } from '../../shell/workspace-select.tsx'
import { href } from '../../url.ts'
import { Empty, Loading, Notice } from '../../ui/bits.tsx'
import { Action } from '../../ui/button.tsx'
import { KeyIcon, PlusIcon } from '../../ui/icons.tsx'
import { GrantDrawer } from '../grants/drawer.tsx'
import type { GrantTarget } from '../grants/target.tsx'
import { CollectionGrantsTable } from './collections.tsx'
import { WorkspaceGrants } from './grants.tsx'

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
  const roles: RoleInfo[] = found.data?.roles ?? []
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
              <CollectionGrantsTable
                ws={ws}
                tables={tables}
                all={all}
                roles={roles}
                policies={policies.data ?? []}
                catalog={catalog}
                onGrant={(target) => setGranting(target)}
              />
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
