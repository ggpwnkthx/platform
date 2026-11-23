import { Table } from '@mantine/core'
import { membershipStatement } from '@platform/core'
import { useState } from 'react'
import { AddButton } from '../bits/add.tsx'
import { Change } from '../bits/change.tsx'
import { RoleName } from '../bits/marks.tsx'
import { Empty, Remove, Section, Tag } from '../bits/page.tsx'
import { usePlace } from '../session/hooks.ts'
import { AddMembership } from './add-membership.tsx'

export interface Membership {
  role: string
  member: string
  admin_option: boolean
}

/**
 * The groups a role belongs to, and the roles that belong to it. The two are the same
 * relation read from its two ends, so they are drawn by the same piece.
 */
export function Memberships({
  name,
  groups,
  members,
  admits,
  isGroup,
  mayAdmit,
}: {
  name: string
  groups: Membership[]
  members: Membership[]
  /** Whether a group may admit others to it. */
  admits: (group: string) => boolean | undefined
  /** Whether this role is a group, whose members are listed. */
  isGroup: boolean
  /** Whether this role may admit others to it. */
  mayAdmit: boolean
}) {
  const [removing, setRemoving] = useState<{ title: string; statements: string[] } | null>(null)
  const [adding, setAdding] = useState<'role' | 'member' | null>(null)
  return (
    <>
      <Section
        title="Member of"
        note="The groups it belongs to: it holds what they hold."
        actions={<AddButton onClick={() => setAdding('role')}>Add to a group</AddButton>}
      >
        {!groups.length && <Empty>No group you may see.</Empty>}
        <MembershipTable
          rows={groups.map((m) => ({ name: m.role, admin: m.admin_option }))}
          group
          label="Remove from {name}"
          onRemove={(group) =>
            setRemoving({
              title: `Remove from ${group}`,
              statements: [membershipStatement({ role: group, member: name }, true)],
            })
          }
          removable={admits}
        />
      </Section>
      {isGroup && (
        <Section
          title="Members"
          note="The roles that belong to this group."
          actions={
            mayAdmit && <AddButton onClick={() => setAdding('member')}>Add a member</AddButton>
          }
        >
          {!members.length && <Empty>No member you may see.</Empty>}
          <MembershipTable
            rows={members.map((m) => ({ name: m.member, admin: false }))}
            label="Remove {name}"
            onRemove={(member) =>
              setRemoving({
                title: `Remove ${member}`,
                statements: [membershipStatement({ role: name, member }, true)],
              })
            }
            removable={() => mayAdmit}
          />
        </Section>
      )}
      {removing && (
        <Change
          title={removing.title}
          opened
          danger
          onClose={() => setRemoving(null)}
          statements={() => removing.statements}
        />
      )}
      {adding && <AddMembership name={name} side={adding} onClose={() => setAdding(null)} />}
    </>
  )
}

/** One side of the relation: a role, whether it may admit others, and the way out of it. */
function MembershipTable({
  rows,
  group,
  label,
  removable,
  onRemove,
}: {
  rows: { name: string; admin: boolean }[]
  /** A group is drawn as a group; a member is drawn as a person. */
  group?: boolean
  /** The name of the button that leaves the relation, with the role in it. */
  label: string
  /** Whether the row may be left. */
  removable(row: string): boolean | undefined
  onRemove(name: string): void
}) {
  const place = usePlace()
  return (
    <Table verticalSpacing="xs">
      <Table.Tbody>
        {rows.map((row) => (
          <Table.Tr key={row.name}>
            <Table.Td>
              <RoleName
                name={row.name}
                group={group}
                link={place.to('/access/role', { r: row.name })}
              />
            </Table.Td>
            <Table.Td>{row.admin && <Tag color="blue">may admit others</Tag>}</Table.Td>
            <Table.Td ta="right">
              {removable(row.name) && (
                <Remove
                  label={label.replace('{name}', row.name)}
                  onClick={() => onRemove(row.name)}
                />
              )}
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  )
}
