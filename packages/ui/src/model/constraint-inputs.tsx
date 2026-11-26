import {
  checkConstraintStatement,
  exclusionStatement,
  foreignKeyStatement,
  indexDraftStatement,
  indexMethods,
  InvalidName,
  type OnDelete,
  uniqueConstraintStatement,
} from '@platform/core'
import { BooleanInput, SelectArrayInput, SelectInput, TextInput } from 'react-admin'
import { useWatch } from 'react-hook-form'
import { choices, mono, onDelete, type Place, required } from '../data/kinds.ts'
import { useSession } from '../session/session.ts'
import { TableInput } from './tables.tsx'

/** What a new key or rule is: its kind, and what that kind asks. */
export interface ConstraintForm {
  type: string
  name: string
  columns: string[]
  expression: string
  target: string
  on_delete: OnDelete
  on_update: OnDelete
  deferrable: boolean
  not_valid: boolean
  method: (typeof indexMethods)[number]
  unique: boolean
  expressions: string
  include: string[]
  where: string
  validate: boolean
}
const constraintTypes = [
  { id: 'unique', name: 'UNIQUE' },
  { id: 'check', name: 'CHECK' },
  { id: 'foreign', name: 'FOREIGN KEY' },
  { id: 'index', name: 'INDEX' },
  { id: 'exclusion', name: 'EXCLUDE' },
]
const onUpdate = [
  { id: 'restrict', name: 'RESTRICT' },
  { id: 'cascade', name: 'CASCADE' },
  { id: 'set_null', name: 'SET NULL' },
]
const toggle = (source: string, label: string) => (
  <BooleanInput source={source} label={label} helperText={false} />
)

export function NewConstraint({ where }: { where: Place }) {
  const { catalog } = useSession()
  const type = useWatch({ name: 'type' })
  const columnChoices = choices(
    catalog.columns
      .filter((c) => c.schema === where.schema && c.table === where.table)
      .map((c) => c.name)
  )
  return (
    <>
      <SelectInput source="type" label="Kind" choices={constraintTypes} helperText={false} />
      <TextInput source="name" label="Name (empty: PostgreSQL's default name)" {...mono} />
      {['unique', 'foreign', 'index'].includes(type) && (
        <SelectArrayInput
          source="columns"
          label={type === 'foreign' ? 'Column' : 'Columns'}
          choices={columnChoices}
          {...mono}
        />
      )}
      {type === 'check' && (
        <TextInput source="expression" label="CHECK expression" multiline minRows={2} {...mono} />
      )}
      {type === 'exclusion' && (
        <TextInput
          source="expression"
          label="EXCLUDE: USING gist (room WITH =, during WITH &&)"
          multiline
          minRows={2}
          {...mono}
        />
      )}
      {type === 'foreign' && (
        <>
          <TableInput source="target" label="REFERENCES" schema={where.schema} />
          <SelectInput source="on_delete" label="ON DELETE" choices={onDelete} helperText={false} />
          <SelectInput source="on_update" label="ON UPDATE" choices={onUpdate} helperText={false} />
          {toggle('deferrable', 'DEFERRABLE INITIALLY DEFERRED')}
        </>
      )}
      {(type === 'foreign' || type === 'check') && toggle('not_valid', 'NOT VALID')}
      {type === 'index' && (
        <>
          <TextInput
            source="expressions"
            label="Expressions, one per line: lower(email)"
            multiline
            {...mono}
          />
          <SelectInput
            source="method"
            label="USING (index method)"
            choices={choices([...indexMethods])}
            helperText={false}
          />
          {toggle('unique', 'UNIQUE')}
          <SelectArrayInput source="include" label="INCLUDE" choices={columnChoices} {...mono} />
          <TextInput source="where" label="WHERE (partial index)" {...mono} />
        </>
      )}
    </>
  )
}

export function constraintStatements(form: ConstraintForm, { schema, table }: Place) {
  const columns = form.columns ?? []
  const name = form.name?.trim() || undefined
  if (form.type === 'check')
    return [
      checkConstraintStatement(
        schema,
        table,
        form.expression ?? '',
        name,
        undefined,
        !!form.not_valid
      ),
    ]
  if (form.type === 'exclusion')
    return [exclusionStatement(schema, table, form.expression ?? '', name)]
  if (form.type === 'index')
    return [
      indexDraftStatement(schema, table, {
        columns,
        expressions: (form.expressions ?? '').split('\n'),
        unique: form.unique,
        method: form.method,
        include: form.include,
        where: form.where,
        name,
      }),
    ]
  if (form.type === 'unique') return [uniqueConstraintStatement(schema, table, columns, name)]
  if (columns.length !== 1)
    throw new InvalidName('A relation is one column that points at one row.')
  const target = required(form.target, 'Choose the table the column points at.')
  return [
    foreignKeyStatement(
      schema,
      table,
      columns[0]!,
      { schema, table: target },
      form.on_delete,
      name,
      {
        onUpdate: form.on_update,
        deferrable: form.deferrable,
        notValid: form.not_valid,
      }
    ),
  ]
}
