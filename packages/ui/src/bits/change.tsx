import { Button, Drawer, Group, Stack, Text } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { type ReactNode, useMemo, useState } from 'react'
import { useSession } from '../session/context.ts'
import { Problem, Statements } from './page.tsx'

/**
 * Every change to the model or to access goes through here: the form, the SQL it writes —
 * shown before the button that runs it — and PostgreSQL's answer. Nothing runs unseen.
 */
export function Change(props: {
  title: string
  opened: boolean
  onClose: () => void
  /** The statements the form asks for; throwing says why there are none yet. */
  statements: () => string[]
  label?: string
  danger?: boolean
  /** Withholds the button until the form is ready, e.g. a name typed to confirm. */
  ready?: boolean
  done?: () => void
  children?: ReactNode
}) {
  const { run } = useSession()
  const [error, setError] = useState<unknown>(null)
  const [running, setRunning] = useState(false)
  const change = useMemo(() => {
    try {
      return { sql: props.statements(), problem: null }
    } catch (problem) {
      return { sql: [], problem: problem instanceof Error ? problem.message : String(problem) }
    }
  }, [props.statements])
  const close = () => {
    setError(null)
    props.onClose()
  }
  const submit = async () => {
    setRunning(true)
    setError(null)
    try {
      await run(change.sql)
      notifications.show({
        color: 'green',
        title: props.title,
        message: `${change.sql.length} statement${change.sql.length === 1 ? '' : 's'} ran as you.`,
      })
      close()
      props.done?.()
    } catch (refused) {
      setError(refused)
    } finally {
      setRunning(false)
    }
  }
  return (
    <Drawer
      opened={props.opened}
      onClose={close}
      title={
        <Text fw={650} fz={19}>
          {props.title}
        </Text>
      }
      position="right"
      size={560}
    >
      <Stack>
        {props.children}
        {change.problem && (
          <Text fz="sm" c="dimmed">
            {change.problem}
          </Text>
        )}
        <Statements sql={change.sql} />
        <Problem error={error} />
        <Group justify="flex-end">
          <Button variant="default" onClick={close}>
            Cancel
          </Button>
          <Button
            color={props.danger ? 'red' : undefined}
            loading={running}
            disabled={!change.sql.length || props.ready === false}
            onClick={submit}
          >
            {props.label ?? 'Run'}
          </Button>
        </Group>
      </Stack>
    </Drawer>
  )
}
