import { tablesIn } from '@platform/core'
import { useState } from 'react'
import { AddButton } from '../bits/add.tsx'
import { PrivilegeLegend } from '../bits/marks.tsx'
import { Page, Problem, Section } from '../bits/page.tsx'
import { useSession } from '../session/context.ts'
import { usePlace } from '../session/hooks.ts'
import { useNames } from '../shell/names.ts'
import { GrantEditor } from './grant.tsx'
import { SchemaAccess } from './schema.tsx'
import { ReachTable } from './reach.tsx'
import { same, useGrants, useReach } from './shared.tsx'

/** The workspace's permissions: who may use it, and every grant on its collections. */
export function Grants() {
  const { catalog } = useSession()
  const place = usePlace()
  const names = useNames()
  const grants = useGrants(place.ws)
  const reached = useReach(place.ws)
  const [editing, setEditing] = useState<{ table: string; role?: string } | null>(null)
  const named = (row: { table: string; role: string }) =>
    (grants.data ?? []).some((g) => g.table === row.table && same(g.grantee, row.role))
  return (
    <Page title="Permissions" crumbs={['Access', names(place.ws).name]}>
      <SchemaAccess schema={place.ws} />
      <PrivilegeLegend />
      <Problem error={reached.error ?? grants.error} />
      {tablesIn(catalog, place.ws).map((t) => (
        <Section
          key={t.name}
          title={<span className="mono">{t.name}</span>}
          note={`Owned by ${t.owner}.`}
          actions={
            t.can_alter && (
              <AddButton onClick={() => setEditing({ table: t.name })}>Grant</AddButton>
            )
          }
        >
          <ReachTable
            rows={(reached.data ?? []).filter((r) => r.table === t.name && named(r))}
            by="role"
            grants={grants.data ?? []}
            edit={t.can_alter ? (row) => setEditing(row) : undefined}
          />
        </Section>
      ))}
      {editing && <GrantEditor schema={place.ws} {...editing} onClose={() => setEditing(null)} />}
    </Page>
  )
}
