import { ActionIcon, Group, Table, Text } from '@mantine/core'
import { type GrantInfo, type ReachInfo, columnsOf, tablePrivileges } from '@platform/core'
import { Pencil } from 'lucide-react'
import { Privilege } from '../bits/marks.tsx'
import { Empty } from '../bits/page.tsx'
import { useSession } from '../session/context.ts'
import { usePlace } from '../session/hooks.ts'
import { heldBy, reachOf, Role } from './shared.tsx'

/** Marks for a set of role × collection rows; a row opens the grant it draws. */
export function ReachTable({
  rows,
  by,
  grants,
  edit,
  origin,
}: {
  rows: ReachInfo[]
  by: 'role' | 'table'
  grants: GrantInfo[]
  edit?: (row: ReachInfo) => void
  origin?: (row: ReachInfo) => string
}) {
  const { catalog } = useSession()
  const place = usePlace()
  if (!rows.length) return <Empty>Nobody is granted anything here that you may see.</Empty>
  return (
    <Table verticalSpacing="xs">
      <Table.Thead>
        <Table.Tr>
          <Table.Th>{by === 'role' ? 'Role' : 'Collection'}</Table.Th>
          <Table.Th>Privileges</Table.Th>
          {origin && <Table.Th>Comes from</Table.Th>}
          <Table.Th />
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {rows.map((row) => {
          const total = columnsOf(catalog, place.ws, row.table).length
          const held = heldBy(grants, row.table, row.role)
          return (
            <Table.Tr key={`${row.role}/${row.table}`}>
              <Table.Td>
                {by === 'role' ? (
                  <Role name={row.role} link={place.to('/access/role', { r: row.role })} />
                ) : (
                  <span className="mono">{row.table}</span>
                )}
              </Table.Td>
              <Table.Td>
                <Group gap="md">
                  {tablePrivileges.map((p) => (
                    <Privilege
                      key={p}
                      name={p}
                      held={reachOf(row, p)}
                      count={
                        held[p]?.columns.length ? `${held[p]!.columns.length}/${total}` : undefined
                      }
                    />
                  ))}
                </Group>
                {!row.usage && (
                  <Text fz="xs" c="yellow.9">
                    No USAGE on the workspace: none of this can be used yet.
                  </Text>
                )}
              </Table.Td>
              {origin && (
                <Table.Td fz="sm" c="dimmed">
                  {origin(row)}
                </Table.Td>
              )}
              <Table.Td ta="right">
                {edit && (
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    aria-label="Change this grant"
                    title="Change this grant"
                    onClick={() => edit(row)}
                  >
                    <Pencil size={16} />
                  </ActionIcon>
                )}
              </Table.Td>
            </Table.Tr>
          )
        })}
      </Table.Tbody>
    </Table>
  )
}
