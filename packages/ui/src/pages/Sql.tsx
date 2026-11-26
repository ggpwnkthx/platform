import { Alert, Box, Button, FormControlLabel, Switch, TextField, Typography } from '@mui/material'
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
import { textOf } from '../columns/values.tsx'
import { Play, ScanSearch } from 'lucide-react'
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
  const [script, setScript] = useState(false)
  const [analyze, setAnalyze] = useState(false)
  const run = useMutation({
    mutationFn: (ask: { explain?: 'plan' | 'analyze' }) => provider.sql(text, { script, ...ask }),
  })
  const go = () => run.mutate({})
  const explain = () => run.mutate({ explain: analyze ? 'analyze' : 'plan' })
  return (
    <Page
      title="Ask the database"
      crumb="SQL"
      actions={
        <>
          <Tip
            title={analyze ? 'Explain: run it, show its plan, undo it' : 'Explain: show its plan'}
          >
            <Button
              variant="outlined"
              aria-label="Explain"
              disabled={!text.trim() || script}
              startIcon={<ScanSearch size={iconSize} />}
              onClick={explain}
            >
              Explain
            </Button>
          </Tip>
          <Tip title="Run" labelled>
            <Button
              variant="contained"
              aria-label="Run"
              loading={run.isPending}
              disabled={!text.trim()}
              startIcon={<Play size={iconSize} />}
              onClick={go}
            >
              Run
            </Button>
          </Tip>
        </>
      }
    >
      <Section
        title={script ? 'Statements, as you' : 'One statement, as you'}
        note="It runs on a login of its own with your role's authority, prepared, so nothing rides along with it, and nothing carries over to the next. Several statements are sent one at a time in one transaction, and one refused undoes them all. Ctrl-Enter (⌘-Enter on a Mac) runs it. PostgreSQL's own answer is shown, with what it warned of."
      >
        <TextField
          multiline
          minRows={4}
          fullWidth
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && text.trim()) go()
          }}
          slotProps={{
            htmlInput: { 'aria-label': 'Statement', className: 'mono', spellCheck: false },
          }}
        />
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          <FormControlLabel
            control={<Switch checked={script} onChange={(_e, on) => setScript(on)} />}
            label="A script: run in order, in one transaction"
          />
          <FormControlLabel
            control={<Switch checked={analyze} onChange={(_e, on) => setAnalyze(on)} />}
            label="Explain runs it, measures it, and undoes it (ANALYZE)"
          />
        </Box>
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
        {run.data?.plan && (
          <Box
            component="pre"
            className="mono"
            data-plan
            sx={{ m: 0, p: 4, overflowX: 'auto', bgcolor: 'action.hover', borderRadius: 1 }}
          >
            {run.data.plan}
          </Box>
        )}
        {run.data && !run.data.plan && (
          <Typography variant="body2" sx={{ color: 'text.secondary' }} data-answer>
            {run.data.statements > 1 &&
              `${run.data.statements} statements ran in one transaction; the last answered `}
            <Mono>{run.data.command}</Mono> {run.data.count ?? 0} row
            {run.data.count === 1 ? '' : 's'}
            {run.data.rows.length > 500 && '; the first 500 are shown'}
          </Typography>
        )}
        {run.data && !run.data.plan && run.data.fields.length > 0 && <Rows result={run.data} />}
      </Section>
    </Page>
  )
}
