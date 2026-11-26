import {
  columnTypes,
  constraintsOf,
  deleteRule,
  dropConstraintStatement,
  dropIndexStatement,
  type IndexDefinition,
  renameConstraintStatement,
  renameIndexStatement,
  validateConstraintStatement,
} from '@platform/core'
import { BooleanInput, TextInput } from 'react-admin'
import { defineKind, mono, ownsTable, type Place, required } from '../data/kinds.ts'
import { Mono, Tag } from '../kit/marks.tsx'
import { type ConstraintForm, constraintStatements, NewConstraint } from './constraint-inputs.tsx'

/** The keys and rules of a table: its constraints and its indexes. */
interface ConstraintRow {
  name: string
  type: string
  definition: string
  index: boolean
  validated: boolean
}
const typeWords: Record<string, string> = {
  p: 'Primary key',
  u: 'Unique',
  c: 'Check',
  f: 'Foreign key',
  x: 'Exclusion',
}
export const constraints = defineKind<ConstraintRow, Place, ConstraintForm>({
  name: 'constraints',
  title: 'Constraints and indexes',
  note: 'The constraints and indexes PostgreSQL holds the table to.',
  noun: 'constraint or index',
  empty: 'This table holds no key and no rule.',
  async read(db, { schema, table }, { catalog }) {
    const held = constraintsOf(catalog, schema, table)
    const indexes = await db.query<IndexDefinition>(
      `SELECT * FROM platform.catalog_index_definitions WHERE schema = $1 AND "table" = $2 ORDER BY name`,
      [schema, table]
    )
    return [
      ...held.map((c) => ({
        name: c.name,
        type: typeWords[c.type] ?? c.type,
        definition:
          c.definition +
          (c.on_delete && !c.definition.includes('ON DELETE')
            ? ` — ${deleteRule(c.on_delete)}`
            : ''),
        index: false,
        validated: c.validated !== false,
      })),
      ...indexes.rows
        .filter((i) => !i.backs_constraint)
        .map((i) => ({
          name: i.name,
          type: i.unique ? 'Unique index' : 'Index',
          definition: i.definition.replace(/^CREATE (UNIQUE )?INDEX \S+ ON \S+ /, ''),
          index: true,
          validated: i.valid,
        })),
    ]
  },
  key: (row) => row.name,
  columns: [
    { source: 'name', label: 'Name', render: (row) => <Mono>{row.name}</Mono> },
    {
      source: 'type',
      label: 'Kind',
      render: (row) => (
        <>
          {row.type} {!row.validated && <Tag color="warning">not validated</Tag>}
        </>
      ),
    },
    {
      source: 'definition',
      label: 'Definition',
      render: (row) => <Mono title={row.definition}>{row.definition}</Mono>,
    },
  ],
  may: ownsTable,
  defaults: (_where, row) =>
    row
      ? { name: row.name, validate: false }
      : {
          type: 'unique',
          columns: [],
          on_delete: 'restrict',
          on_update: 'restrict',
          method: 'btree',
        },
  Inputs: ({ where, row }) =>
    row ? (
      <>
        <TextInput source="name" label="Name" {...mono} />
        {!row.validated && !row.index && (
          <BooleanInput
            source="validate"
            label="Check the rows already there, and hold them to it (VALIDATE)"
            helperText={false}
          />
        )}
      </>
    ) : (
      <NewConstraint where={where} />
    ),
  create: constraintStatements,
  update(form, { schema, table }, row) {
    const name = required(form.name, 'Name it.')
    const out = form.validate ? [validateConstraintStatement(schema, table, row.name)] : []
    if (name !== row.name)
      out.push(
        row.index
          ? renameIndexStatement(schema, row.name, name)
          : renameConstraintStatement(schema, table, row.name, name)
      )
    return out
  },
  remove: (row, { schema, table }) => [
    row.index
      ? dropIndexStatement(schema, row.name)
      : dropConstraintStatement(schema, table, row.name),
  ],
})

export const columnTypeChoices = [
  ...Object.entries(columnTypes).map(([id, type]) => ({ id, name: type })),
  { id: 'relation', name: 'uuid REFERENCES another table (foreign key)' },
]
