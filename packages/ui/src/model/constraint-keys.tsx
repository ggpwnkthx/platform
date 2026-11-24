import { ActionIcon, Card, Group, Stack, Table, Text } from '@mantine/core'
import {
  type ConstraintInfo,
  deleteRule,
  dropConstraintStatement,
  type RelationInfo,
} from '@platform/core'
import { Pencil } from 'lucide-react'
import { Remove } from '../bits/page.tsx'
import type { Change } from './constraint-shared.ts'

/**
 * The keys a collection holds: the ones that point at another collection, and the ones that
 * hold a row once. Each is shown as PostgreSQL's catalog holds it, with the one change
 * that may be made to it.
 */

/** The rows this collection points at: the keys it holds, and where they go. */
export function ForeignKeys({
  schema,
  table,
  constraints,
  relations,
  canAlter,
  onChange,
  onRule,
}: {
  schema: string
  table: string
  constraints: ConstraintInfo[]
  relations: RelationInfo[]
  canAlter: boolean
  onChange(change: Change): void
  onRule(key: ConstraintInfo, relation: RelationInfo): void
}) {
  const keys = constraints.filter((c) => c.type === 'f')
  return (
    <>
      {!keys.length && (
        <Text fz="sm" c="dimmed">
          No foreign key here: every row stands on its own.
        </Text>
      )}
      <Stack gap="sm">
        {keys.map((key) => {
          const column = key.columns[0] ?? ''
          const relation = relations.find((one) => one.column === column)
          // A key over more than one column is read as a constraint, not as a relation:
          // there is no row of it to reach, and the interface says so rather than
          // showing half a key.
          const composite = key.columns.length > 1
          const target = relation
            ? `${relation.target_schema}.${relation.target_table}`
            : key.target_table
              ? `${key.target_schema}.${key.target_table}`
              : '—'
          const rule = relation?.on_delete ?? key.on_delete
          return (
            <Card key={key.name} withBorder radius="md" padding="sm">
              <Group justify="space-between">
                <Group gap="xs">
                  <Text className="mono" fw={600}>
                    {composite ? key.columns.join(', ') : column}
                  </Text>
                  <Text fz="sm" c="dimmed">
                    points at
                  </Text>
                  <Text className="mono" fz="sm">
                    {target}
                  </Text>
                  <Text className="mono" fz="xs" c="dimmed">
                    {key.name}
                  </Text>
                  {rule && <Text fz="xs">{deleteRule(rule)}</Text>}
                  {composite && (
                    <Text fz="xs" c="dimmed">
                      over more than one column: read as a constraint, not as a relation
                    </Text>
                  )}
                </Group>
                <Group gap={4}>
                  {relation && canAlter && (
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      aria-label={`Change what happens to ${column}`}
                      title="What happens when the row it points at goes"
                      onClick={() => onRule(key, relation)}
                    >
                      <Pencil size={16} />
                    </ActionIcon>
                  )}
                  {canAlter && (
                    <Remove
                      label={`Drop ${key.name}`}
                      onClick={() =>
                        onChange({
                          title: `Drop ${key.name}`,
                          statements: [dropConstraintStatement(schema, table, key.name)],
                          danger: true,
                        })
                      }
                    />
                  )}
                </Group>
              </Group>
            </Card>
          )
        })}
      </Stack>
    </>
  )
}

/** The keys that hold a row once: over one field, or over several together. */
export function UniqueKeys({
  schema,
  table,
  constraints,
  canAlter,
  onChange,
}: {
  schema: string
  table: string
  constraints: ConstraintInfo[]
  canAlter: boolean
  onChange(change: Change): void
}) {
  const keys = constraints.filter((c) => c.type === 'u')
  return (
    <>
      {!keys.length && (
        <Text fz="sm" c="dimmed">
          No unique key here: the same value may be held twice.
        </Text>
      )}
      <Table verticalSpacing="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Key</Table.Th>
            <Table.Th>Over</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {keys.map((key) => (
            <Table.Tr key={key.name}>
              <Table.Td className="mono">{key.name}</Table.Td>
              <Table.Td className="mono">{key.columns.join(', ')}</Table.Td>
              <Table.Td>
                {canAlter && (
                  <Remove
                    label={`Drop ${key.name}`}
                    onClick={() =>
                      onChange({
                        title: `Drop ${key.name}`,
                        statements: [dropConstraintStatement(schema, table, key.name)],
                        danger: true,
                      })
                    }
                  />
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </>
  )
}
