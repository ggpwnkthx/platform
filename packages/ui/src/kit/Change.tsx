import { Box, Button, Drawer, Stack, Typography } from '@mui/material'
import { useMutation } from '@tanstack/react-query'
import { type ReactNode, useMemo } from 'react'
import { Form, useDataProvider, useNotify, useRefresh } from 'react-admin'
import { useWatch } from 'react-hook-form'
import tokens from 'virtual:design-tokens'
import type { Provider } from '../data/provider.ts'
import { formColumn } from '../theme.ts'
import { Refusal, Statement } from './said.tsx'

/**
 * Every change to the model or to access goes through here: the form, the SQL it writes —
 * shown before the button that runs it — and PostgreSQL's answer. Nothing runs unseen, and
 * what runs is exactly what is shown: one transaction, as the reader.
 */
export interface ChangeProps {
  title: string
  onClose(): void
  /** What the form starts with. */
  defaults?: object
  /** The statements the form asks for; throwing says why there are none yet. */
  statements(form: Record<string, unknown>): string[]
  label?: string
  danger?: boolean
  children?: ReactNode
}
export function Change(props: ChangeProps) {
  return (
    <Drawer
      anchor="right"
      open
      onClose={props.onClose}
      slotProps={{ paper: { sx: { width: tokens.layout.drawer, maxWidth: '100vw' } } }}
    >
      <Form defaultValues={props.defaults ?? {}} sanitizeEmptyValues={false} noValidate>
        <Body {...props} />
      </Form>
    </Drawer>
  )
}
function Body(props: ChangeProps) {
  const form = useWatch()
  const provider = useDataProvider<Provider>()
  const notify = useNotify()
  const refresh = useRefresh()
  const change = useMemo(() => {
    try {
      return { sql: props.statements(form), problem: null }
    } catch (problem) {
      return { sql: [], problem: problem instanceof Error ? problem.message : String(problem) }
    }
  }, [props.statements, form])
  const run = useMutation({
    mutationFn: (sql: string[]) => provider.run(sql),
    onSuccess(_done, sql) {
      notify(`${props.title}: ${sql.length} statement${sql.length === 1 ? '' : 's'} ran as you.`, {
        type: 'success',
      })
      refresh()
      props.onClose()
    },
  })
  return (
    <Stack spacing={4} sx={{ p: 6, ...formColumn }} data-change>
      <Typography variant="h3">{props.title}</Typography>
      {props.children}
      {change.problem && (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {change.problem}
        </Typography>
      )}
      <Statement sql={change.sql} />
      <Refusal error={run.error} />
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
        <Button variant="outlined" onClick={props.onClose}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color={props.danger ? 'error' : 'primary'}
          loading={run.isPending}
          disabled={!change.sql.length}
          onClick={() => run.mutate(change.sql)}
        >
          {props.label ?? 'Run'}
        </Button>
      </Box>
    </Stack>
  )
}
