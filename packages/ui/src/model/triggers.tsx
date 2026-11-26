import {
  dropTriggerStatement,
  enableTriggerStatement,
  renameTriggerStatement,
  triggerEvents,
  triggerStatement,
  triggerTimings,
  type TriggerDraft,
} from '@platform/core'
import { BooleanInput, SelectArrayInput, SelectInput, TextInput, useGetList } from 'react-admin'
import {
  defineKind,
  choices,
  mono,
  ownsTable,
  type Place,
  required,
  fromView,
} from '../data/kinds.ts'
import { Mono, Tag } from '../kit/marks.tsx'
import type { RoutineRow } from './routines.tsx'

/**
 * A table's own triggers: a function PostgreSQL calls when rows are written. The
 * triggers that stamp rows and write their history are the platform's, are not listed here,
 * and are kept by the guard.
 */
interface TriggerRow {
  name: string
  definition: string
  function: string
  enabled: boolean
}
type TriggerForm = Omit<TriggerDraft, 'schema' | 'table'> & { enabled: boolean }
function TriggerInputs({ where, row }: { where: Place; row?: TriggerRow }) {
  const found = useGetList<RoutineRow & { id: string }>('routines', {
    filter: { schema: where.schema },
    pagination: { page: 1, perPage: 1000 },
  })
  const functions = (found.data ?? [])
    .filter((r) => r.returns === 'trigger')
    .map((r) => r.signature)
  return (
    <>
      <TextInput source="name" label="Name" {...mono} />
      {row ? (
        <BooleanInput source="enabled" label="Fires (enabled)" helperText={false} />
      ) : (
        <>
          <SelectInput
            source="timing"
            label="When"
            choices={choices([...triggerTimings])}
            {...mono}
          />
          <SelectArrayInput
            source="events"
            label="On"
            choices={choices([...triggerEvents])}
            {...mono}
          />
          <BooleanInput
            source="row"
            label="FOR EACH ROW (off: FOR EACH STATEMENT)"
            helperText={false}
          />
          <SelectInput
            source="function"
            label="EXECUTE FUNCTION: a function of this schema that returns trigger"
            choices={choices(functions)}
            {...mono}
          />
          <TextInput
            source="when"
            label="WHEN: a condition on OLD and NEW (empty: always)"
            {...mono}
          />
        </>
      )}
    </>
  )
}
export const triggers = defineKind<TriggerRow, Place, TriggerForm>({
  name: 'triggers',
  title: 'Triggers',
  note: 'A trigger executes a function when rows are written: BEFORE, to change or reject the row, or AFTER, to act on it.',
  noun: 'trigger',
  empty: 'No triggers but the platform’s own.',
  read: fromView<TriggerRow>('catalog_triggers', ['schema', 'table'], 'name'),
  key: (row) => row.name,
  columns: [
    { source: 'name', label: 'Trigger', render: (row) => <Mono>{row.name}</Mono> },
    {
      source: 'definition',
      label: 'Definition',
      render: (row) => (
        <Mono title={row.definition}>{row.definition.replace(/^CREATE TRIGGER \S+ /, '')}</Mono>
      ),
    },
    {
      source: 'enabled',
      label: '',
      render: (row) => !row.enabled && <Tag color="warning">disabled</Tag>,
    },
  ],
  may: ownsTable,
  Inputs: TriggerInputs,
  defaults: (_where, row) =>
    row
      ? { name: row.name, enabled: row.enabled }
      : { timing: 'BEFORE', events: ['INSERT', 'UPDATE'], row: true },
  create: (form, { schema, table }) => [triggerStatement({ ...form, schema, table })],
  update(form, { schema, table }, row) {
    const name = required(form.name, 'Name the trigger.')
    const out =
      !!form.enabled !== row.enabled
        ? [enableTriggerStatement(schema, table, row.name, !!form.enabled)]
        : []
    if (name !== row.name) out.push(renameTriggerStatement(schema, table, row.name, name))
    return out
  },
  remove: (row, { schema, table }) => [dropTriggerStatement(schema, table, row.name)],
})
