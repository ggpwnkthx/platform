import { Group, Table, Text, Timeline } from '@mantine/core'
import type { ActivityInfo } from '@platform/core'
import { Value } from '../fields/renderers.tsx'
import type { Field } from '../fields/types.ts'
/** The fields of a collection that PostgreSQL writes itself, as they are now. */
export function SystemFields({
  fields,
  row,
}: {
  fields: Field[]
  row: Record<string, unknown> | null | undefined
}) {
  const system = fields.filter((f) => f.system && f.column.can_select)
  return (
    <Table withRowBorders={false} verticalSpacing={4}>
      <Table.Tbody>
        {system.map((f) => (
          <Table.Tr key={f.name}>
            <Table.Td c="dimmed" fz="sm">
              {f.label}
            </Table.Td>
            <Table.Td>
              <Value field={f} value={row?.[f.name]} situation="record" />
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  )
}

/** The revisions of a record: who wrote it, when, and what changed. */
export function Revisions({ history }: { history: ActivityInfo[] | undefined }) {
  if (!history?.length) return null
  return (
    <div>
      <Text fw={650} mb="xs">
        Revisions
      </Text>
      <Timeline bulletSize={10} lineWidth={1}>
        {history.map((h) => (
          <Timeline.Item
            key={h.id}
            title={
              <Text fz="sm">
                {h.operation} by <span className="mono">{h.actor}</span>
              </Text>
            }
          >
            <Text fz="xs" c="dimmed" className="mono">
              {h.at.slice(0, 16)}
            </Text>
          </Timeline.Item>
        ))}
      </Timeline>
    </div>
  )
}

/** One field of the form: an input for the ones that may be written, its value for the rest. */
export function FieldOf({
  field,
  value,
  writable,
  error,
  onChange,
}: {
  field: Field
  value: unknown
  writable: boolean
  error: React.ReactNode
  onChange(value: unknown): void
}) {
  const label = (
    <Group gap={6}>
      {field.label}
      {field.label !== field.name && (
        <span className="mono" style={{ color: '#717273' }}>
          {field.name}
        </span>
      )}
    </Group>
  )
  if (writable)
    return (
      <div>
        <field.type.Input
          field={field}
          label={label}
          value={value}
          onChange={onChange}
          error={error}
        />
        {!field.column.can_select && (
          <Text fz="xs" c="dimmed">
            write-only: you may set it, and PostgreSQL will not show it to you
          </Text>
        )}
      </div>
    )
  return (
    <div>
      <Text fz="sm" fw={500}>
        {label}
      </Text>
      {field.column.can_select ? (
        <Value field={field} value={value} situation="record" />
      ) : (
        <Text fz="sm" c="dimmed">
          hidden from you
        </Text>
      )}
      {field.column.can_select && (
        <Text fz="xs" c="dimmed">
          {field.computed
            ? 'PostgreSQL computes it'
            : field.views.record === 'readonly'
              ? 'locked by the owner of the collection'
              : 'read-only for you'}
        </Text>
      )}
    </div>
  )
}
