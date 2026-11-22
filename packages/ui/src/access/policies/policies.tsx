import { useState } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import { policies as readPolicies, roles as readRoles, tablesIn } from '@platform/data'
import { describe, useLoad, useSession } from '../../session.tsx'
import { Page } from '../../shell/page.tsx'
import { useWorkspace } from '../../workspace/view.ts'
import { WorkspaceSelect } from '../../shell/workspace-select.tsx'
import { href } from '../../url.ts'
import { Empty, Loading, Notice } from '../../ui/bits.tsx'
import { Action } from '../../ui/button.tsx'
import { PolicyIcon } from '../../ui/icons.tsx'
import { CollectionPolicies } from '../collections/policies.tsx'
import { PolicyDrawer, type PolicyTarget } from './drawer.tsx'

/** The row policies of the workspace in view, collection by collection. */
export function Policies() {
  const { catalog } = useSession()
  const location = useLocation()
  const ws = useWorkspace()
  const only = location.query.c
  const found = useLoad((db) => readPolicies(db), [catalog])
  const roles = useLoad((db) => readRoles(db), [])
  const [creating, setCreating] = useState<PolicyTarget | null>(null)
  const all = tablesIn(catalog, ws)
  const owned = all.filter((t) => t.can_alter && t.kind !== 'v')
  const tables = all.filter((t) => !only || t.name === only)
  const list = (found.data ?? []).filter((p) => p.schema === ws)
  return (
    <Page
      title="Row policies"
      icon={<PolicyIcon size={22} />}
      crumbs={[{ label: 'Access', href: href('/access') }]}
      subtitle="Which rows each role reaches. A grant says what a role may do with a collection; a policy says to which of its rows."
      actions={
        owned.length ? (
          <Action
            label="New policy"
            icon={<PolicyIcon size={22} />}
            onClick={() =>
              setCreating({ table: owned.find((t) => t.name === only)?.name ?? owned[0]!.name })
            }
          />
        ) : undefined
      }
      toolbar={
        <>
          <WorkspaceSelect path="/access/policies" />
          {only && (
            <a class="chip" href={href('/access/policies', { ws })}>
              Collection <span class="mono">{only}</span> · show every collection
            </a>
          )}
        </>
      }
    >
      {found.error ? (
        <Notice tone="danger" title={describe(found.error).title} />
      ) : !found.data ? (
        <Loading />
      ) : (
        tables.map((t) => (
          <CollectionPolicies
            key={t.name}
            schema={ws}
            table={t}
            policies={list.filter((p) => p.table === t.name)}
            roles={roles.data?.roles ?? []}
            heading={
              <a class="mono" href={href('/model/collection', { ws, c: t.name, tab: 'access' })}>
                {t.name}
              </a>
            }
            onDone={found.reload}
          />
        ))
      )}
      {found.data && !tables.length && (
        <Empty icon={<PolicyIcon size={26} />} title="No collection here you may reach" />
      )}
      <PolicyDrawer
        schema={ws}
        target={creating}
        roles={roles.data?.roles ?? []}
        onClose={() => setCreating(null)}
        onDone={found.reload}
      />
    </Page>
  )
}
