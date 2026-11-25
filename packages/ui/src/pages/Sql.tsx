import { Alert, Button, TextField, Typography } from '@mui/material'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import {
  DataTable,
  ListContextProvider,
  ResourceContextProvider,
  useDataProvider,
  useList,
} from 'react-admin'
import type { Provider } from '../data/provider.ts'
import { textOf } from '../fields/values.tsx'
import { Play } from 'lucide-react'
import { Mono, iconSize } from '../kit/marks.tsx'
import { Refusal, Section } from '../kit/said.tsx'
import { Tip } from '../kit/Header.tsx'
import { Page } from '../kit/Page.tsx'
import { Table } from '../kit/Table.tsx'

type Result = Awaited<ReturnType<Provider['sql']>>
function Rows({ result }: { result: Result }) {
  const list = useList({
    data: result.rows.slice(0, 500).map((row, id) => ({ ...row, id })),
    perPage: 500,
  })
  return (
    <ResourceContextProvider value="statement">
      <ListContextProvider value={list}>
        <Table empty="The statement returned no rows." bulkActionButtons={false} rowClick={false}>
          {result.fields.map((name) => (
            <DataTable.Col
              key={name}
              source={name}
              label={<Mono>{name}</Mono>}
              disableSort
              render={(row) => (
                <Mono>{row[name] === null ? <span data-null>null</span> : textOf(row[name])}</Mono>
              )}
            />
          ))}
        </Table>
      </ListContextProvider>
    </ResourceContextProvider>
  )
}

/** One statement, as the reader: PostgreSQL checks it like any other, and there is no sandbox. */
export function Sql() {
  const provider = useDataProvider<Provider>()
  const [text, setText] = useState(
    "SELECT session_user, current_setting('server_version') AS server"
  )
  const run = useMutation({ mutationFn: (statement: string) => provider.sql(statement) })
  return (
    <Page
      title="Ask the database"
      crumb="SQL"
      actions={
        <Tip title="Run">
          <Button
            variant="contained"
            aria-label="Run"
            loading={run.isPending}
            disabled={!text.trim()}
            startIcon={<Play size={iconSize} />}
            onClick={() => run.mutate(text)}
          >
            Run
          </Button>
        </Tip>
      }
    >
      <Section
        title="One statement, as you"
        note="It runs on a login of its own with your role's authority, prepared, so nothing rides along with it, and nothing carries over to the next. Ctrl-Enter (⌘-Enter on a Mac) runs it. PostgreSQL's own answer is shown, with what it warned of."
      >
        <TextField
          multiline
          minRows={4}
          fullWidth
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && text.trim())
              run.mutate(text)
          }}
          slotProps={{
            htmlInput: { 'aria-label': 'Statement', className: 'mono', spellCheck: false },
          }}
        />
        <Refusal error={run.error} />
        {run.data?.notices.map((notice) => (
          <Alert
            key={notice.message}
            severity={notice.severity === 'WARNING' ? 'warning' : 'info'}
            data-notice
          >
            PostgreSQL {notice.severity === 'WARNING' ? 'warned' : 'noted'}: {notice.message}
            {notice.code && ` (${notice.code})`}
          </Alert>
        ))}
        {run.data && (
          <Typography variant="body2" sx={{ color: 'text.secondary' }} data-answer>
            <Mono>{run.data.command}</Mono> {run.data.count ?? 0} row
            {run.data.count === 1 ? '' : 's'}
            {run.data.rows.length > 500 && '; the first 500 are shown'}
          </Typography>
        )}
        {run.data && run.data.fields.length > 0 && <Rows result={run.data} />}
      </Section>
    </Page>
  )
}
