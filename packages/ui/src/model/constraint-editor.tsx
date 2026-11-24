import { MultiSelect, Select, Text, Textarea, TextInput } from '@mantine/core'
import {
  checkConstraintStatement,
  foreignKeyStatement,
  onDeleteActions,
  type OnDelete,
  uniqueConstraintStatement,
} from '@platform/core'
import { Change } from '../bits/change.tsx'
import type { Field } from '../fields/types.ts'
import type { Draft, Kind } from './constraint-shared.ts'

/**
 * The editor of a constraint: what it is, and the statement it writes. Every statement is
 * shown before it runs, as the reader's own SQL, and PostgreSQL is the judge of it.
 */
export function ConstraintEditor({
  schema,
  table,
  fields,
  tables,
  draft,
  onChange,
  onClose,
}: {
  schema: string
  table: string
  fields: Field[]
  tables: { schema: string; name: string }[]
  draft: Draft
  onChange(draft: Draft): void
  onClose(): void
}) {
  const set = (changes: Partial<Draft>) => onChange({ ...draft, ...changes })
  const names = fields.filter((f) => f.column).map((f) => f.name)
  // A key may point at a collection of another workspace: the target is named with its
  // schema, and the workspace it belongs to is shown when it is not this one.
  const other = tables
    .filter((one) => !(one.schema === schema && one.name === table))
    .map((one) => ({
      value: `${one.schema}.${one.name}`,
      label: one.schema === schema ? one.name : `${one.schema}.${one.name}`,
    }))
  return (
    <Change
      title="New constraint"
      opened
      onClose={onClose}
      statements={() => {
        const name = draft.name.trim() || undefined
        if (draft.kind === 'unique') {
          if (!draft.columns.length) throw new Error('Choose the fields the key is over.')
          return [uniqueConstraintStatement(schema, table, draft.columns, name)]
        }
        if (draft.kind === 'check') {
          if (!draft.expression.trim()) throw new Error('Say what the check tests.')
          return [checkConstraintStatement(schema, table, draft.expression, name, draft.columns[0])]
        }
        const column = draft.columns[0]
        if (!column) throw new Error('Choose the field the key is on.')
        if (!draft.target) throw new Error('Choose the collection the key points at.')
        const [target_schema = schema, target_table = ''] = draft.target.split('.')
        return [
          foreignKeyStatement(
            schema,
            table,
            column,
            { schema: target_schema, table: target_table },
            draft.onDelete,
            name
          ),
        ]
      }}
    >
      <Select
        label="What kind of constraint"
        allowDeselect={false}
        data={[
          { value: 'unique', label: 'Unique — the row is held once' },
          { value: 'check', label: 'Check — every row is held by the expression' },
          { value: 'foreign', label: 'Foreign key — the row points at another' },
        ]}
        value={draft.kind}
        onChange={(kind) => set({ kind: (kind as Kind) ?? 'unique' })}
      />
      {draft.kind === 'unique' && (
        <MultiSelect
          label="The fields the key is over"
          data={names}
          value={draft.columns}
          onChange={(columns) => set({ columns })}
          searchable
        />
      )}
      {draft.kind === 'check' && (
        <>
          <Textarea
            label="The expression every row is held by"
            description="PostgreSQL's own SQL, as a policy's is."
            autosize
            minRows={3}
            className="mono"
            value={draft.expression}
            onChange={(e) => set({ expression: e.target.value })}
          />
          <Select
            label="About which field"
            description="Only for the name: PostgreSQL calls a check after the field it is about."
            data={names}
            clearable
            value={draft.columns[0] ?? null}
            onChange={(column) => set({ columns: column ? [column] : [] })}
          />
        </>
      )}
      {draft.kind === 'foreign' && (
        <>
          <Select
            label="The field the key is on"
            data={names}
            value={draft.columns[0] ?? null}
            onChange={(column) => set({ columns: column ? [column] : [] })}
            searchable
          />
          <Select
            label="Points at"
            data={other}
            value={draft.target || null}
            onChange={(target) => set({ target: target ?? '' })}
            searchable
          />{' '}
          <Select
            label="When that row goes"
            allowDeselect={false}
            data={Object.keys(onDeleteActions)}
            value={draft.onDelete}
            onChange={(rule) => set({ onDelete: (rule as OnDelete) ?? 'restrict' })}
          />
        </>
      )}
      <TextInput
        label="Name"
        description="Left empty, PostgreSQL's own name is used."
        className="mono"
        value={draft.name}
        onChange={(e) => set({ name: e.target.value })}
      />
      <Text fz="xs" c="dimmed">
        The statement is shown below, and runs as you, in one transaction.
      </Text>
    </Change>
  )
}
