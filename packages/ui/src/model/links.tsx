import {
  collectionStatements,
  dropCollectionStatement,
  joinsOf,
  otherSide,
  joinSide,
} from '@platform/core'
import { TextInput } from 'react-admin'
import { defineKind } from '../data/kinds.ts'
import { Mono } from '../kit/marks.tsx'
import { CollectionInput, CollectionName, mono, type Place, required } from './collections.tsx'

/** A link to many: a table of its own that joins two collections, made in one step. */
export const links = defineKind<
  { schema: string; table: string; other: string },
  Place,
  { other: string; name: string }
>({
  name: 'links',
  title: 'Linked to many',
  note: 'A many-to-many relation is a table of its own: a key to each side, unique together.',
  noun: 'link to many',
  empty: 'This collection is linked to no other through a table of links.',
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
      label: 'Linked to',
      render: (row) => <CollectionName schema={row.schema} name={row.other} />,
    },
    { source: 'table', label: 'Through', render: (row) => <Mono>{row.table}</Mono> },
  ],
  may: ({ schema }, { catalog }) => !!catalog.schemas.find((s) => s.name === schema)?.can_create,
  Inputs: ({ where }) => (
    <>
      <CollectionInput source="other" label="The other collection" schema={where.schema} />
      <TextInput
        source="name"
        label={'The table of links: named after both, unless you say'}
        {...mono}
      />
    </>
  ),
  // A many-to-many relation is a table of its own: a key to each side, unique together.
  create(form, { schema, table }) {
    const other = required(form.other, 'Choose the collection to link to.')
    const name = form.name?.trim() || `${table}_${other}`
    const [left, right] = [table, other === table ? `other_${other}` : other]
    const key = (field: string, relation: string) => ({
      name: field,
      type: 'relation',
      relation,
      required: true,
      onDelete: 'cascade' as const,
    })
    return collectionStatements(
      schema,
      name,
      '',
      [key(left, table), key(right, other)],
      [[left, right]]
    )
  },
  loses: (row) => `Every link it holds goes with ${row.table}. The records on either side stay.`,
  remove: (row, { schema }) => [dropCollectionStatement(schema, row.table)],
})
