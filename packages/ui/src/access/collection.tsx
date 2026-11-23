import { Button, Group, Table, Text } from '@mantine/core'
import { columnPrivileges, tableOf } from '@platform/core'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { PrivilegeLegend } from '../bits/marks.tsx'
import { Problem, Section, Tag } from '../bits/page.tsx'
import type { Field } from '../fields/types.ts'
import { useSession } from '../session/context.ts'
import { GrantEditor } from './grant.tsx'
import { PolicyCards } from './policies.tsx'
import { ReachTable } from './reach.tsx'
import { holdsAny, same, useGrants, useReach } from './shared.tsx'

/** A collection's access: the roles its ACL names, who reads and writes each field, its row security. */
export function CollectionAccess({
  schema,
  table,
  fields,
}: {
  schema: string
  table: string
  fields: Field[]
}) {
  const { catalog } = useSession()
  const grants = useGrants(schema)
  const reached = useReach(schema, { table })
  const [editing, setEditing] = useState<string | null>(null)
  const owner = tableOf(catalog, schema, table)?.can_alter
  const acl = (grants.data ?? []).filter((g) => g.table === table)
  const named = (role: string) => acl.some((g) => same(g.grantee, role))
  const rows = (reached.data ?? []).filter(holdsAny)
  const holders = (column: string, privilege: string) =>
    acl.filter((g) => g.privilege === privilege && (!g.column || g.column === column))
  return (
    <>
      <Section
        title="Granted by name"
        note="The roles the collection's ACL names, and what each holds."
        actions={
          owner && (
            <Button
              variant="default"
              leftSection={<Plus size={16} />}
              onClick={() => setEditing('')}
            >
              Grant
            </Button>
          )
        }
      >
        <PrivilegeLegend />
        <Problem error={reached.error ?? grants.error} />
        <ReachTable
          rows={rows.filter((r) => named(r.role))}
          by="role"
          grants={acl}
          edit={owner ? (row) => setEditing(row.role) : undefined}
        />
      </Section>
      <Section
        title="Reaching it through another role"
        note="Roles that hold something here without being named: through a group, or as PUBLIC."
      >
        <ReachTable rows={rows.filter((r) => !named(r.role))} by="role" grants={acl} />
      </Section>
      <Section
        title="The fields"
        note="Who reads and writes each field: through the whole collection, or by name."
      >
        <Table verticalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Field</Table.Th>
              {columnPrivileges.slice(0, 3).map((p) => (
                <Table.Th key={p} className="mono">
                  {p}
                </Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {fields.map((f) => (
              <Table.Tr key={f.name}>
                <Table.Td className="mono">{f.name}</Table.Td>
                {columnPrivileges.slice(0, 3).map((p) => (
                  <Table.Td key={p}>
                    <Group gap={4}>
                      {holders(f.name, p).map((g) => (
                        <Tag key={g.grantee + g.column} color={g.column ? 'orange' : 'gray'}>
                          <span className="mono">{g.grantee}</span>
                        </Tag>
                      ))}
                    </Group>
                  </Table.Td>
                ))}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        <Text fz="xs" c="dimmed" mt="xs">
          A role granted the field by name is marked; one that holds the whole collection is
          quieter.
        </Text>
      </Section>
      <PolicyCards schema={schema} table={table} />
      {editing !== null && (
        <GrantEditor
          schema={schema}
          table={table}
          role={editing || undefined}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}
