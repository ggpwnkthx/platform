import { Box, Button, Drawer, Stack, Typography } from '@mui/material'
import { useMutation } from '@tanstack/react-query'
import { type ReactNode, useEffect, useMemo, useRef } from 'react'
import { Form, useDataProvider, useNotify, useRefresh } from 'react-admin'
import { useWatch } from 'react-hook-form'
import tokens from 'virtual:design-tokens'
import type { Provider, Refused } from '../data/provider.ts'
import { formColumn } from '../theme.ts'
import { Refusal, Statement, type Standing } from './said.tsx'

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
  /** False where the statements cannot run inside a transaction: each runs on its own. */
  atomic?: boolean
  /** Called with the form once its statements have run: a rename follows the thing to its new name. */
  onRan?(form: Record<string, unknown>): void
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
      const sql = props.statements(form)
      // A kind says only what a change is; a form that asks for none is said here, once for all.
      if (!sql.length) throw new Error('Nothing is changed yet.')
      return { sql, problem: null }
    } catch (problem) {
      return { sql: [], problem: problem instanceof Error ? problem.message : String(problem) }
    }
  }, [props.statements, form])
  const asked = useRef(form)
  const run = useMutation({
    mutationFn: (sql: string[]) => provider.run(sql, props.atomic !== false),
    onSuccess(_done, sql) {
      props.onRan?.(asked.current)
      notify(`${props.title}: ${sql.length} statement${sql.length === 1 ? '' : 's'} ran as you.`, {
        type: 'success',
      })
      refresh()
    },
  })
  // The committed statement stays in view for a moment, so the reader sees what ran.
  const { onClose } = props
  useEffect(() => {
    if (!run.isSuccess) return
    const closing = setTimeout(onClose, Number.parseFloat(tokens.motion.hold!))
    return () => clearTimeout(closing)
  }, [run.isSuccess, onClose])
  // A refusal points into the statement that was refused, and only while that is still the one shown.
  const refused = run.isError && run.variables?.join('\0') === change.sql.join('\0')
  const standing: Standing = run.isPending
    ? 'running'
    : run.isSuccess
      ? 'ran'
      : refused
        ? 'refused'
        : 'shown'
  return (
    <Stack spacing={4} sx={{ p: 6, ...formColumn }} data-change>
      <Typography variant="h3">{props.title}</Typography>
      {props.children}
      {change.problem && (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {change.problem}
        </Typography>
      )}
      <Statement
        sql={change.sql}
        standing={standing}
        fault={refused ? (run.error as Refused).fault : null}
      />
      <Refusal error={run.error} />
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
        <Button variant="outlined" onClick={props.onClose}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color={props.danger ? 'error' : 'primary'}
          loading={run.isPending}
          disabled={!change.sql.length || run.isSuccess}
          onClick={() => {
            asked.current = form
            run.mutate(change.sql)
          }}
        >
          {props.label ?? 'Run'}
        </Button>
      </Box>
    </Stack>
  )
}
