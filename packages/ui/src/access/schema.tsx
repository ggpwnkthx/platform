import { ActionIcon, Checkbox, Group, Table, TextInput } from '@mantine/core'
import { grantStatement, schemaPrivileges } from '@platform/core'
import { Pencil } from 'lucide-react'
import { useState } from 'react'
import { AddButton } from '../bits/add.tsx'
import { Change } from '../bits/change.tsx'
import { Privilege } from '../bits/marks.tsx'
import { Problem, Section } from '../bits/page.tsx'
import { useSession } from '../session/context.ts'
import { Role, same, useGrants, useSchemaReach } from './shared.tsx'

/** Who may use a workspace and who may make collections in it. */
export function SchemaAccess({ schema }: { schema: string }) {
  const { catalog } = useSession()
  const reached = useSchemaReach(schema)
  const grants = useGrants(schema)
  const [editing, setEditing] = useState<{ role: string; wanted: string[]; fixed: boolean } | null>(
    null
  )
  const owner = catalog.schemas.find((s) => s.name === schema)?.can_alter
  const direct = (role: string) =>
    (grants.data ?? []).filter((g) => !g.table && same(g.grantee, role)).map((g) => g.privilege)
  return (
    <Section
      title="The workspace"
      note="USAGE lets a role reach the collections it is granted; CREATE lets it make collections of its own."
      actions={
        owner && (
          <AddButton onClick={() => setEditing({ role: '', wanted: ['USAGE'], fixed: false })}>
            Grant
          </AddButton>
        )
      }
    >
      <Problem error={reached.error} />
      <Table verticalSpacing="xs">
        <Table.Tbody>
          {(reached.data ?? [])
            .filter((r) => r.usage || r.create)
            .map((r) => (
              <Table.Tr key={r.role}>
                <Table.Td>
                  <Role name={r.role} />
                </Table.Td>
                <Table.Td>
                  <Group gap="md">
                    <Privilege name="USAGE" held={r.usage} />
                    <Privilege name="CREATE" held={r.create} />
                  </Group>
                </Table.Td>
                <Table.Td ta="right">
                  {owner && (
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      aria-label="Change"
                      onClick={() =>
                        setEditing({ role: r.role, wanted: direct(r.role), fixed: true })
                      }
                    >
                      <Pencil size={16} />
                    </ActionIcon>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
        </Table.Tbody>
      </Table>
      {editing && (
        <Change
          title={`Grant on ${schema}`}
          opened
          onClose={() => setEditing(null)}
          statements={() => {
            if (!editing.role.trim()) throw new Error('Choose the role.')
            const held = direct(editing.role)
            const draft = (privileges: string[]) => ({
              schema,
              table: null,
              privileges,
              grantee: editing.role,
            })
            const give = editing.wanted.filter((p) => !held.includes(p))
            const take = held.filter((p) => !editing.wanted.includes(p))
            return [
              ...(take.length ? [grantStatement(draft(take), true)] : []),
              ...(give.length ? [grantStatement(draft(give))] : []),
            ]
          }}
        >
          <TextInput
            label="Role"
            className="mono"
            disabled={editing.fixed}
            value={editing.role}
            onChange={(e) => setEditing({ ...editing, role: e.currentTarget.value })}
          />
          <Checkbox.Group
            label="Granted to it by name"
            description="A right it holds through a group or as PUBLIC is changed there."
            value={editing.wanted}
            onChange={(wanted) => setEditing({ ...editing, wanted })}
          >
            <Group mt="xs">
              {schemaPrivileges.map((p) => (
                <Checkbox key={p} value={p} label={<span className="mono">{p}</span>} />
              ))}
            </Group>
          </Checkbox.Group>
        </Change>
      )}
    </Section>
  )
}
