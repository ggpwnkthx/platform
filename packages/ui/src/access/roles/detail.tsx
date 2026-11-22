import { useState } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import {
  type MembershipInfo,
  grants as readGrants,
  policies as readPolicies,
  reach as readReach,
  roles as readRoles,
  schemaGrants,
  schemaReach,
  tablesIn,
} from '@platform/data'
import { membershipStatement } from '@platform/vocabulary'
import { describe, useLoad, useSession } from '../../session.tsx'
import { Page } from '../../shell/page.tsx'
import { useWorkspaceView } from '../../workspace/view.ts'
import { WorkspaceSelect } from '../../shell/workspace-select.tsx'
import { Empty, Loading, Notice } from '../../ui/bits.tsx'
import { GroupIcon, KeyIcon, UserIcon } from '../../ui/icons.tsx'
import { GrantDrawer } from '../grants/drawer.tsx'
import type { GrantTarget } from '../grants/target.tsx'
import { MembershipDrawer } from './membership.tsx'
import { groupsOf, reaches } from '../model.ts'
import { isSystemRole } from '../names.ts'
import { policyReaches } from '../policies/draft.ts'
import { AppliedPolicies } from './policies.tsx'
import { ReachTable, WorkspaceRights } from './reach.tsx'
import { RemoveMembership } from './removal.tsx'
import { MembershipPanels } from './panels.tsx'
import { RunnerProblem, useRunner } from '../runner.tsx'
import { SchemaGrantDrawer } from '../grants/schema.tsx'

/** One role: what it belongs to, what it may do in the workspace in view, and its policies. */
export function RoleDetail() {
  const { identity } = useSession()
  const location = useLocation()
  const name = location.query.r ?? ''
  const { ws, schema, catalog } = useWorkspaceView()
  const found = useLoad((db) => readRoles(db), [name, catalog])
  const grants = useLoad(ws ? (db) => readGrants(db, ws) : null, [ws, catalog])
  const reach = useLoad(ws && name ? (db) => readReach(db, ws, { role: name }) : null, [
    ws,
    name,
    catalog,
  ])
  const onSchema = useLoad(ws ? (db) => schemaReach(db, ws) : null, [ws, catalog])
  const schemaAcl = useLoad(ws ? (db) => schemaGrants(db, ws) : null, [ws, catalog])
  const policies = useLoad((db) => readPolicies(db), [catalog])
  const runner = useRunner()
  const [adding, setAdding] = useState<'member' | 'group' | null>(null)
  const [removing, setRemoving] = useState<MembershipInfo | null>(null)
  const [granting, setGranting] = useState<GrantTarget | null>(null)
  const [usage, setUsage] = useState<{ grantee?: string } | null>(null)
  const all = found.data?.roles ?? []
  const role = all.find((r) => r.name === name)
  const memberships = found.data?.memberships ?? []
  const memberOf = memberships.filter((m) => m.member === name)
  const members = memberships.filter((m) => m.role === name)
  const groups = groupsOf(name, memberships)
  const tables = tablesIn(catalog, ws)
  const acl = grants.data ?? []
  const answers = reach.data ?? []
  const workspace = onSchema.data?.find((row) => row.role === name)
  const applying = (policies.data ?? []).filter((p) => policyReaches(p, name, groups))
  if (found.data && !role)
    return (
      <Page
        title={name}
        icon={<GroupIcon size={22} />}
        crumbs={[{ label: 'Access', href: '/access' }]}
      >
        <Notice tone="warning" title={`The database shows you no role named ${name}`}>
          You see the roles you are a member of; an operator sees them all.
        </Notice>
      </Page>
    )
  const candidates = all.filter((r) => !isSystemRole(r.name) && r.name !== name)
  const reload = () => {
    grants.reload()
    reach.reload()
    onSchema.reload()
    schemaAcl.reload()
  }
  const holdsHere = answers.some(reaches)
  const removal = removing
    ? membershipStatement({ role: removing.role, member: removing.member, admin: false }, true)
    : ''
  return (
    <Page
      title={<span class="mono">{name}</span>}
      icon={role?.login ? <UserIcon size={22} /> : <GroupIcon size={22} />}
      crumbs={[{ label: 'Roles', href: '/access' }]}
      subtitle={
        role
          ? `${role.login ? 'A user: logs in with a token.' : 'A group: others belong to it, and hold what it is granted.'}${role.admits && !role.login ? ' You may admit members to it.' : ''}`
          : undefined
      }
    >
      <RunnerProblem runner={runner} />
      {role?.superuser && (
        <Notice tone="warning" title={`${name} is a superuser`}>
          The database checks no privilege and no row policy for it: what is drawn below is not what
          holds it back.
        </Notice>
      )}
      <MembershipPanels
        name={name}
        memberOf={memberOf}
        members={members}
        all={all}
        admits={Boolean(role?.admits)}
        isLogin={Boolean(role?.login)}
        isOperator={Boolean(identity?.is_operator)}
        onAddGroup={() => setAdding('group')}
        onAddMember={() => setAdding('member')}
        onRemove={setRemoving}
      />
      <section class="section">
        <header class="section-head">
          <div>
            <h2>
              What it may do in <span class="mono">{ws}</span>
            </h2>
            <p>
              The database’s own answer for {name}: what it holds itself, through the groups it
              inherits from, and as PUBLIC. The last column says where each comes from.
            </p>
          </div>
          <WorkspaceSelect path="/access/role" place={{ r: name }} />
        </header>
        <WorkspaceRights
          ws={ws}
          name={name}
          workspace={workspace}
          mayAlter={Boolean(schema?.can_alter && schema.owner !== name)}
          holdsHere={holdsHere}
          onChange={() => setUsage({ grantee: name })}
        />
        {grants.error || reach.error ? (
          <Notice tone="danger" title={describe(grants.error ?? reach.error).title} />
        ) : !grants.data || !reach.data ? (
          <Loading />
        ) : tables.length ? (
          <ReachTable
            ws={ws}
            name={name}
            tables={tables}
            acl={acl}
            answers={answers}
            memberships={memberships}
            catalog={catalog}
            onGrant={(table) => setGranting({ table, grantee: name })}
          />
        ) : (
          <Empty icon={<KeyIcon size={24} />} title="No collection here you may reach" />
        )}
      </section>
      <AppliedPolicies policies={applying} name={name} />
      <MembershipDrawer
        adding={adding}
        name={name}
        candidates={candidates}
        onClose={() => setAdding(null)}
        onDone={found.reload}
      />
      <RemoveMembership
        removing={removing}
        statement={removal}
        runner={runner}
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (removing && (await runner.runStatements([removal], 'Membership revoked'))) {
            setRemoving(null)
            found.reload()
          }
        }}
      />
      <GrantDrawer
        schema={ws}
        target={granting}
        grants={acl}
        roles={all}
        memberships={memberships}
        onClose={() => setGranting(null)}
        onDone={reload}
      />
      <SchemaGrantDrawer
        schema={ws}
        target={usage}
        grants={schemaAcl.data ?? []}
        roles={all}
        onClose={() => setUsage(null)}
        onDone={reload}
      />
    </Page>
  )
}
