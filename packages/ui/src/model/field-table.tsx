import { ActionIcon, Group, Table, Text } from '@mantine/core'
import { situations } from '@platform/core'
import { Settings2 } from 'lucide-react'
import { Remove, Tag } from '../bits/page.tsx'
import type { Field } from '../fields/types.ts'
const shortTypes: [string, string][] = [
  ['timestamp with time zone', 'timestamptz'],
  ['timestamp without time zone', 'timestamp'],
  ['character varying', 'varchar'],
  ['double precision', 'float8'],
]
export const shortType = (type: string) =>
  shortTypes.reduce((text, [long, short]) => text.replace(long, short), type)

/** What PostgreSQL withholds from the reader is marked, never papered over. */
export const withheld = (f: Field) =>
  !f.column.can_select && !f.column.can_insert && !f.column.can_update
    ? 'hidden from you'
    : !f.column.can_select
      ? 'write-only'
      : !f.column.can_update && !f.computed && !f.system
        ? 'read-only'
        : null

/** The fields of a collection, as the reader may know them. */
export function FieldTable({
  fields,
  canAlter,
  onSay,
  onDrop,
}: {
  fields: Field[]
  canAlter: boolean
  onSay(field: Field): void
  onDrop(field: Field): void
}) {
  return (
    <Table verticalSpacing="sm">
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Field</Table.Th>
          <Table.Th>Type</Table.Th>
          <Table.Th>Rules</Table.Th>
          <Table.Th>Appears in</Table.Th>
          <Table.Th />
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {fields.map((f) => (
          <Table.Tr key={f.name}>
            <Table.Td>
              <Text fw={600}>{f.label}</Text>
              {f.label !== f.name && (
                <Text fz="xs" className="mono" c="dimmed">
                  {f.name}
                </Text>
              )}
              {withheld(f) && <Tag color="yellow">{withheld(f)}</Tag>}
            </Table.Td>
            <Table.Td>
              <Text className="mono">{shortType(f.column.type)}</Text>
              {f.relation && (
                <Text fz="xs" c="dimmed">
                  → <span className="mono">{f.relation.target_table}</span>
                </Text>
              )}
              {f.computed && (
                <Text fz="xs" c="dimmed">
                  computed by PostgreSQL
                </Text>
              )}
            </Table.Td>
            <Table.Td>
              <Group gap={4}>
                {f.column.required && <Tag>required</Tag>}
                {f.choices && <Tag>{f.choices.length} choices</Tag>}
                {f.column.default && (
                  <Text fz="xs" className="mono" c="dimmed">
                    default {f.column.default}
                  </Text>
                )}
              </Group>
              <Text fz="xs" c="dimmed">
                {f.column.comment}
              </Text>
            </Table.Td>
            <Table.Td>
              <Group gap="xs" fz="sm">
                {situations.map((s) => (
                  <span key={s} className={f.views[s] === 'hide' ? 'struck' : undefined}>
                    {s}
                    {f.views[s] === 'readonly' ? ' (locked)' : ''}
                  </span>
                ))}
                {Object.entries(f.views)
                  .filter(([view]) => !situations.includes(view as 'list'))
                  .map(([view, mode]) => (
                    <span key={view} className={`mono ${mode === 'hide' ? 'struck' : ''}`}>
                      {view}
                    </span>
                  ))}
              </Group>
            </Table.Td>
            <Table.Td>
              {canAlter && (
                <Group gap={4} justify="flex-end" wrap="nowrap">
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    aria-label={`What ${f.name} says of itself`}
                    title="Name, views and renderers"
                    onClick={() => onSay(f)}
                  >
                    <Settings2 size={16} />
                  </ActionIcon>
                  {!f.system && <Remove label={`Drop ${f.name}`} onClick={() => onDrop(f)} />}
                </Group>
              )}
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  )
}
