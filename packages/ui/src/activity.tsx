import { Button, Drawer, Group, Select, Table, Text, Textarea } from '@mantine/core'
import { activity, type ActivityInfo, type Result, tablesIn } from '@platform/core'
import { Play } from 'lucide-react'
import { useState } from 'react'
import { Empty, Page, Problem, Tag } from './bits.tsx'
import { textOf } from './fields.tsx'
import { useDb, usePlace, useSession } from './session.tsx'
import { useNames } from './shell.tsx'

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
  const keys = open
    ? [...new Set([...Object.keys(open.before_row ?? {}), ...Object.keys(open.after_row ?? {})])]
    : []
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
      <Drawer
        opened={!!open}
        onClose={() => setOpen(null)}
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
              By <span className="mono">{open.actor}</span> at{' '}
              <span className="mono">{open.at}</span>, in transaction{' '}
              <span className="mono">{open.transaction_id}</span>. A field withheld from you in the
              collection is withheld here too.
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
    </Page>
  )
}

/** One statement at a time, run as the reader, on a login of its own that is closed afterwards. */
export function Sql() {
  const { db, refresh } = useSession()
  const [text, setText] = useState('SELECT session_user, current_user;')
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [running, setRunning] = useState(false)
  const [history, setHistory] = useState<string[]>([])
  const run = async () => {
    setRunning(true)
    setError(null)
    try {
      setResult(await db.own((one) => one.query(text.trim().replace(/;\s*$/, ''))))
      setHistory((all) => [text, ...all.filter((one) => one !== text)].slice(0, 20))
      // A statement may change the model or what the reader may reach.
      if (!/^\s*(select|show|explain|table|values)\b/i.test(text)) await refresh()
    } catch (refused) {
      setResult(null)
      setError(refused)
    } finally {
      setRunning(false)
    }
  }
  const rows = result?.rows ?? []
  return (
    <Page
      title="SQL"
      crumbs={['Ask the database']}
      actions={
        <Button leftSection={<Play size={16} />} loading={running} onClick={run}>
          Run
        </Button>
      }
    >
      <Textarea
        className="mono"
        autosize
        minRows={6}
        maxRows={24}
        value={text}
        onChange={(e) => setText(e.currentTarget.value)}
        onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && run()}
        description="One statement, with your own rights: PostgreSQL checks every GRANT, REVOKE, CREATE and DROP. There is no sandbox. BEGIN or SET ROLE cannot carry over to the next run; use psql for scripts."
      />
      <Problem error={error} />
      {result && (
        <>
          <Text fz="sm" c="dimmed" my="sm">
            <span className="mono">{result.command}</span> ·{' '}
            {result.fields.length
              ? `${rows.length} row${rows.length === 1 ? '' : 's'}`
              : `${result.rowCount ?? 0} affected`}
          </Text>
          {result.fields.length > 0 && (
            <Table.ScrollContainer minWidth={400}>
              <Table withTableBorder striped>
                <Table.Thead>
                  <Table.Tr>
                    {result.fields.map((f, at) => (
                      <Table.Th key={String(at)} className="mono">
                        {f.name}
                      </Table.Th>
                    ))}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {rows.slice(0, 500).map((row, at) => (
                    <Table.Tr key={String(at)}>
                      {result.fields.map((f, cell) => (
                        <Table.Td key={String(cell)} className="mono">
                          {row[f.name] === null ? (
                            <Text span c="dimmed">
                              null
                            </Text>
                          ) : (
                            textOf(row[f.name])
                          )}
                        </Table.Td>
                      ))}
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
          {rows.length > 500 && (
            <Text fz="sm" c="dimmed">
              The first 500 rows are shown.
            </Text>
          )}
        </>
      )}
      {history.length > 0 && (
        <>
          <Text fw={650} mt="xl" mb="xs">
            This page's history
          </Text>
          {history.map((one) => (
            <Text
              key={one}
              className="mono"
              fz="sm"
              lineClamp={1}
              style={{ cursor: 'pointer' }}
              onClick={() => setText(one)}
            >
              {one}
            </Text>
          ))}
        </>
      )}
    </Page>
  )
}
