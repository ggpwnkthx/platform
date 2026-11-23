import { ActionIcon, Group, SegmentedControl, Table, Text, TextInput } from '@mantine/core'
import { createRoleStatements, reservedRole } from '@platform/core'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { Change } from '../bits/change.tsx'
import { RoleName } from '../bits/marks.tsx'
import { Page, Problem, Tag } from '../bits/page.tsx'
import { useSession } from '../session/context.ts'
import { usePlace } from '../session/hooks.ts'
import { useRoles } from './shared.tsx'

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

/** The roles the reader may see — their own, or all of them for an operator — and a new one. */
export function Roles() {
  const { identity } = useSession()
  const place = usePlace()
  const found = useRoles()
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState<{ name: string; login: boolean } | null>(null)
  const all = (found.data?.roles ?? []).filter(
    (r) => !r.name.startsWith('pg_') && r.name.includes(search)
  )
  const me = found.data?.roles.find((r) => r.name === identity.username)
  const count = (role: string, side: 'role' | 'member') =>
    found.data?.memberships.filter((m) => m[side] === role).length ?? 0
  return (
    <Page
      title="Roles"
      crumbs={['Access', 'Users and groups']}
      actions={
        (me?.create_role || me?.superuser) && (
          <ActionIcon
            size={44}
            radius="xl"
            aria-label="New role"
            title="New role"
            onClick={() => setDraft({ name: '', login: true })}
          >
            <Plus />
          </ActionIcon>
        )
      }
    >
      <TextInput
        placeholder="Search roles"
        radius="xl"
        w={320}
        mb="sm"
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
      />
      <Problem error={found.error} />
      <Text fz="sm" c="dimmed" mb="sm">
        A user is a PostgreSQL LOGIN role named after the address they sign in with; a group is a
        NOLOGIN role.{' '}
        {identity.is_operator ? '' : 'You see your own roles; an operator sees them all.'}
      </Text>
      <Table highlightOnHover verticalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Role</Table.Th>
            <Table.Th>Kind</Table.Th>
            <Table.Th>Member of</Table.Th>
            <Table.Th>Members</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {all.map((r) => (
            <Table.Tr key={r.name}>
              <Table.Td>
                <RoleName
                  name={r.name}
                  group={!r.login}
                  link={place.to('/access/role', { r: r.name })}
                />
              </Table.Td>
              <Table.Td>
                {r.login ? 'User' : 'Group'}
                {reservedRole(r.name) && (
                  <Text span c="dimmed">
                    {' '}
                    · the platform’s own
                  </Text>
                )}
              </Table.Td>
              <Table.Td className="mono">{count(r.name, 'member') || ''}</Table.Td>
              <Table.Td className="mono">{count(r.name, 'role') || ''}</Table.Td>
              <Table.Td>{attributes(r)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {draft && (
        <Change
          title="New role"
          opened
          onClose={() => setDraft(null)}
          statements={() => createRoleStatements(draft)}
        >
          <TextInput
            label="Name"
            description={
              draft.login
                ? 'The address the person signs in with: the claim their token carries.'
                : 'A group: it holds rights for its members and cannot log in.'
            }
            className="mono"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.currentTarget.value })}
          />
          <SegmentedControl
            data={[
              { value: 'user', label: 'A user (LOGIN)' },
              { value: 'group', label: 'A group (NOLOGIN)' },
            ]}
            value={draft.login ? 'user' : 'group'}
            onChange={(kind) => setDraft({ ...draft, login: kind === 'user' })}
          />
        </Change>
      )}
    </Page>
  )
}
