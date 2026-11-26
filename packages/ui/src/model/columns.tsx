import { dropColumnStatement, columnMetadata, columnStatements, InvalidName } from '@platform/core'
import { defineKind, ownsTable, type Place } from '../data/kinds.ts'
import { resolveColumns } from '../columns/resolve.ts'
import { Mono, Privilege, Tag } from '../kit/marks.tsx'
import { TableLabel } from './tables.tsx'

import {
  type ColumnForm,
  NewColumn,
  places,
  type Row,
  SaidOfColumn,
  words,
} from './column-inputs.tsx'
import { columnChange } from './column-change.ts'

/** The columns of a table, as a kind: what PostgreSQL holds, and what the owner says of each. */
/** A column's default, as PostgreSQL keeps the expression. */
const Starts = ({ with: expression }: { with: string }) => <Mono>DEFAULT {expression}</Mono>
export const columns = defineKind<Row, Place, ColumnForm>({
  name: 'columns',
  title: 'Columns',
  note: 'PostgreSQL holds each column’s data type, default and constraints. Its display_name, views and renderers are metadata the table’s owner keeps.',
  noun: 'column',
  empty: 'This table has no column that you may reach.',
  async read(db, { schema, table }, { catalog, presentations }) {
    const rows = await columnMetadata(db, schema, table)
    return resolveColumns(catalog, schema, table, rows, presentations)
      .filter((f) => f.column)
      .map((f) => ({
        ...f,
        type_name: f.column!.type,
        said: rows.filter((r) => r.column_name === f.name),
      }))
  },
  key: (row) => row.name,
  columns: [
    {
      source: 'name',
      label: 'Column',
      // The name people read; the column's own is its title, and stays in the address and the SQL.
      render: (row) =>
        row.label !== row.name ? (
          <span title={row.name}>{row.label}</span>
        ) : (
          <Mono>{row.name}</Mono>
        ),
    },
    {
      source: 'type_name',
      label: 'Type',
      render: (row) => {
        if (row.relation)
          return (
            <>
              → <TableLabel schema={row.relation.target_schema} name={row.relation.target_table} />
            </>
          )
        return <Mono>{row.type_name}</Mono>
      },
    },
    {
      source: 'required',
      label: 'Constraints, default and views',
      render: (row) => (
        <>
          {row.column!.required && <Tag>required</Tag>} {row.system && <Tag>system</Tag>}{' '}
          {row.computed && <Tag>computed</Tag>}{' '}
          {row.choices && <Tag>{row.choices.join(' · ')}</Tag>}{' '}
          {row.column!.default && !row.system && <Starts with={row.column!.default} />}{' '}
          {Object.entries(places)
            .filter(([place]) => row.views[place] !== 'show')
            .map(([place, where]) => (
              <Tag
                key={place}
                color="info"
              >{`${words[row.views[place] as keyof typeof words]} ${where.toLowerCase()}`}</Tag>
            ))}
        </>
      ),
    },
    {
      source: 'column',
      label: 'Your privileges',
      wide: true,
      render: (row) => (
        <>
          {/* Only what is not held is drawn: a full row of marks says nothing. */}
          {row.column!.can_select && row.column!.can_insert && row.column!.can_update ? (
            'SELECT, INSERT, UPDATE'
          ) : (
            <>
              <Privilege name="SELECT" held={row.column!.can_select} />
              <Privilege name="INSERT" held={row.column!.can_insert} />
              <Privilege name="UPDATE" held={row.column!.can_update} />
            </>
          )}
        </>
      ),
    },
  ],
  may: ownsTable,
  Inputs: ({ where, row }) => (row ? <SaidOfColumn row={row} /> : <NewColumn where={where} />),
  defaults: (_where, row) =>
    row
      ? {
          name: row.name,
          type_name: row.type_name,
          default: row.column!.default ?? '',
          display_name: row.label === row.name ? '' : row.label,
          note: row.column!.comment ?? '',
          required: row.column!.required,
          views: { ...row.views } as Record<string, string>,
          renderers: { ...row.renderers } as ColumnForm['renderers'],
        }
      : { type: 'text', on_delete: 'restrict', required: false, unique: false, indexed: false },
  create(form, { schema, table }) {
    if (!form.name?.trim()) throw new InvalidName('Name the column.')
    if (form.type === 'relation' && !form.relation)
      throw new InvalidName('Choose the table the column points at.')
    return columnStatements(schema, table, {
      name: form.name.trim(),
      type: form.type,
      required: form.required,
      unique: form.unique,
      indexed: form.indexed,
      default: form.default,
      maxLength: form.max_length ?? undefined,
      choices: form.choices
        ?.split(',')
        .map((one) => one.trim())
        .filter(Boolean),
      min: form.min ?? undefined,
      max: form.max ?? undefined,
      note: form.note,
      relation: form.type === 'relation' ? form.relation : null,
      onDelete: form.on_delete,
      generated: form.generated,
      identity: form.identity,
    })
  },
  update: (form, where, row, { presentations }) => columnChange(form, where, row, presentations),
  loses: (row) => `Every row loses its ${row.label} value with the column. Nothing brings it back.`,
  remove: (row, { schema, table }) => {
    if (row.system) throw new InvalidName(`${row.name} is made with every table, and stays.`)
    return [dropColumnStatement(schema, table, row.name)]
  },
})
