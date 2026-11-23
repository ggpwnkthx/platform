import { ActionIcon, SegmentedControl, Tabs, Text, TextInput } from '@mantine/core'
import { createRoleStatements } from '@platform/core'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { Change } from '../bits/change.tsx'
import { Page, Problem } from '../bits/page.tsx'
import { useSession } from '../session/context.ts'
import { usePlace } from '../session/hooks.ts'
import { Groups, useRoleMap, Users } from './role-lists.tsx'

/**
 * The roles the reader may see, kept in two kinds: the people who sign in, and the groups
 * that hold rights for them. Each kind gets its own table, because each answers a different
 * question — who holds what, and who belongs to whom.
 */
export function Roles() {
  const { identity } = useSession()
  const place = usePlace()
  const map = useRoleMap()
  const [draft, setDraft] = useState<{ name: string; login: boolean } | null>(null)
  const tab = place.params.get('tab') === 'groups' ? 'groups' : 'users'
  const me = map.found.data?.roles.find((r) => r.name === identity.username)
  const mayCreate = !!(me?.create_role || me?.superuser)
  const counts = {
    users: map.roles.filter((r) => r.login).length,
    groups: map.roles.filter((r) => !r.login).length,
  }
  return (
    <Page
      title="Users and groups"
      crumbs={['Access']}
      actions={
        mayCreate && (
          <ActionIcon
            size={44}
            radius="xl"
            aria-label={tab === 'users' ? 'New user' : 'New group'}
            title={tab === 'users' ? 'New user' : 'New group'}
            onClick={() => setDraft({ name: '', login: tab === 'users' })}
          >
            <Plus />
          </ActionIcon>
        )
      }
    >
      <Problem error={map.found.error} />
      <Text fz="sm" c="dimmed" mb="md" maw="72ch">
        Users sign in. Groups hold rights for the people in them.{' '}
        {identity.is_operator ? '' : 'You see your own roles; an operator sees them all.'}
      </Text>
      <Tabs value={tab} onChange={(next) => place.set({ tab: next })} keepMounted={false}>
        <Tabs.List mb="lg">
          <Tabs.Tab value="users" rightSection={<Count n={counts.users} />}>
            Users
          </Tabs.Tab>
          <Tabs.Tab value="groups" rightSection={<Count n={counts.groups} />}>
            Groups
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="users">
          <Users />
        </Tabs.Panel>
        <Tabs.Panel value="groups">
          <Groups />
        </Tabs.Panel>
      </Tabs>
      {draft && (
        <Change
          title={draft.login ? 'New user' : 'New group'}
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

/** How many roles of a kind there are, beside its name. */
const Count = ({ n }: { n: number }) => (
  <Text span fz="xs" c="dimmed" className="mono">
    {n}
  </Text>
)
