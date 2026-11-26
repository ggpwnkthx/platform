import { Alert, Box, Button, Drawer, Stack, Typography } from '@mui/material'
import { useMutation } from '@tanstack/react-query'
import { FileDown, FileUp } from 'lucide-react'
import { useRef, useState } from 'react'
import { useListContext, useNotify, useRefresh } from 'react-admin'
import tokens from 'virtual:design-tokens'
import { exportCsv, importCsv, type Plan, planImport } from '../data/transfer.ts'
import { Tip } from '../kit/Header.tsx'
import { iconSize, Mono } from '../kit/marks.tsx'
import { Refusal } from '../kit/said.tsx'
import { formColumn } from '../theme.ts'

/** The rows in view, saved as a CSV file: what the reader may read, filtered and sorted as shown. */
export function ExportCsv({ resource }: { resource: string }) {
  const { filterValues, sort } = useListContext()
  const notify = useNotify()
  const save = useMutation({
    mutationFn: () =>
      exportCsv(resource, { filter: filterValues, sort, pagination: { page: 1, perPage: 10000 } }),
    onSuccess({ csv, count, total }) {
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
      const link = Object.assign(document.createElement('a'), {
        href: url,
        download: `${resource}.csv`,
      })
      link.click()
      URL.revokeObjectURL(url)
      notify(
        total > count
          ? `The first ${count} of ${total} rows were saved.`
          : `${count} rows were saved.`,
        {
          type: 'success',
        }
      )
    },
    onError: (error) => notify(String((error as Error).message), { type: 'error' }),
  })
  return (
    <Tip title="Save as CSV">
      <Button
        variant="outlined"
        aria-label="Save as CSV"
        loading={save.isPending}
        startIcon={<FileDown size={iconSize} />}
        onClick={() => save.mutate()}
      />
    </Tip>
  )
}

/** Rows added from a CSV file: its columns matched to columns by name, shown, then written as one transaction. */
export function ImportCsv({ resource }: { resource: string }) {
  const input = useRef<HTMLInputElement>(null)
  const [plan, setPlan] = useState<Plan | null>(null)
  const notify = useNotify()
  const refresh = useRefresh()
  const write = useMutation({
    mutationFn: (p: Plan) => importCsv(resource, p),
    onSuccess(count) {
      notify(`${count} rows were added, as you.`, { type: 'success' })
      setPlan(null)
      refresh()
    },
  })
  const read = async (file?: File) => {
    if (!file) return
    write.reset()
    setPlan(await planImport(resource, await file.text()))
    if (input.current) input.current.value = ''
  }
  const unmatched = plan?.header.filter((_h, i) => !plan.columns[i]) ?? []
  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".csv,text/csv"
        hidden
        onChange={(e) => read(e.target.files?.[0])}
      />
      <Tip title="Insert rows from a CSV file">
        <Button
          variant="outlined"
          aria-label="Insert rows from a CSV file"
          startIcon={<FileUp size={iconSize} />}
          onClick={() => input.current?.click()}
        />
      </Tip>
      <Drawer
        anchor="right"
        open={!!plan}
        onClose={() => setPlan(null)}
        slotProps={{ paper: { sx: { width: tokens.layout.drawer, maxWidth: '100vw' } } }}
      >
        {plan && (
          <Stack spacing={4} sx={{ p: 6, ...formColumn }}>
            <Typography variant="h3">Insert rows from a CSV file</Typography>
            <Typography variant="body2">
              {plan.rows.length} rows, each written as one INSERT as you, in one transaction: if
              PostgreSQL refuses one, none is written. An empty cell gives nothing, so the column's
              default applies.
            </Typography>
            <Box component="ul" sx={{ m: 0, pl: 5 }}>
              {plan.header.map((h, i) =>
                plan.columns[i] ? (
                  <li key={h}>
                    <Mono>{h}</Mono> → {plan.columns[i]!.label}
                  </li>
                ) : null
              )}
            </Box>
            {unmatched.length > 0 && (
              <Alert severity="warning">
                Left out, as no column you may write is named so: {unmatched.join(', ')}
              </Alert>
            )}
            <Refusal error={write.error} />
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
              <Button variant="outlined" onClick={() => setPlan(null)}>
                Cancel
              </Button>
              <Button
                variant="contained"
                loading={write.isPending}
                disabled={!plan.rows.length || plan.columns.every((c) => !c)}
                onClick={() => write.mutate(plan)}
              >
                Add {plan.rows.length} rows
              </Button>
            </Box>
          </Stack>
        )}
      </Drawer>
    </>
  )
}
