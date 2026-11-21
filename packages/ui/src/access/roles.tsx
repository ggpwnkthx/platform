import { useState } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import {
  type Catalog,
  type GrantInfo,
  type MembershipInfo,
  type ReachInfo,
  type RoleInfo,
  type TableInfo,
  columnsOf,
  grants as readGrants,
  policies as readPolicies,
  reach as readReach,
  roles as readRoles,
  schemaGrants,
  schemaReach,
  tablesIn,
} from '@platform/data'
import { createRoleStatements, membershipStatement, schemaPrivileges } from '@platform/vocabulary'
import { describe, useLoad, useSession } from '../session.tsx'
import { Page, useWorkspaceView, WorkspaceSelect } from '../shell.tsx'
import { href } from '../url.ts'
import { Badge, Empty, Loading, Notice, Statement } from '../ui/bits.tsx'
import { Action, Button } from '../ui/button.tsx'
import { Checkbox, Field, Input, Select, Toggle } from '../ui/form.tsx'
import {
  AccessIcon,
  AddMemberIcon,
  EditIcon,
  GrantIcon,
  GroupIcon,
  KeyIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
  UserIcon,
} from '../ui/icons.tsx'
import { Confirm, Drawer } from '../ui/overlay.tsx'
import { HoldCell, PrivilegeHeads } from './collection-access.tsx'
import {
  GrantDrawer,
  type GrantTarget,
  SchemaGrantDrawer,
  useLast,
  useOpening,
} from './grant-editor.tsx'
import {
  drawn,
  groupsOf,
  heldBy,
  heldOf,
  holdsAny,
  others,
  reaches,
  reachOf,
  throughOf,
} from './model.ts'
import { policyReaches } from './policy.ts'
import { PolicyCard } from './policies.tsx'
import { Legend, Mark, RoleLabel } from './rights.tsx'
import { useRunner } from './runner.tsx'

const isSystemRole = (name: string) => name.startsWith('pg_')

/** What a role's attributes let it do past every grant, said where the role is drawn. */
function Attributes({ role }: { role: RoleInfo }) {
  return (
    <>
      {role.superuser && (
        <Badge tone="danger" title="The database checks no privilege and no row policy for it">
          superuser
        </Badge>
      )}
      {role.bypass_rls && (
        <Badge tone="danger" title="Row policies do not filter what it reaches">
          bypass RLS
        </Badge>
      )}
      {role.create_role && (
        <Badge tone="warning" title="It may make roles, and admit members to the ones it made">
          create role
        </Badge>
      )}
      {!role.inherit && (
        <Badge title="It holds its groups’ rights only after SET ROLE">no inherit</Badge>
      )}
    </>
  )
}

/** The form a new role is made with, and the groups it joins as it is made. */
function NewRole({
  open,
  roles,
  onClose,
  onDone,
}: {
  open: boolean
  roles: RoleInfo[]
  onClose: () => void
  onDone: (name: string) => void
}) {
  const runner = useRunner()
  const [draft, setDraft] = useState({ name: '', login: true })
  const [groups, setGroups] = useState<string[]>([])
  // The groups the reader may admit a new role to.
  const joinable = roles.filter(
    (r) => !r.login && r.admits && !isSystemRole(r.name) && !r.name.startsWith('platform_')
  )
  let statements: string[] = []
  let invalid: string | null = null
  try {
    statements = draft.name.trim()
      ? [
          ...createRoleStatements(draft),
          ...groups.map((group) =>
            membershipStatement({ role: group, member: draft.name.trim(), admin: false })
          ),
        ]
      : []
  } catch (error) {
    invalid = error instanceof Error ? error.message : String(error)
  }
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="New role"
      subtitle="A user is a role that logs in; a group is one that others belong to."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            tone="primary"
            busy={runner.busy}
            disabled={!statements.length || !!invalid}
            onClick={async () => {
              if (await runner.runStatements(statements, `Created ${draft.name.trim()}`))
                onDone(draft.name.trim())
            }}
          >
            Create role
          </Button>
        </>
      }
    >
      {runner.problem && (
        <Notice tone="danger" title={runner.problem.title}>
          {runner.problem.detail}
        </Notice>
      )}
      <div class="form">
        <div class="field field-wide">
          <Toggle
            checked={draft.login}
            onChange={(login) => setDraft({ ...draft, login })}
            label={draft.login ? 'A user: logs in with a token' : 'A group: does not log in'}
          />
        </div>
        <Field
          label="Name"
          id="role-name"
          wide
          required
          error={invalid}
          hint={
            draft.login
              ? 'For a person: the email their sign-in reports. The database logs them in by it.'
              : 'For a group: what its members do, such as newsroom_editor.'
          }
        >
          <Input
            id="role-name"
            mono
            value={draft.name}
            onInput={(e) => setDraft({ ...draft, name: e.currentTarget.value })}
            placeholder={draft.login ? 'carol@example.com' : 'newsroom_editor'}
          />
        </Field>
        {joinable.length > 0 && (
          <fieldset class="field field-wide">
            <legend class="field-label">Member of</legend>
            <p class="field-hint">
              The groups it joins as it is made. A role holds nothing of its own until it is
              granted: its groups are where its rights come from.
            </p>
            <div class="checks checks-columns">
              {joinable.map((group) => (
                <Checkbox
                  key={group.name}
                  label={<span class="mono">{group.name}</span>}
                  checked={groups.includes(group.name)}
                  onChange={(on) =>
                    setGroups(on ? [...groups, group.name] : groups.filter((g) => g !== group.name))
                  }
                />
              ))}
            </div>
          </fieldset>
        )}
      </div>
      {statements.length > 0 && (
        <Statement sql={statements.join('\n')} label="Runs as you, in one transaction" />
      )}
    </Drawer>
  )
}

type Kind = 'all' | 'users' | 'groups'

/** The roles the reader may see: the people who log in, and the groups they belong to. */
export function Roles() {
  const { identity } = useSession()
  const location = useLocation()
  const found = useLoad((db) => readRoles(db), [])
  const [showSystem, setShowSystem] = useState(false)
  const [kind, setKind] = useState<Kind>('all')
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const opening = useOpening(creating)
  const all = found.data?.roles ?? []
  const memberships = found.data?.memberships ?? []
  const roles = all.filter(
    (r) =>
      (showSystem || !isSystemRole(r.name)) &&
      (kind === 'all' || (kind === 'users') === r.login) &&
      r.name.toLowerCase().includes(search.trim().toLowerCase())
  )
  const mayCreate =
    identity?.is_operator || all.find((r) => r.name === identity?.username)?.create_role
  return (
    <Page
      title="Roles"
      icon={<AccessIcon size={22} />}
      crumbs={[{ label: 'Access' }]}
      subtitle={
        identity?.is_operator
          ? 'Every role in the cluster: you are an operator. A user logs in; a group is what users belong to and what is granted.'
          : 'The roles you are, and the groups you belong to. The database shows you no others.'
      }
      actions={
        mayCreate ? (
          <Action
            label="New role"
            icon={<PlusIcon size={22} />}
            onClick={() => setCreating(true)}
          />
        ) : undefined
      }
      toolbar={
        <>
          <label class="search">
            <SearchIcon size={16} aria-hidden="true" />
            <span class="sr-only">Search roles</span>
            <input
              type="search"
              value={search}
              onInput={(e) => setSearch(e.currentTarget.value)}
              placeholder="Search roles"
            />
          </label>
          <label class="inline-select" for="roles-kind">
            <span>Show</span>
            <Select
              id="roles-kind"
              value={kind}
              onChange={(e) => setKind(e.currentTarget.value as Kind)}
            >
              <option value="all">Users and groups</option>
              <option value="users">Users</option>
              <option value="groups">Groups</option>
            </Select>
          </label>
          <Checkbox
            checked={showSystem}
            onChange={setShowSystem}
            label="The database’s built-in roles"
          />
        </>
      }
    >
      {found.error ? (
        <Notice tone="danger" title={describe(found.error).title} />
      ) : !found.data ? (
        <Loading />
      ) : roles.length ? (
        <div class="grid-wrap">
          <table class="grid">
            <thead>
              <tr>
                <th>Role</th>
                <th>Member of</th>
                <th>Members</th>
                <th>Attributes</th>
              </tr>
            </thead>
            <tbody>
              {roles.map((role) => {
                const memberOf = memberships.filter((m) => m.member === role.name)
                const members = memberships.filter((m) => m.role === role.name)
                return (
                  <tr key={role.name}>
                    <td>
                      <span class="strong">
                        <RoleLabel name={role.name} roles={all} />
                      </span>
                      {role.name === identity?.username && <Badge tone="primary">you</Badge>}
                    </td>
                    <td>
                      {memberOf.length ? (
                        <span class="who">
                          {memberOf.map((m) => (
                            <a
                              key={m.role}
                              class="who-role"
                              href={href('/access/role', { r: m.role })}
                              title={m.admin_option ? `${m.role}, with admin option` : m.role}
                            >
                              {m.role}
                            </a>
                          ))}
                        </span>
                      ) : (
                        <span class="cell-muted">—</span>
                      )}
                    </td>
                    <td>
                      {role.login ? (
                        <span class="cell-muted">—</span>
                      ) : (
                        <span
                          class="mono"
                          title={members.map((m) => m.member).join(', ') || undefined}
                        >
                          {members.length}
                        </span>
                      )}
                      {role.admits && !role.login && (
                        <Badge tone="outline" title="You may admit members to it and remove them">
                          you admit
                        </Badge>
                      )}
                    </td>
                    <td>
                      <Attributes role={role} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty icon={<GroupIcon size={26} />} title="No role matches">
          Nothing the database shows you is named like that.
        </Empty>
      )}
      <NewRole
        key={opening}
        open={creating}
        roles={all}
        onClose={() => setCreating(false)}
        onDone={(name) => {
          setCreating(false)
          location.route(href('/access/role', { r: name }))
        }}
      />
    </Page>
  )
}

/** Adds a membership: a member to this group, or this role to a group. */
function MembershipDrawer({
  adding,
  name,
  candidates,
  onClose,
  onDone,
}: {
  adding: 'member' | 'group' | null
  name: string
  candidates: RoleInfo[]
  onClose: () => void
  onDone: () => void
}) {
  const opening = useOpening(adding !== null)
  const last = useLast(adding)
  return (
    <MembershipEditor
      key={opening}
      open={adding !== null}
      adding={last ?? 'group'}
      name={name}
      candidates={candidates}
      onClose={onClose}
      onDone={onDone}
    />
  )
}

function MembershipEditor({
  open,
  adding,
  name,
  candidates,
  onClose,
  onDone,
}: {
  open: boolean
  adding: 'member' | 'group'
  name: string
  candidates: RoleInfo[]
  onClose: () => void
  onDone: () => void
}) {
  const runner = useRunner()
  const [other, setOther] = useState('')
  const [admin, setAdmin] = useState(false)
  let statement = ''
  try {
    statement = other
      ? membershipStatement(
          adding === 'member'
            ? { role: name, member: other, admin }
            : { role: other, member: name, admin }
        )
      : ''
  } catch {
    statement = ''
  }
  const offered = candidates.filter((r) => (adding === 'group' ? !r.login && r.admits : true))
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={
        adding === 'member' ? (
          <>
            Add a member to <span class="mono">{name}</span>
          </>
        ) : (
          <>
            Add <span class="mono">{name}</span> to a group
          </>
        )
      }
      subtitle={
        adding === 'member'
          ? 'The member holds everything granted to this group, in every workspace.'
          : 'It will hold everything granted to the group, in every workspace.'
      }
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            tone="primary"
            busy={runner.busy}
            disabled={!statement}
            onClick={async () => {
              if (await runner.runStatements([statement], 'Membership granted')) {
                onDone()
                onClose()
              }
            }}
          >
            Grant membership
          </Button>
        </>
      }
    >
      {runner.problem && (
        <Notice tone="danger" title={runner.problem.title}>
          {runner.problem.detail}
        </Notice>
      )}
      <div class="form">
        <Field
          label={adding === 'member' ? 'Member' : 'Group'}
          id="mem-other"
          wide
          required
          hint={
            adding === 'group' && !offered.length
              ? 'There is no group you may admit members to.'
              : undefined
          }
        >
          <Select id="mem-other" value={other} onChange={(e) => setOther(e.currentTarget.value)}>
            <option value="">Choose a role</option>
            {offered.map((r) => (
              <option key={r.name} value={r.name}>
                {r.name}
                {adding === 'member' && !r.login ? ' (group)' : ''}
              </option>
            ))}
          </Select>
        </Field>
        <div class="field field-wide">
          <Checkbox
            checked={admin}
            onChange={setAdmin}
            label="With admin option"
            hint="They may admit others in turn, and remove them."
          />
        </div>
      </div>
      {statement && <Statement sql={statement} />}
    </Drawer>
  )
}

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

/** The groups a role belongs to: the rights it holds through them. */
function MemberOfPanel({
  name,
  memberOf,
  all,
  onAdd,
  onRemove,
}: {
  name: string
  memberOf: MembershipInfo[]
  all: RoleInfo[]
  onAdd: () => void
  onRemove: (membership: MembershipInfo) => void
}) {
  return (
    <section class="panel">
      <header class="panel-head">
        <div>
          <h2>Member of</h2>
          <p>The groups whose rights {name} holds.</p>
        </div>
        <Button small icon={<PlusIcon size={14} />} onClick={onAdd}>
          Add to a group
        </Button>
      </header>
      {memberOf.length ? (
        <ul class="members">
          {memberOf.map((m) => (
            <li key={m.role}>
              <RoleLabel name={m.role} roles={all} />
              {m.admin_option && <Badge tone="warning">admin</Badge>}
              {!m.inherit_option && <Badge>no inherit</Badge>}
              <button
                type="button"
                class="icon-button"
                aria-label={`Remove ${name} from ${m.role}`}
                title="Remove from the group"
                onClick={() => onRemove(m)}
              >
                <TrashIcon size={15} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p class="panel-note">No group you may see.</p>
      )}
    </section>
  )
}

/** The roles that belong to a role: the members of a group. */
function MembersPanel({
  name,
  members,
  all,
  admits,
  isLogin,
  isOperator,
  onAdd,
  onRemove,
}: {
  name: string
  members: MembershipInfo[]
  all: RoleInfo[]
  /** Whether the role may admit others to itself. */
  admits: boolean
  /** Whether the role is a person: a user has no members. */
  isLogin: boolean
  isOperator: boolean
  onAdd: () => void
  onRemove: (membership: MembershipInfo) => void
}) {
  return (
    <section class="panel">
      <header class="panel-head">
        <div>
          <h2>Members</h2>
          <p>The roles that hold {name}’s rights.</p>
        </div>
        {admits && !isLogin && (
          <Button small icon={<AddMemberIcon size={14} />} onClick={onAdd}>
            Add member
          </Button>
        )}
      </header>
      {members.length ? (
        <ul class="members">
          {members.map((m) => (
            <li key={m.member}>
              <RoleLabel name={m.member} roles={all} />
              {m.admin_option && <Badge tone="warning">admin</Badge>}
              {admits && (
                <button
                  type="button"
                  class="icon-button"
                  aria-label={`Remove ${m.member}`}
                  title="Remove from the group"
                  onClick={() => onRemove(m)}
                >
                  <TrashIcon size={15} />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p class="panel-note">
          {isLogin
            ? 'A user has no members.'
            : isOperator
              ? 'Nobody belongs to it.'
              : 'No member you may see: the database shows you your own memberships.'}
        </p>
      )}
    </section>
  )
}

/** What the role holds on the workspace itself: its usage, and its right to create. */
function WorkspaceRights({
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
function ReachTable({
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
      {runner.problem && (
        <Notice tone="danger" title={runner.problem.title}>
          {runner.problem.detail}
        </Notice>
      )}
      {role?.superuser && (
        <Notice tone="warning" title={`${name} is a superuser`}>
          The database checks no privilege and no row policy for it: what is drawn below is not what
          holds it back.
        </Notice>
      )}
      <div class="split">
        <MemberOfPanel
          name={name}
          memberOf={memberOf}
          all={all}
          onAdd={() => setAdding('group')}
          onRemove={setRemoving}
        />
        <MembersPanel
          name={name}
          members={members}
          all={all}
          admits={Boolean(role?.admits)}
          isLogin={Boolean(role?.login)}
          isOperator={Boolean(identity?.is_operator)}
          onAdd={() => setAdding('member')}
          onRemove={setRemoving}
        />
      </div>
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
      <section class="section">
        <header class="section-head">
          <div>
            <h2>Row policies that apply to it</h2>
            <p>
              By its name, through a group it inherits from, or as PUBLIC, in every workspace you
              may see. Where row security is on, these decide which rows {name} reaches.
            </p>
          </div>
        </header>
        {applying.length ? (
          <ul class="policies">
            {applying.map((p) => (
              <PolicyCard key={`${p.schema}.${p.table}.${p.name}`} policy={p} place />
            ))}
          </ul>
        ) : (
          <p class="panel-note">No policy you may see applies to this role.</p>
        )}
      </section>
      <MembershipDrawer
        adding={adding}
        name={name}
        candidates={candidates}
        onClose={() => setAdding(null)}
        onDone={found.reload}
      />
      <Confirm
        open={removing !== null}
        title="Remove this membership?"
        confirm="Revoke"
        busy={runner.busy}
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (removing && (await runner.runStatements([removal], 'Membership revoked'))) {
            setRemoving(null)
            found.reload()
          }
        }}
      >
        {removing && (
          <>
            <p>
              {removing.member} stops holding what {removing.role} is granted, in every workspace,
              from its next statement.
            </p>
            <Statement sql={removal} />
          </>
        )}
      </Confirm>
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
