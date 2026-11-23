import { Button, Group, Text } from '@mantine/core'
import { dropRoleStatement, type ReachInfo, reservedRole, tableOf } from '@platform/core'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Change } from '../bits/change.tsx'
import { Privilege, PrivilegeLegend } from '../bits/marks.tsx'
import { Empty, Page, Problem, Section, Tag } from '../bits/page.tsx'
import { useSession } from '../session/context.ts'
import { usePlace } from '../session/hooks.ts'
import { useNames } from '../shell/names.ts'
import { GrantEditor } from './grant.tsx'
import { Memberships } from './memberships.tsx'
import { ReachTable } from './reach.tsx'
import { attributes } from './roles.tsx'
import {
  holdsAny,
  same,
  useGrants,
  usePolicies,
  useReach,
  useRoles,
  useSchemaReach,
} from './shared.tsx'

/** One role: its memberships, what it may do in the workspace in view, the policies that apply to it. */
export function RoleDetail() {
  const { identity, catalog } = useSession()
  const place = usePlace()
  const names = useNames()
  const navigate = useNavigate()
  const name = place.params.get('r') ?? identity.username
  const found = useRoles()
  const grants = useGrants(place.ws)
  const reached = useReach(place.ws, { role: name })
  const usage = useSchemaReach(place.ws)
  const rules = usePolicies(place.ws)
  const [change, setChange] = useState<{
    title: string
    statements: string[]
    danger?: boolean
    leave?: boolean
  } | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const role = found.data?.roles.find((r) => r.name === name)
  const all = found.data?.roles ?? []
  const memberships = found.data?.memberships ?? []
  const me = all.find((r) => r.name === identity.username)
  const groups = memberships.filter((m) => m.member === name)
  const members = memberships.filter((m) => m.role === name)
  const through = [name, ...groups.map((g) => g.role), 'public']
  const admits = (group: string) => all.find((r) => r.name === group)?.admits
  const here = usage.data?.find((r) => same(r.role, name))
  // Where a right comes from: the role's own grants, or the groups it inherits from.
  const origin = (row: ReachInfo) => {
    const owner = tableOf(catalog, place.ws, row.table)?.owner
    const sources = [
      ...new Set((grants.data ?? []).filter((g) => g.table === row.table).map((g) => g.grantee)),
    ].filter((g) => through.some((t) => same(t, g)))
    return [
      ...(owner && through.includes(owner) ? [`owner${owner === name ? '' : ` (${owner})`}`] : []),
      ...sources.map((s) => (same(s, name) ? 'its own grants' : s)),
    ].join(', ')
  }
  const applying = (rules.data ?? []).filter((p) =>
    p.roles.some((r) => through.some((t) => same(t, r)))
  )
  if (found.isSuccess && !role)
    return (
      <Page title="Role">
        <Empty>There is no role {name} that you may see.</Empty>
      </Page>
    )
  return (
    <Page
      title={<span className="mono">{name}</span>}
      crumbs={['Access', role?.login ? 'User' : 'Group']}
      actions={role && attributes(role)}
    >
      <Memberships
        name={name}
        groups={groups}
        members={members}
        admits={admits}
        isGroup={!!role && !role.login}
        mayAdmit={!!role?.admits}
      />
      <Section
        title={`In ${names(place.ws).name}`}
        note="PostgreSQL's own answer for this role, so a right held through a group or as PUBLIC counts."
      >
        <Group gap="md" mb="sm">
          <Privilege name="USAGE" held={!!here?.usage} />
          <Privilege name="CREATE" held={!!here?.create} />
          <PrivilegeLegend />
        </Group>
        <Problem error={reached.error} />
        <ReachTable
          rows={(reached.data ?? []).filter(holdsAny)}
          by="table"
          grants={(grants.data ?? []).filter((g) => same(g.grantee, name))}
          origin={origin}
          edit={(row) => tableOf(catalog, place.ws, row.table)?.can_alter && setEditing(row.table)}
        />
      </Section>
      <Section
        title="Row policies"
        note="The ones that apply to it by name, through a group, or as PUBLIC."
      >
        {!applying.length && <Empty>No policy you may see applies to this role.</Empty>}
        {applying.map((p) => (
          <Text key={p.table + p.name} fz="sm" mb={4}>
            <span className="mono">
              {p.table}.{p.name}
            </span>{' '}
            <Tag color="blue">{p.command}</Tag>{' '}
            <Text span className="mono" c="blue.9">
              {p.using ?? p.check}
            </Text>
          </Text>
        ))}
      </Section>
      {(me?.create_role || me?.superuser) && name !== identity.username && !reservedRole(name) && (
        <Section
          title="Remove the role"
          note="PostgreSQL refuses while the role still owns or is granted something."
        >
          <Button
            color="red"
            variant="light"
            onClick={() =>
              setChange({
                title: `Drop ${name}`,
                danger: true,
                leave: true,
                statements: [dropRoleStatement(name)],
              })
            }
          >
            Drop {name}
          </Button>
        </Section>
      )}
      {change && (
        <Change
          title={change.title}
          opened
          danger={change.danger}
          onClose={() => setChange(null)}
          done={() => change.leave && navigate(place.to('/access'))}
          statements={() => change.statements}
        />
      )}
      {editing && (
        <GrantEditor
          schema={place.ws}
          table={editing}
          role={name}
          onClose={() => setEditing(null)}
        />
      )}
    </Page>
  )
}
