import { Button, Drawer, Group, Select, Table, Text } from '@mantine/core'
import { type ActivityInfo, activity, tablesIn } from '@platform/core'
import { useState } from 'react'
import { Empty, Page, Problem, Tag } from '../bits/page.tsx'
import { textOf } from '../fields/values.tsx'
import { useSession } from '../session/context.ts'
import { useDb, usePlace } from '../session/hooks.ts'
import { useNames } from '../shell/names.ts'
const tones: Record<string, [string, string]> = {
  INSERT: ['green', 'Created'],
  UPDATE: ['blue', 'Updated'],
  DELETE: ['red', 'Deleted'],
  TRUNCATE: ['red', 'Emptied'],
}
const Operation = ({ name }: { name: string }) => (
  <Tag color={tones[name]?.[0]}>{tones[name]?.[1] ?? name}</Tag>
)

/** The revisions the reader may read: what triggers logged, under the audit table's own rules. */
export function Activity() {
  const { catalog } = useSession()
  const place = usePlace()
  const names = useNames()
  const [limit, setLimit] = useState(100)
  const [open, setOpen] = useState<ActivityInfo | null>(null)
  const found = useDb(
    ['activity', place.ws, place.c, limit],
    (db) => activity(db, { schema: place.ws, table: place.c || undefined, limit }),
    !!place.ws
  )
  return (
    <Page
      title="Activity"
      crumbs={[names(place.ws).name]}
      actions={
        <Select
          placeholder="Every collection"
          clearable
          className="mono"
          data={tablesIn(catalog, place.ws).map((t) => t.name)}
          value={place.c || null}
          onChange={(c) => place.set({ c })}
        />
      }
    >
      <Problem error={found.error} />
      {found.isSuccess && !found.data.length && (
        <Empty>
          No revision that you may read. A workspace's owners read its revisions; each row shows
          only the columns its reader may read.
        </Empty>
      )}
      <Table highlightOnHover verticalSpacing="xs">
        <Table.Tbody>
          {(found.data ?? []).map((h) => (
            <Table.Tr key={h.id} onClick={() => setOpen(h)} style={{ cursor: 'pointer' }}>
              <Table.Td className="mono" c="dimmed">
                {h.at.slice(0, 16)}
              </Table.Td>
              <Table.Td>
                <Operation name={h.operation} />
              </Table.Td>
              <Table.Td className="mono">{h.table_name}</Table.Td>
              <Table.Td className="mono" c="dimmed">
                {textOf((h.after_row ?? h.before_row)?.id).slice(0, 8)}
              </Table.Td>
              <Table.Td className="mono">{h.actor}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {found.data?.length === limit && limit < 500 && (
        <Button variant="default" mt="md" onClick={() => setLimit(limit + 200)}>
          Older
        </Button>
      )}
      <Revision open={open} onClose={() => setOpen(null)} />
    </Page>
  )
}

/** One revision: what it changed, field by field, and what the reader may see of it. */
function Revision({ open, onClose }: { open: ActivityInfo | null; onClose(): void }) {
  const keys = open
    ? [...new Set([...Object.keys(open.before_row ?? {}), ...Object.keys(open.after_row ?? {})])]
    : []
  return (
    <Drawer
      opened={!!open}
      onClose={onClose}
      position="right"
      size={760}
      title={
        open && (
          <Group>
            <Operation name={open.operation} />
            <Text className="mono">
              {open.schema_name}.{open.table_name}
            </Text>
          </Group>
        )
      }
    >
      {open && (
        <>
          <Text fz="sm" c="dimmed" mb="sm">
            By <span className="mono">{open.actor}</span> at <span className="mono">{open.at}</span>
            , in transaction <span className="mono">{open.transaction_id}</span>. A field withheld
            from you in the collection is withheld here too.
          </Text>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Field</Table.Th>
                <Table.Th>Before</Table.Th>
                <Table.Th>After</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {keys.map((key) => {
                const [before, after] = [
                  textOf(open.before_row?.[key]),
                  textOf(open.after_row?.[key]),
                ]
                return (
                  <Table.Tr
                    key={key}
                    bg={before !== after && open.operation === 'UPDATE' ? 'orange.0' : undefined}
                  >
                    <Table.Td className="mono">{key}</Table.Td>
                    <Table.Td className="mono">{before}</Table.Td>
                    <Table.Td className="mono">{after}</Table.Td>
                  </Table.Tr>
                )
              })}
            </Table.Tbody>
          </Table>
        </>
      )}
    </Drawer>
  )
}
