import { useState } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import { type MembershipInfo, type RoleInfo, roles as readRoles } from '@platform/data'
import { describe, useLoad, useSession } from '../../session.tsx'
import { Page } from '../../shell/page.tsx'
import { href } from '../../url.ts'
import { Badge, Empty, Loading, Notice } from '../../ui/bits.tsx'
import { Action } from '../../ui/button.tsx'
import { Checkbox, Select } from '../../ui/form.tsx'
import { AccessIcon, GroupIcon, PlusIcon, SearchIcon } from '../../ui/icons.tsx'
import { useOpening } from '../hooks.ts'
import { isSystemRole } from '../names.ts'
import { NewRole } from './new.tsx'
import { RoleLabel } from '../rights.tsx'
import { Attributes } from './attributes.tsx'

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
              {roles.map((role) => (
                <RoleRow
                  key={role.name}
                  role={role}
                  memberships={memberships}
                  all={all}
                  isYou={role.name === identity?.username}
                />
              ))}
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

/** One role in the list: what it belongs to, who belongs to it, and what it may do. */
function RoleRow({
  role,
  memberships,
  all,
  isYou,
}: {
  role: RoleInfo
  memberships: MembershipInfo[]
  all: RoleInfo[]
  isYou: boolean
}) {
  const memberOf = memberships.filter((m) => m.member === role.name)
  const members = memberships.filter((m) => m.role === role.name)
  return (
    <tr>
      <td>
        <span class="strong">
          <RoleLabel name={role.name} roles={all} />
        </span>
        {isYou && <Badge tone="primary">you</Badge>}
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
          <span class="mono" title={members.map((m) => m.member).join(', ') || undefined}>
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
}
