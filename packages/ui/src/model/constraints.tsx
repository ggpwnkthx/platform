import {
  checkConstraintStatement,
  columnTypes,
  constraintsOf,
  deleteRule,
  dropConstraintStatement,
  dropIndexStatement,
  foreignKeyStatement,
  indexesOf,
  indexStatement,
  InvalidName,
  type OnDelete,
  uniqueConstraintStatement,
} from '@platform/core'
import { SelectArrayInput, SelectInput, TextInput } from 'react-admin'
import { useWatch } from 'react-hook-form'
import { defineKind } from '../data/kinds.ts'
import { Mono } from '../kit/marks.tsx'
import { useSession } from '../session/session.ts'
import {
  CollectionInput,
  choices,
  mono,
  onDelete,
  ownsTable,
  type Place,
  required,
} from './collections.tsx'

/** The keys and rules of a collection: its constraints and its indexes. */
interface ConstraintRow {
  name: string
  type: string
  definition: string
  index: boolean
}
const constraintTypes = [
  { id: 'unique', name: 'Unique: no two rows hold the same' },
  { id: 'check', name: 'Check: every row passes a test' },
  { id: 'foreign', name: 'Foreign key: the field points at a row' },
  { id: 'index', name: 'Index: the rows are found without a scan' },
]
const typeWords: Record<string, string> = {
  p: 'Primary key',
  u: 'Unique',
  c: 'Check',
  f: 'Foreign key',
  x: 'Exclusion',
}
export const constraints = defineKind<
  ConstraintRow,
  Place,
  { type: string; columns: string[]; expression: string; target: string; on_delete: OnDelete }
>({
  name: 'constraints',
  title: 'Keys and rules',
  note: 'The constraints and indexes PostgreSQL holds the collection to.',
  noun: 'key or rule',
  empty: 'This collection holds no key and no rule.',
  async read(_db, { schema, table }, { catalog }) {
    const held = constraintsOf(catalog, schema, table)
    const backing = new Set(held.map((c) => c.name))
    return [
      ...held.map((c) => ({
        name: c.name,
        type: typeWords[c.type] ?? c.type,
        definition: c.definition + (c.on_delete ? ` — ${deleteRule(c.on_delete)}` : ''),
        index: false,
      })),
      ...indexesOf(catalog, schema, table)
        .filter((i) => !backing.has(i.name))
        .map((i) => ({
          name: i.name,
          type: i.unique ? 'Unique index' : 'Index',
          definition: `(${i.columns.join(', ')})`,
          index: true,
        })),
    ]
  },
  key: (row) => row.name,
  columns: [
    { source: 'name', label: 'Name', render: (row) => <Mono>{row.name}</Mono> },
    { source: 'type', label: 'Kind' },
    {
      source: 'definition',
      label: 'As PostgreSQL holds it',
      render: (row) => <Mono title={row.definition}>{row.definition}</Mono>,
    },
  ],
  may: ownsTable,
  defaults: () => ({ type: 'unique', columns: [], on_delete: 'restrict' }),
  Inputs({ where }) {
    const { catalog } = useSession()
    const type = useWatch({ name: 'type' })
    const fields = catalog.columns
      .filter((c) => c.schema === where.schema && c.table === where.table)
      .map((c) => c.name)
    return (
      <>
        <SelectInput source="type" label="Kind" choices={constraintTypes} helperText={false} />
        {type !== 'check' && (
          <SelectArrayInput
            source="columns"
            label={type === 'foreign' ? 'Field' : 'Fields'}
            choices={choices(fields)}
            {...mono}
          />
        )}
        {type === 'check' && (
          <TextInput source="expression" label="The test, in SQL" multiline minRows={2} {...mono} />
        )}
        {type === 'foreign' && (
          <CollectionInput source="target" label="Points at" schema={where.schema} />
        )}
        {type === 'foreign' && (
          <SelectInput
            source="on_delete"
            label="When that row is deleted"
            choices={onDelete}
            helperText={false}
          />
        )}
      </>
    )
  },
  create(form, { schema, table }) {
    const columns = form.columns ?? []
    if (form.type === 'check')
      return [checkConstraintStatement(schema, table, form.expression ?? '')]
    if (form.type === 'index') return [indexStatement(schema, table, columns)]
    if (form.type === 'unique') return [uniqueConstraintStatement(schema, table, columns)]
    if (columns.length !== 1)
      throw new InvalidName('A relation is one field that points at one row.')
    const target = required(form.target, 'Choose the collection the field points at.')
    return [
      foreignKeyStatement(schema, table, columns[0]!, { schema, table: target }, form.on_delete),
    ]
  },
  remove: (row, { schema, table }) => [
    row.index
      ? dropIndexStatement(schema, row.name)
      : dropConstraintStatement(schema, table, row.name),
  ],
})

export const fieldTypeChoices = [
  ...Object.keys(columnTypes).map((id) => ({ id, name: id })),
  { id: 'relation', name: 'relation: points at a row of another collection' },
]
