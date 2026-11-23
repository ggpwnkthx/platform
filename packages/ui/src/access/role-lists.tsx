import { Group, Table, Text, TextInput } from '@mantine/core'
import { type RoleInfo, reservedRole } from '@platform/core'
import { useState } from 'react'
import { RoleName } from '../bits/marks.tsx'
import { Empty, Tag } from '../bits/page.tsx'
import { usePlace } from '../session/hooks.ts'
import { same, useRoles } from './shared.tsx'

/** The roles the reader may see, and the memberships between them. */
export function useRoleMap() {
  const found = useRoles()
  const roles = (found.data?.roles ?? []).filter((r) => !r.name.startsWith('pg_'))
  const memberships = found.data?.memberships ?? []
  return {
    found,
    roles,
    /** Whether a name is a group, so it is drawn as one. */
    isGroup: (name: string) => roles.find((r) => same(r.name, name))?.login === false,
    /** The groups a role belongs to: it holds what they hold. */
    groupsOf: (name: string) => memberships.filter((m) => same(m.member, name)).map((m) => m.role),
    /** The roles that belong to a group. */
    membersOf: (name: string) => memberships.filter((m) => same(m.role, name)).map((m) => m.member),
  }
}

export const attributes = (r: {
  superuser: boolean
  create_role: boolean
  bypass_rls: boolean
}) => (
  <Group gap={4}>
    {r.superuser && <Tag color="red">superuser</Tag>}
    {r.create_role && <Tag color="blue">makes roles</Tag>}
    {r.bypass_rls && <Tag color="yellow">bypasses row security</Tag>}
  </Group>
)

/** The people who sign in: each a LOGIN role, and the groups it belongs to. */
export function Users() {
  const map = useRoleMap()
  const [search, setSearch] = useState('')
  const users = map.roles.filter((r) => r.login)
  const shown = users.filter((r) => r.name.toLowerCase().includes(search.trim().toLowerCase()))
  return (
    <>
      <Text fz="sm" c="dimmed" maw="72ch" mb="sm">
        People who sign in: each one a PostgreSQL LOGIN role, named after the address its token
        carries.
      </Text>
      <TextInput
        placeholder="Search users"
        aria-label="Search users"
        radius="xl"
        w={320}
        mb="sm"
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
      />
      {!users.length && <Empty>No user you may see.</Empty>}
      {!!users.length && !shown.length && <Empty>No user matches that search.</Empty>}
      {!!shown.length && (
        <RoleTable
          head="User"
          roles={shown}
          memberships={[{ head: 'In groups', names: map.groupsOf }]}
        />
      )}
    </>
  )
}

/** The groups: the holders of rights for their members, and the members they hold. */
export function Groups() {
  const map = useRoleMap()
  const [search, setSearch] = useState('')
  const groups = map.roles.filter((r) => !r.login)
  const shown = groups.filter((r) => r.name.toLowerCase().includes(search.trim().toLowerCase()))
  return (
    <>
      <Text fz="sm" c="dimmed" maw="72ch" mb="sm">
        Holders of rights for their members: a NOLOGIN role that cannot sign in, but whatever it
        holds, its members hold.
      </Text>
      <TextInput
        placeholder="Search groups"
        aria-label="Search groups"
        radius="xl"
        w={320}
        mb="sm"
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
      />
      {!groups.length && <Empty>No group you may see.</Empty>}
      {!!groups.length && !shown.length && <Empty>No group matches that search.</Empty>}
      {!!shown.length && (
        <RoleTable
          head="Group"
          roles={shown}
          memberships={[
            { head: 'Members', names: map.membersOf },
            { head: 'In groups', names: map.groupsOf },
          ]}
        />
      )}
    </>
  )
}

/** A table of roles: the name, the memberships beside it, and what PostgreSQL says of it. */
function RoleTable({
  head,
  roles,
  memberships,
}: {
  /** What the name column calls the roles in this table: a user, a group. */
  head: string
  roles: RoleInfo[]
  /** The membership columns beside the name. */
  memberships: { head: string; names: (name: string) => string[] }[]
}) {
  const place = usePlace()
  const map = useRoleMap()
  return (
    <Table highlightOnHover verticalSpacing="sm">
      <Table.Thead>
        <Table.Tr>
          <Table.Th>{head}</Table.Th>
          {memberships.map((m) => (
            <Table.Th key={m.head}>{m.head}</Table.Th>
          ))}
          <Table.Th>Attributes</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {roles.map((r) => (
          <Table.Tr key={r.name}>
            <Table.Td>
              <Group gap="xs" wrap="nowrap">
                <RoleName
                  name={r.name}
                  group={!r.login}
                  link={place.to('/access/role', { r: r.name })}
                />
                {reservedRole(r.name) && (
                  <Text span c="dimmed" fz="xs" style={{ whiteSpace: 'nowrap' }}>
                    the platform’s own
                  </Text>
                )}
              </Group>
            </Table.Td>
            {memberships.map((m) => (
              <Table.Td key={m.head}>
                <Names names={m.names(r.name)} isGroup={map.isGroup} />
              </Table.Td>
            ))}
            <Table.Td>{attributes(r)}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  )
}

/** The names in a cell: each a link to the role's own page, and nothing if there are none. */
function Names({ names, isGroup }: { names: string[]; isGroup: (name: string) => boolean }) {
  const place = usePlace()
  if (!names.length)
    return (
      <Text span c="dimmed">
        —
      </Text>
    )
  return (
    <Group gap="xs">
      {names.map((n) => (
        <RoleName key={n} name={n} group={isGroup(n)} link={place.to('/access/role', { r: n })} />
      ))}
    </Group>
  )
}
