import { Button, Card, Code, Group, Stack, Table, Text } from '@mantine/core'
import {
  type ColumnInfo,
  type ConstraintInfo,
  dropConstraintStatement,
  dropIndexStatement,
  dropNotNullStatement,
  type IndexInfo,
  notNullStatement,
} from '@platform/core'
import { Remove } from '../bits/page.tsx'
import type { Change } from './constraint-shared.ts'

/**
 * The rules a collection's rows are held by: the checks every row is tested by, the fields
 * a row may not leave empty, and the indexes its rows are found by.
 */

/** The checks: the expression every row is held by. */
export function Checks({
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
  const checks = constraints.filter((c) => c.type === 'c')
  return (
    <>
      {!checks.length && (
        <Text fz="sm" c="dimmed">
          No check here: every row is allowed.
        </Text>
      )}
      <Stack gap="sm">
        {checks.map((check) => (
          <Card key={check.name} withBorder radius="md" padding="sm">
            <Group justify="space-between">
              <Text className="mono" fw={600}>
                {check.name}
              </Text>
              {canAlter && (
                <Remove
                  label={`Drop ${check.name}`}
                  onClick={() =>
                    onChange({
                      title: `Drop ${check.name}`,
                      statements: [dropConstraintStatement(schema, table, check.name)],
                      danger: true,
                    })
                  }
                />
              )}
            </Group>
            <Code block mt={6} c="blue.9">
              {check.definition}
            </Code>
          </Card>
        ))}
      </Stack>
    </>
  )
}

/** The emptiness of the fields: what a row may not leave out. */
export function RequiredFields({
  schema,
  table,
  columns,
  canAlter,
  onChange,
}: {
  schema: string
  table: string
  columns: ColumnInfo[]
  canAlter: boolean
  onChange(change: Change): void
}) {
  return (
    <Table verticalSpacing="xs">
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Field</Table.Th>
          <Table.Th>Empty?</Table.Th>
          <Table.Th />
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {columns.map((column) => (
          <Table.Tr key={column.name}>
            <Table.Td className="mono">{column.name}</Table.Td>
            <Table.Td>
              {column.required ? (
                <Text c="blue.9">required</Text>
              ) : (
                <Text c="dimmed">optional</Text>
              )}
            </Table.Td>
            <Table.Td>
              {canAlter && (
                <Button
                  variant="subtle"
                  size="compact-xs"
                  onClick={() =>
                    onChange({
                      title: column.required
                        ? `${column.name} may be empty`
                        : `${column.name} may not be empty`,
                      statements: [
                        column.required
                          ? dropNotNullStatement(schema, table, column.name)
                          : notNullStatement(schema, table, column.name),
                      ],
                    })
                  }
                >
                  {column.required ? 'Make it optional' : 'Make it required'}
                </Button>
              )}
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  )
}

/** The indexes: the ways the rows are found without a scan. */
export function Indexes({
  schema,
  indexes,
  canAlter,
  onChange,
}: {
  schema: string
  indexes: IndexInfo[]
  canAlter: boolean
  onChange(change: Change): void
}) {
  return (
    <>
      {!indexes.length && (
        <Text fz="sm" c="dimmed">
          No index of its own: the rows are found by the key of the table, or by a scan.
        </Text>
      )}
      <Table verticalSpacing="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Index</Table.Th>
            <Table.Th>Over</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {indexes.map((index) => (
            <Table.Tr key={index.name}>
              <Table.Td className="mono">{index.name}</Table.Td>
              <Table.Td className="mono">
                {index.columns.join(', ')}
                {index.unique && (
                  <Text fz="xs" c="dimmed">
                    unique
                  </Text>
                )}
              </Table.Td>
              <Table.Td>
                {canAlter && (
                  <Remove
                    label={`Drop ${index.name}`}
                    onClick={() =>
                      onChange({
                        title: `Drop ${index.name}`,
                        statements: [dropIndexStatement(schema, index.name)],
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
