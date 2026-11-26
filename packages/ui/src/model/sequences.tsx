import {
  alterSequenceStatement,
  dropSequenceStatement,
  sequenceStatement,
  type SequenceDraft,
} from '@platform/core'
import { BooleanInput, NumberInput, SelectInput, TextInput } from 'react-admin'
import { defineKind, choices, mono, required, fromView, createsIn } from '../data/kinds.ts'
import { Mono, Tag } from '../kit/marks.tsx'

/** A schema's sequences: the counters PostgreSQL draws numbers from, one at a time. */
interface SequenceRow {
  schema: string
  name: string
  type: string
  start: number
  increment: number
  minimum: number
  maximum: number
  cycle: boolean
  owned_by: string | null
  can_alter: boolean
}
type SequenceForm = Omit<SequenceDraft, 'schema'>
const number = (source: string, label: string) => (
  <NumberInput source={source} label={label} helperText={false} />
)
export const sequences = defineKind<SequenceRow, { schema: string }, SequenceForm>({
  name: 'sequences',
  title: 'Sequences',
  note: 'A sequence hands out numbers in order, each once, even to writers that run at the same time. An identity column keeps one of its own.',
  noun: 'sequence',
  empty: 'This schema holds no sequence that you may see.',
  read: fromView<SequenceRow>('catalog_sequences', ['schema'], 'name'),
  key: (row) => row.name,
  columns: [
    { source: 'name', label: 'Sequence', render: (row) => <Mono>{row.name}</Mono> },
    {
      source: 'increment',
      label: 'Counts',
      render: (row) =>
        `${row.type}, from ${row.start} by ${row.increment}${row.cycle ? ', and starts again' : ''}`,
    },
    {
      source: 'owned_by',
      label: 'Member of',
      render: (row) => row.owned_by && <Tag>{row.owned_by}</Tag>,
    },
  ],
  may: createsIn,
  mayRow: (row) => row.can_alter,
  Inputs: ({ row }) => (
    <>
      {!row && <TextInput source="name" label="Name" {...mono} />}
      {!row && (
        <SelectInput
          source="type"
          label="Numbers of"
          choices={choices(['smallint', 'integer', 'bigint'])}
          helperText={false}
        />
      )}
      {number('start', row ? 'Start again from (RESTART)' : 'Starts from')}
      {number('increment', 'Counts by')}
      {number('minimum', 'Least value')}
      {number('maximum', 'Greatest value')}
      <BooleanInput
        source="cycle"
        label="Starts again after its greatest value"
        helperText={false}
      />
    </>
  ),
  defaults: (_where, row) =>
    row
      ? { increment: row.increment, minimum: row.minimum, maximum: row.maximum, cycle: row.cycle }
      : { type: 'bigint', cycle: false },
  create: (form, { schema }) => [
    sequenceStatement({ ...form, schema, name: required(form.name, 'Name the sequence.') }),
  ],
  update(form, { schema }, row) {
    const changed = <K extends keyof SequenceForm>(key: K, held: unknown) =>
      form[key] !== undefined && form[key] !== null && String(form[key]) !== String(held)
        ? form[key]
        : undefined
    const statement = alterSequenceStatement(schema, row.name, {
      start: changed('start', null) as number | undefined,
      increment: changed('increment', row.increment) as number | undefined,
      minimum: changed('minimum', row.minimum) as number | undefined,
      maximum: changed('maximum', row.maximum) as number | undefined,
      cycle: !!form.cycle !== row.cycle ? !!form.cycle : undefined,
    })
    return statement ? [statement] : []
  },
  loses: () =>
    'Columns that draw their default from it are refused by PostgreSQL until they no longer do.',
  remove: (row, { schema }) => [dropSequenceStatement(schema, row.name)],
})
