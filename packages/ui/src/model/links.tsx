import { tableStatements, dropTableStatement, joinsOf, otherSide, joinSide } from '@platform/core'
import { TextInput } from 'react-admin'
import { defineKind, mono, type Place, required, createsIn } from '../data/kinds.ts'
import { Mono } from '../kit/marks.tsx'
import { TableInput, TableName } from './tables.tsx'

/** A link to many: a table of its own that joins two tables, made in one step. */
export const links = defineKind<
  { schema: string; table: string; other: string },
  Place,
  { other: string; name: string }
>({
  name: 'links',
  title: 'Join tables',
  note: 'A many-to-many relationship is a join table: a foreign key to each side, unique together.',
  noun: 'join table',
  empty: 'No join table links this table to another.',
  read: async (_db, { schema, table }, { catalog }) =>
    joinsOf(catalog, schema, table).map((join) => ({
      schema: join.schema,
      table: join.table,
      other: otherSide(join, joinSide(join, schema, table)!).target_table,
    })),
  key: (row) => row.table,
  columns: [
    {
      source: 'other',
      label: 'References',
      render: (row) => <TableName schema={row.schema} name={row.other} />,
    },
    { source: 'table', label: 'Through', render: (row) => <Mono>{row.table}</Mono> },
  ],
  may: createsIn,
  Inputs: ({ where }) => (
    <>
      <TableInput source="other" label="Referenced table" schema={where.schema} />
      <TextInput source="name" label={'Join table name (empty: named after both)'} {...mono} />
    </>
  ),
  // A many-to-many relation is a table of its own: a key to each side, unique together.
  create(form, { schema, table }) {
    const other = required(form.other, 'Choose the referenced table.')
    const name = form.name?.trim() || `${table}_${other}`
    const [left, right] = [table, other === table ? `other_${other}` : other]
    const key = (column: string, relation: string) => ({
      name: column,
      type: 'relation',
      relation,
      required: true,
      onDelete: 'cascade' as const,
    })
    return tableStatements(schema, name, '', [key(left, table), key(right, other)], [[left, right]])
  },
  loses: (row) =>
    `Every row of ${row.table} is dropped with it. The rows of the tables it joins stay.`,
  remove: (row, { schema }) => [dropTableStatement(schema, row.table)],
})
