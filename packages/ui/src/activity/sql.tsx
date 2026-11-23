import { Button, Table, Text, Textarea } from '@mantine/core'
import type { Result } from '@platform/core'
import { Play } from 'lucide-react'
import { useState } from 'react'
import { Page, Problem } from '../bits/page.tsx'
import { textOf } from '../fields/values.tsx'
import { useSession } from '../session/context.ts'
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
