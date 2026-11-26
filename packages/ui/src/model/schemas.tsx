import {
  carried,
  dropSchemaStatement,
  itemMetadata,
  type MetadataRow,
  metadataRemoval,
  type SchemaInfo,
  renameSchemaStatement,
  schemaOwnerStatement,
  schemaStatement,
  schemaTarget,
} from '@platform/core'
import { TextInput } from 'react-admin'
import { defineKind, mono, required } from '../data/kinds.ts'
import { RoleInput } from '../access/roles.tsx'

/**
 * Schemas, as a kind: made, renamed, handed to another owner, and dropped. A rename
 * carries the sayings the reader may write — the schema's own, and those of the
 * tables they own in it — and leaves the rest where it was, as a rename by hand would.
 */
type Row = SchemaInfo & { said: MetadataRow[] }
export const schemas = defineKind<Row, object, { name: string; owner: string }>({
  name: 'schemas',
  title: 'Schemas',
  note: 'A schema is a namespace of tables and other objects: the unit of ownership and of privileges.',
  noun: 'schema',
  empty: 'No schema that you may use.',
  read: async (db, _where, { catalog }) =>
    Promise.all(
      catalog.schemas.map(async (s) => {
        const owned = new Set(
          catalog.tables.filter((t) => t.schema === s.name && t.can_alter).map((t) => t.name)
        )
        const rows = s.can_alter ? await itemMetadata(db, s.name) : []
        return { ...s, said: rows.filter((r) => !r.table_name || owned.has(r.table_name)) }
      })
    ),
  key: (row) => row.name,
  columns: [{ source: 'name', label: 'Schema' }],
  mayRow: (row) => row.can_alter,
  Inputs: ({ row }) => (
    <>
      <TextInput source="name" label="Schema name" {...mono} />
      {row ? (
        <RoleInput source="owner" label="Owner" />
      ) : (
        <TextInput source="owner" label="AUTHORIZATION: the owning role (empty: you)" {...mono} />
      )}
    </>
  ),
  defaults: (_where, row) => (row ? { name: row.name, owner: row.owner } : {}),
  create: (form) => [
    schemaStatement(required(form.name, 'Name the schema.'), form.owner?.trim() || null),
  ],
  update(form, _where, row) {
    const name = required(form.name, 'Name the schema.')
    const out =
      name === row.name
        ? []
        : carried(
            row.said,
            { schema: row.name },
            { schema: name },
            renameSchemaStatement(row.name, name)
          )
    // The new owner last: the reader still owns it while its metadata is written again.
    if (form.owner && form.owner !== row.owner) out.push(schemaOwnerStatement(name, form.owner))
    return out
  },
  loses: () =>
    'PostgreSQL refuses while the schema holds anything: its tables, views and types go first.',
  remove: (row) => [
    ...row.said
      .filter((r) => r.scope === 'schema')
      .map((r) => metadataRemoval(schemaTarget(row.name), r.key)),
    dropSchemaStatement(row.name),
  ],
})
