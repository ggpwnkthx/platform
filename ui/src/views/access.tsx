import clsx from 'clsx'
import { useState } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import {
  columnPrivileges,
  createRoleStatements,
  dropPolicyStatement,
  type GrantDraft,
  grantStatement,
  membershipStatement,
  type PolicyCommand,
  type PolicyDraft,
  policyStatement,
  tablePrivileges,
} from '../db/model.ts'
import {
  grants as readGrants,
  policies as readPolicies,
  roles as readRoles,
} from '../db/platform.ts'
import type { GrantInfo, RoleInfo } from '../db/types.ts'
import { describe, useLoad, useSession } from '../session.tsx'
import { Page, useWorkspace, WorkspaceSelect } from '../shell.tsx'
import { columnsOf, tableOf, tablesIn } from '../state/catalog.ts'
import { href } from '../state/url.ts'
import { Badge, Empty, Loading, Notice, Statement } from '../ui/bits.tsx'
import { Action, Button } from '../ui/button.tsx'
import { Checkbox, Field, Input, Select, TextArea, Toggle } from '../ui/form.tsx'
import {
  AccessIcon,
  AddMemberIcon,
  CheckIcon,
  GroupIcon,
  KeyIcon,
  PlusIcon,
  PolicyIcon,
  TrashIcon,
  UserIcon,
} from '../ui/icons.tsx'
import { Confirm, Drawer } from '../ui/overlay.tsx'
import { Legend } from './rights.tsx'
import { useRunner } from './runner.tsx'

const isSystemRole = (name: string) => name.startsWith('pg_')

function RoleName({ role }: { role: Pick<RoleInfo, 'name' | 'login'> }) {
  const Icon = role.login ? UserIcon : GroupIcon
  return (
    <a class="grid-open strong" href={href('/access/role', { r: role.name })}>
      <Icon size={16} aria-hidden="true" />
      <span class="mono">{role.name}</span>
    </a>
  )
}

export function Roles() {
  const { identity } = useSession()
  const found = useLoad((db) => readRoles(db), [])
  const runner = useRunner()
  const [showSystem, setShowSystem] = useState(false)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState({ name: '', login: true })
  const roles = (found.data?.roles ?? []).filter((r) => showSystem || !isSystemRole(r.name))
  const memberships = found.data?.memberships ?? []
  const mayCreate =
    identity?.is_operator ||
    found.data?.roles.find((r) => r.name === identity?.username)?.create_role
  let statements: string[] = []
  let invalid: string | null = null
  try {
    statements = draft.name ? createRoleStatements(draft) : []
  } catch (error) {
    invalid = error instanceof Error ? error.message : String(error)
  }
  return (
    <Page
      title="Roles"
      icon={<AccessIcon size={22} />}
      crumbs={[{ label: 'Access' }]}
      subtitle={
        identity?.is_operator
          ? 'Every role in the cluster: you are an operator.'
          : 'The roles you are, and the groups you belong to. PostgreSQL shows you no others.'
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
        <Checkbox
          checked={showSystem}
          onChange={setShowSystem}
          label="PostgreSQL's built-in roles"
        />
      }
    >
      {found.error ? (
        <Notice tone="danger" title={describe(found.error).title} />
      ) : !found.data ? (
        <Loading />
      ) : (
        <div class="grid-wrap">
          <table class="grid">
            <thead>
              <tr>
                <th>Role</th>
                <th>Kind</th>
                <th>Member of</th>
                <th>Members</th>
                <th>Attributes</th>
                <th>You may admit others</th>
              </tr>
            </thead>
            <tbody>
              {roles.map((role) => {
                const memberOf = memberships
                  .filter((m) => m.member === role.name)
                  .map((m) => m.role)
                const members = memberships.filter((m) => m.role === role.name)
                return (
                  <tr key={role.name}>
                    <td>
                      <RoleName role={role} />
                      {role.name === identity?.username && <Badge tone="primary">you</Badge>}
                    </td>
                    <td>{role.login ? 'User' : 'Group'}</td>
                    <td class="cell-muted mono">
                      <span class="clip" title={memberOf.join(', ') || undefined}>
                        {memberOf.join(', ') || '—'}
                      </span>
                    </td>
                    <td class="is-number mono">{members.length || ''}</td>
                    <td>
                      {role.superuser && <Badge tone="danger">superuser</Badge>}
                      {role.create_role && <Badge tone="warning">create role</Badge>}
                      {role.bypass_rls && <Badge tone="danger">bypass RLS</Badge>}
                      {!role.inherit && <Badge>no inherit</Badge>}
                    </td>
                    <td>{role.admits ? <CheckIcon size={16} aria-label="yes" /> : ''}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <Drawer
        open={creating}
        onClose={() => setCreating(false)}
        title="New role"
        subtitle="A user is a role that logs in; a group is one that others belong to."
        footer={
          <>
            <Button onClick={() => setCreating(false)}>Cancel</Button>
            <Button
              tone="primary"
              busy={runner.busy}
              disabled={!draft.name || !!invalid}
              onClick={async () => {
                if (await runner.runStatements(statements, `Created ${draft.name}`)) {
                  setCreating(false)
                  found.reload()
                }
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
          <Field
            label="Name"
            id="role-name"
            wide
            required
            error={invalid}
            hint={
              draft.login
                ? 'For a person: the email their sign-in reports. PostgreSQL logs them in by it.'
                : 'For a group: what its members do, such as newsroom_writer.'
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
          <div class="field field-wide">
            <Toggle
              checked={draft.login}
              onChange={(login) => setDraft({ ...draft, login })}
              label={draft.login ? 'A user: logs in with a token' : 'A group: does not log in'}
            />
          </div>
        </div>
        {statements.length > 0 && <Statement sql={statements.join('\n')} />}
      </Drawer>
    </Page>
  )
}

type CellState = { whole: boolean; columns: string[]; grantable: boolean }

function grantCell(grants: GrantInfo[], table: string, privilege: string): CellState {
  const mine = grants.filter((g) => g.table === table && g.privilege === privilege)
  return {
    whole: mine.some((g) => g.column === null),
    columns: mine.filter((g) => g.column !== null).map((g) => g.column!),
    grantable: mine.some((g) => g.grantable),
  }
}

export function RoleDetail() {
  const { catalog, identity } = useSession()
  const location = useLocation()
  const name = location.query.r ?? ''
  const ws = useWorkspace()
  const found = useLoad((db) => readRoles(db), [name])
  const grants = useLoad(ws ? (db) => readGrants(db, ws) : null, [ws, catalog])
  const policies = useLoad((db) => readPolicies(db), [catalog])
  const runner = useRunner()
  const [adding, setAdding] = useState<'member' | 'group' | null>(null)
  const [other, setOther] = useState('')
  const [admin, setAdmin] = useState(false)
  const [removing, setRemoving] = useState<{ role: string; member: string } | null>(null)
  const [granting, setGranting] = useState<GrantDraft | null>(null)
  const [revoke, setRevoke] = useState(false)
  const role = found.data?.roles.find((r) => r.name === name)
  const memberships = found.data?.memberships ?? []
  const memberOf = memberships.filter((m) => m.member === name)
  const members = memberships.filter((m) => m.role === name)
  const tables = tablesIn(catalog, ws)
  const mine = (grants.data ?? []).filter((g) => g.grantee === name)
  const named = (policies.data ?? []).filter((p) => p.roles.includes(name))
  if (found.data && !role)
    return (
      <Page
        title={name}
        icon={<GroupIcon size={22} />}
        crumbs={[{ label: 'Access', href: '/access' }]}
      >
        <Notice tone="warning" title={`PostgreSQL shows you no role named ${name}`}>
          You see the roles you are a member of; an operator sees them all.
        </Notice>
      </Page>
    )
  let membership = ''
  try {
    membership = other
      ? membershipStatement(
          adding === 'member'
            ? { role: name, member: other, admin }
            : { role: other, member: name, admin }
        )
      : ''
  } catch {
    membership = ''
  }
  let grantSql = ''
  let grantProblem: string | null = null
  try {
    grantSql = granting ? grantStatement(granting, revoke) : ''
  } catch (error) {
    grantProblem = error instanceof Error ? error.message : String(error)
  }
  const candidates = (found.data?.roles ?? []).filter(
    (r) => !isSystemRole(r.name) && r.name !== name
  )
  return (
    <Page
      title={<span class="mono">{name}</span>}
      icon={role?.login ? <UserIcon size={22} /> : <GroupIcon size={22} />}
      crumbs={[
        { label: 'Access', href: '/access' },
        { label: 'Roles', href: '/access' },
      ]}
      subtitle={
        role
          ? `${role.login ? 'A user: logs in with a token.' : 'A group: others belong to it.'}${role.admits ? ' You may admit members to it.' : ''}`
          : undefined
      }
    >
      {runner.problem && (
        <Notice tone="danger" title={runner.problem.title}>
          {runner.problem.detail}
        </Notice>
      )}
      <div class="split">
        <section class="panel">
          <header class="panel-head">
            <div>
              <h2>Member of</h2>
              <p>Groups whose rights {name} holds.</p>
            </div>
            <Button
              small
              icon={<PlusIcon size={14} />}
              onClick={() => {
                setAdding('group')
                setOther('')
                setAdmin(false)
              }}
            >
              Add to a group
            </Button>
          </header>
          {memberOf.length ? (
            <ul class="members">
              {memberOf.map((m) => (
                <li key={m.role}>
                  <GroupIcon size={16} aria-hidden="true" />
                  <a class="mono" href={href('/access/role', { r: m.role })}>
                    {m.role}
                  </a>
                  {m.admin_option && <Badge tone="warning">admin</Badge>}
                  {!m.inherit_option && <Badge>no inherit</Badge>}
                  <button
                    type="button"
                    class="icon-button"
                    aria-label={`Remove ${name} from ${m.role}`}
                    onClick={() => setRemoving({ role: m.role, member: name })}
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
        <section class="panel">
          <header class="panel-head">
            <div>
              <h2>Members</h2>
              <p>Roles that hold {name}'s rights.</p>
            </div>
            {role?.admits && (
              <Button
                small
                icon={<AddMemberIcon size={14} />}
                onClick={() => {
                  setAdding('member')
                  setOther('')
                  setAdmin(false)
                }}
              >
                Add member
              </Button>
            )}
          </header>
          {members.length ? (
            <ul class="members">
              {members.map((m) => (
                <li key={m.member}>
                  <UserIcon size={16} aria-hidden="true" />
                  <a class="mono" href={href('/access/role', { r: m.member })}>
                    {m.member}
                  </a>
                  {m.admin_option && <Badge tone="warning">admin</Badge>}
                  {role?.admits && (
                    <button
                      type="button"
                      class="icon-button"
                      aria-label={`Remove ${m.member}`}
                      onClick={() => setRemoving({ role: name, member: m.member })}
                    >
                      <TrashIcon size={15} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p class="panel-note">
              {identity?.is_operator
                ? 'Nobody belongs to it.'
                : 'No member you may see: PostgreSQL shows you your own memberships.'}
            </p>
          )}
        </section>
      </div>
      <section class="section">
        <header class="section-head">
          <div>
            <h2>Permissions in {ws}</h2>
            <p>
              Grants made to {name} directly, read from each collection's ACL. Rights held through a
              group show on that group. Only a collection's owner may change them.
            </p>
          </div>
          <WorkspaceSelect path="/access/role" place={{ r: name }} />
        </header>
        {grants.error ? (
          <Notice tone="danger" title={describe(grants.error).title} />
        ) : !grants.data ? (
          <Loading />
        ) : tables.length ? (
          <div class="grid-wrap">
            <table class="grid matrix">
              <thead>
                <tr>
                  <th>Collection</th>
                  {tablePrivileges.slice(0, 5).map((p) => (
                    <th key={p} class="matrix-cell">
                      {p}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tables.map((t) => (
                  <tr key={t.name}>
                    <td class="mono strong">
                      {t.name}
                      {t.owner === name && <Badge tone="outline">owner</Badge>}
                    </td>
                    {tablePrivileges.slice(0, 5).map((p) => {
                      const cell = grantCell(mine, t.name, p)
                      const held = t.owner === name || cell.whole
                      const state = held ? 'all' : cell.columns.length ? 'some' : 'none'
                      const label =
                        t.owner === name
                          ? 'owner'
                          : cell.whole
                            ? 'granted'
                            : cell.columns.length
                              ? `${cell.columns.length} fields`
                              : 'not granted'
                      return (
                        <td key={p} class="matrix-cell">
                          <button
                            type="button"
                            class={clsx('perm', `perm-${state}`)}
                            disabled={!t.can_alter || t.owner === name}
                            title={`${p} on ${t.name}: ${label}${cell.columns.length ? ` (${cell.columns.join(', ')})` : ''}`}
                            onClick={() => {
                              setRevoke(state !== 'none')
                              setGranting({
                                schema: ws,
                                table: t.name,
                                privileges: [p],
                                columns: cell.columns,
                                grantee: name,
                                withGrantOption: false,
                              })
                            }}
                          >
                            <span class="perm-mark" aria-hidden="true" />
                            <span class="sr-only">{label}</span>
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <div class="grid-note">
              <Legend />
            </div>
          </div>
        ) : (
          <Empty icon={<KeyIcon size={24} />} title="No collection here you may reach" />
        )}
      </section>
      <section class="section">
        <header class="section-head">
          <div>
            <h2>Row policies naming {name}</h2>
            <p>Across the workspaces you may see.</p>
          </div>
        </header>
        {named.length ? (
          <ul class="policies">
            {named.map((p) => (
              <li key={`${p.schema}.${p.table}.${p.name}`} class="policy">
                <div class="policy-head">
                  <strong class="mono">{p.name}</strong>
                  <span class="mono side-muted">
                    {p.schema}.{p.table}
                  </span>
                  <Badge>{p.command}</Badge>
                </div>
                {p.using && <code class="policy-expr">USING {p.using}</code>}
                {p.check && <code class="policy-expr">WITH CHECK {p.check}</code>}
              </li>
            ))}
          </ul>
        ) : (
          <p class="panel-note">No policy names this role.</p>
        )}
      </section>
      <Drawer
        open={adding !== null}
        onClose={() => setAdding(null)}
        title={adding === 'member' ? `Add a member to ${name}` : `Add ${name} to a group`}
        footer={
          <>
            <Button onClick={() => setAdding(null)}>Cancel</Button>
            <Button
              tone="primary"
              busy={runner.busy}
              disabled={!membership}
              onClick={async () => {
                if (await runner.runStatements([membership], 'Membership granted')) {
                  setAdding(null)
                  found.reload()
                }
              }}
            >
              Grant membership
            </Button>
          </>
        }
      >
        <div class="form">
          <Field label={adding === 'member' ? 'Member' : 'Group'} id="mem-other" wide required>
            <Select id="mem-other" value={other} onChange={(e) => setOther(e.currentTarget.value)}>
              <option value="">Choose a role</option>
              {candidates
                .filter((r) => (adding === 'group' ? !r.login && r.admits : true))
                .map((r) => (
                  <option key={r.name} value={r.name}>
                    {r.name}
                  </option>
                ))}
            </Select>
          </Field>
          <div class="field field-wide">
            <Checkbox
              checked={admin}
              onChange={setAdmin}
              label="With admin option"
              hint="They may admit others in turn."
            />
          </div>
        </div>
        {membership && <Statement sql={membership} />}
      </Drawer>
      <Confirm
        open={removing !== null}
        title="Remove this membership?"
        confirm="Revoke"
        busy={runner.busy}
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return
          if (
            await runner.runStatements(
              [membershipStatement({ ...removing, admin: false }, true)],
              'Membership revoked'
            )
          ) {
            setRemoving(null)
            found.reload()
          }
        }}
      >
        {removing && <Statement sql={membershipStatement({ ...removing, admin: false }, true)} />}
      </Confirm>
      <Drawer
        open={granting !== null}
        onClose={() => setGranting(null)}
        title={granting ? `${revoke ? 'Revoke' : 'Grant'} on ${granting.table}` : ''}
        subtitle={`To ${name}. You own this collection, so PostgreSQL lets you.`}
        footer={
          <>
            <Button onClick={() => setGranting(null)}>Cancel</Button>
            <Button
              tone={revoke ? 'danger' : 'primary'}
              busy={runner.busy}
              disabled={!!grantProblem}
              onClick={async () => {
                if (await runner.runStatements([grantSql], revoke ? 'Revoked' : 'Granted')) {
                  setGranting(null)
                  grants.reload()
                }
              }}
            >
              {revoke ? 'Revoke' : 'Grant'}
            </Button>
          </>
        }
      >
        {granting && (
          <div class="form">
            <div class="field field-wide">
              <Toggle checked={revoke} onChange={setRevoke} label={revoke ? 'Revoke' : 'Grant'} />
            </div>
            <fieldset class="field field-wide">
              <legend class="field-label">Privileges</legend>
              <div class="checks">
                {tablePrivileges.map((p) => (
                  <Checkbox
                    key={p}
                    label={p}
                    checked={granting.privileges.includes(p)}
                    onChange={(on) =>
                      setGranting({
                        ...granting,
                        privileges: on
                          ? [...granting.privileges, p]
                          : granting.privileges.filter((x) => x !== p),
                      })
                    }
                  />
                ))}
              </div>
            </fieldset>
            {granting.privileges.every((p) =>
              (columnPrivileges as readonly string[]).includes(p)
            ) && (
              <fieldset class="field field-wide">
                <legend class="field-label">Fields</legend>
                <p class="field-hint">
                  None chosen means the whole collection, including fields added later.
                </p>
                <div class="checks checks-columns">
                  {columnsOf(catalog, ws, granting.table).map((c) => (
                    <Checkbox
                      key={c.name}
                      label={<span class="mono">{c.name}</span>}
                      checked={granting.columns.includes(c.name)}
                      onChange={(on) =>
                        setGranting({
                          ...granting,
                          columns: on
                            ? [...granting.columns, c.name]
                            : granting.columns.filter((x) => x !== c.name),
                        })
                      }
                    />
                  ))}
                </div>
              </fieldset>
            )}
            {!revoke && (
              <div class="field field-wide">
                <Checkbox
                  checked={granting.withGrantOption}
                  onChange={(withGrantOption) => setGranting({ ...granting, withGrantOption })}
                  label="With grant option"
                  hint="They may pass it on."
                />
              </div>
            )}
          </div>
        )}
        {grantProblem ? (
          <Notice tone="warning" title={grantProblem} />
        ) : (
          grantSql && <Statement sql={grantSql} />
        )}
      </Drawer>
    </Page>
  )
}

const commands: PolicyCommand[] = ['ALL', 'SELECT', 'INSERT', 'UPDATE', 'DELETE']

export function Policies() {
  const { catalog } = useSession()
  const location = useLocation()
  const ws = useWorkspace()
  const only = location.query.c
  const found = useLoad((db) => readPolicies(db), [catalog])
  const roles = useLoad((db) => readRoles(db), [])
  const runner = useRunner()
  const owned = tablesIn(catalog, ws).filter((t) => t.can_alter && t.kind !== 'v')
  const [draft, setDraft] = useState<PolicyDraft | null>(null)
  const [dropping, setDropping] = useState<{ table: string; name: string } | null>(null)
  const tables = tablesIn(catalog, ws).filter((t) => !only || t.name === only)
  const list = (found.data ?? []).filter((p) => p.schema === ws && (!only || p.table === only))
  let statement = ''
  let invalid: string | null = null
  try {
    statement = draft ? policyStatement(draft) : ''
  } catch (error) {
    invalid = error instanceof Error ? error.message : String(error)
  }
  return (
    <Page
      title="Row policies"
      icon={<PolicyIcon size={22} />}
      crumbs={[
        { label: 'Access', href: '/access' },
        ...(only ? [{ label: 'Every collection', href: href('/access/policies', { ws }) }] : []),
      ]}
      subtitle="Which rows each role reaches. A policy is an expression PostgreSQL adds to every statement on its collection."
      actions={
        owned.length ? (
          <Action
            label="New policy"
            icon={<PlusIcon size={22} />}
            onClick={() =>
              setDraft({
                schema: ws,
                table: owned.find((t) => t.name === only)?.name ?? owned[0]!.name,
                name: '',
                permissive: true,
                command: 'ALL',
                roles: [],
                using: '',
                check: '',
              })
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
      {runner.problem && (
        <Notice tone="danger" title={runner.problem.title}>
          {runner.problem.detail}
        </Notice>
      )}
      {found.error ? (
        <Notice tone="danger" title={describe(found.error).title} />
      ) : !found.data ? (
        <Loading />
      ) : (
        tables.map((t) => {
          const mine = list.filter((p) => p.table === t.name)
          const info = tableOf(catalog, ws, t.name)
          return (
            <section key={t.name} class="section">
              <header class="section-head">
                <div>
                  <h2 class="mono">{t.name}</h2>
                  <p>
                    {info?.rls
                      ? mine.length
                        ? `Row security is on; ${mine.length} ${mine.length === 1 ? 'policy decides' : 'policies decide'} which rows each role reaches.`
                        : 'Row security is on with no policy: only the owner reaches a row.'
                      : 'Row security is off: these policies are not applied until it is turned on.'}
                  </p>
                </div>
                {info?.rls ? <Badge tone="primary">RLS on</Badge> : <Badge>RLS off</Badge>}
              </header>
              {mine.length > 0 && (
                <ul class="policies">
                  {mine.map((p) => (
                    <li key={p.name} class="policy">
                      <div class="policy-head">
                        <strong class="mono">{p.name}</strong>
                        <Badge>{p.command}</Badge>
                        <Badge tone={p.permissive === 'PERMISSIVE' ? 'neutral' : 'warning'}>
                          {p.permissive.toLowerCase()}
                        </Badge>
                        <span class="policy-roles mono">to {p.roles.join(', ')}</span>
                        {t.can_alter && (
                          <button
                            type="button"
                            class="icon-button"
                            aria-label={`Drop ${p.name}`}
                            onClick={() => setDropping({ table: t.name, name: p.name })}
                          >
                            <TrashIcon size={15} />
                          </button>
                        )}
                      </div>
                      {p.using && <code class="policy-expr">USING ({p.using})</code>}
                      {p.check && <code class="policy-expr">WITH CHECK ({p.check})</code>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )
        })
      )}
      {found.data && !tables.length && (
        <Empty icon={<PolicyIcon size={26} />} title="No collection here you may reach" />
      )}
      <Drawer
        open={draft !== null}
        onClose={() => setDraft(null)}
        title="New row policy"
        subtitle="Only the owner of a collection may write its policies."
        wide
        footer={
          <>
            <Button onClick={() => setDraft(null)}>Cancel</Button>
            <Button
              tone="primary"
              busy={runner.busy}
              disabled={!!invalid}
              onClick={async () => {
                if (await runner.runStatements([statement], `Created ${draft?.name}`))
                  setDraft(null)
              }}
            >
              Create policy
            </Button>
          </>
        }
      >
        {draft && (
          <div class="form">
            <Field label="Collection" id="pol-table" required>
              <Select
                id="pol-table"
                value={draft.table}
                onChange={(e) => setDraft({ ...draft, table: e.currentTarget.value })}
              >
                {owned.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Name" id="pol-name" required>
              <Input
                id="pol-name"
                mono
                value={draft.name}
                onInput={(e) => setDraft({ ...draft, name: e.currentTarget.value })}
                placeholder="own_rows"
              />
            </Field>
            <Field label="For" id="pol-cmd">
              <Select
                id="pol-cmd"
                value={draft.command}
                onChange={(e) =>
                  setDraft({ ...draft, command: e.currentTarget.value as PolicyCommand })
                }
              >
                {commands.map((c) => (
                  <option key={c} value={c}>
                    {c === 'ALL' ? 'Every statement (ALL)' : c}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Combines"
              id="pol-perm"
              hint="Permissive policies widen access; restrictive ones narrow what the permissive ones allow."
            >
              <Select
                id="pol-perm"
                value={draft.permissive ? 'p' : 'r'}
                onChange={(e) => setDraft({ ...draft, permissive: e.currentTarget.value === 'p' })}
              >
                <option value="p">Permissive (OR)</option>
                <option value="r">Restrictive (AND)</option>
              </Select>
            </Field>
            <fieldset class="field field-wide">
              <legend class="field-label">Applies to</legend>
              <p class="field-hint">None chosen means every role (PUBLIC).</p>
              <div class="checks checks-columns">
                {(roles.data?.roles ?? [])
                  .filter((r) => !isSystemRole(r.name))
                  .map((r) => (
                    <Checkbox
                      key={r.name}
                      label={<span class="mono">{r.name}</span>}
                      checked={draft.roles.includes(r.name)}
                      onChange={(on) =>
                        setDraft({
                          ...draft,
                          roles: on
                            ? [...draft.roles, r.name]
                            : draft.roles.filter((x) => x !== r.name),
                        })
                      }
                    />
                  ))}
              </div>
            </fieldset>
            {draft.command !== 'INSERT' && (
              <Field
                label="USING"
                id="pol-using"
                wide
                hint="Which existing rows are reachable. For example: created_by = session_user"
              >
                <TextArea
                  id="pol-using"
                  mono
                  rows={2}
                  value={draft.using}
                  onInput={(e) => setDraft({ ...draft, using: e.currentTarget.value })}
                />
              </Field>
            )}
            {draft.command !== 'SELECT' && draft.command !== 'DELETE' && (
              <Field
                label="WITH CHECK"
                id="pol-check"
                wide
                hint="Which new or changed rows are allowed."
              >
                <TextArea
                  id="pol-check"
                  mono
                  rows={2}
                  value={draft.check}
                  onInput={(e) => setDraft({ ...draft, check: e.currentTarget.value })}
                />
              </Field>
            )}
          </div>
        )}
        {invalid ? (
          <Notice tone="warning" title={invalid} />
        ) : (
          statement && <Statement sql={statement} />
        )}
      </Drawer>
      <Confirm
        open={dropping !== null}
        title="Drop this policy?"
        confirm="Drop policy"
        busy={runner.busy}
        onClose={() => setDropping(null)}
        onConfirm={async () => {
          if (
            dropping &&
            (await runner.runStatements(
              [dropPolicyStatement(ws, dropping.table, dropping.name)],
              `Dropped ${dropping.name}`
            ))
          )
            setDropping(null)
        }}
      >
        <p>Rows it let roles reach stop being reachable through it at once.</p>
        {dropping && <Statement sql={dropPolicyStatement(ws, dropping.table, dropping.name)} />}
      </Confirm>
    </Page>
  )
}
