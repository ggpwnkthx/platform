import { Box } from '@mui/material'
import {
  carried,
  tableTarget,
  commentTableStatement,
  createTableStatements,
  dropTableStatement,
  itemMetadata,
  type MetadataRow,
  metadataStatement,
  renameTableStatement,
  type TableInfo,
  tableOwnerStatement,
  tablesIn,
} from '@platform/core'
import { SelectInput, TextInput } from 'react-admin'
import { Link } from 'react-router-dom'
import { choices, defineKind, mono, required, createsIn } from '../data/kinds.ts'
import { useNames, useSchema } from '../kit/place.ts'
import { ItemMark, Mono, Tag } from '../kit/marks.tsx'
import { useSession } from '../session/session.ts'
import { Role, RoleInput } from '../access/roles.tsx'

/** The model of a schema, as kinds: its tables, their keys and rules, their links. */
/** The tables of the schema in view, to choose one of. */
export function TableInput(props: { source: string; label: string; schema: string }) {
  const { catalog } = useSession()
  const names = tablesIn(catalog, props.schema)
    .filter((t) => t.kind === 'r' || t.kind === 'p')
    .map((t) => t.name)
  return (
    <SelectInput source={props.source} label={props.label} choices={choices(names)} {...mono} />
  )
}
export function TableName({ schema, name }: { schema: string; name: string }) {
  const said = useNames()(schema, name)
  return (
    <Box
      component={Link}
      to={`/schemas/${schema}/${name}`}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        color: 'inherit',
        textDecoration: 'none',
      }}
    >
      <ItemMark {...said} table />
      {/* The name people read; the table's own is in the address, the SQL and the title. */}
      {said.name === name ? <Mono>{name}</Mono> : <span title={name}>{said.name}</span>}
    </Box>
  )
}

/**
 * A table's name as people read it, in a table's cell: its own name is its title. Without
 * a schema it is a table of the schema in view.
 */
export function TableLabel({ schema, name }: { schema?: string; name: string }) {
  const here = useSchema()?.name ?? ''
  const said = useNames()(schema ?? here, name)
  return said.name === name ? <Mono>{name}</Mono> : <span title={name}>{said.name}</span>
}

type Table = TableInfo & { said: MetadataRow[] }
export const tables = defineKind<
  Table,
  { schema: string },
  { name: string; display_name: string; note: string; owner: string }
>({
  name: 'tables',
  title: 'Tables',
  note: 'Tables and views. A new table starts with row-level security enabled and no policies, so no role but its owner reaches its rows until a policy allows it.',
  noun: 'table',
  empty: 'No table in this schema that you may reach.',
  async read(db, { schema }, { catalog }) {
    const said = await itemMetadata(db, schema)
    return tablesIn(catalog, schema).map((t) => ({
      ...t,
      said: t.can_alter ? said.filter((r) => r.table_name === t.name) : [],
    }))
  },
  key: (row) => row.name,
  columns: [
    {
      source: 'name',
      label: 'Table',
      render: (row) => <TableName schema={row.schema} name={row.name} />,
    },
    {
      source: 'kind',
      label: 'Kind',
      render: (row) => kindWords[row.kind] ?? 'Table',
    },
    {
      source: 'rls',
      label: 'Row security',
      render: (row) => (
        <Tag color="info">{row.rls ? 'ROW LEVEL SECURITY' : 'No row-level security'}</Tag>
      ),
    },
    { source: 'owner', label: 'Owner', render: (row) => <Role name={row.owner} /> },
    { source: 'comment', label: 'Note' },
  ],
  may: createsIn,
  mayRow: (row) => row.can_alter,
  Inputs: ({ row }) => (
    <>
      <TextInput source="name" label="Table name" {...mono} />
      {!row && <TextInput source="display_name" label="display_name" helperText={false} />}
      <TextInput source="note" label="Note" helperText={false} />
      {row && <RoleInput source="owner" label="Owner: a group role" groups />}
    </>
  ),
  defaults: (_where, row) =>
    row ? { name: row.name, note: row.comment ?? '', owner: row.owner } : {},
  create(form, { schema }) {
    const name = required(form.name, 'Name the table.')
    return [
      ...createTableStatements(schema, name),
      ...(form.note?.trim() ? [commentTableStatement(schema, name, form.note)] : []),
      ...(form.display_name?.trim()
        ? [metadataStatement(tableTarget(schema, name), 'display_name', form.display_name.trim())]
        : []),
    ]
  },
  update(form, { schema }, row) {
    const name = required(form.name, 'Name the table.')
    const out =
      (form.note?.trim() || null) !== (row.comment ?? null)
        ? [commentTableStatement(schema, row.name, form.note ?? '', row.kind)]
        : []
    if (name !== row.name)
      out.push(
        ...carried(
          row.said,
          { schema, table: row.name },
          { schema, table: name },
          renameTableStatement(schema, row.name, name, row.kind)
        )
      )
    // The new owner last: the reader still owns it while its metadata is written again.
    if (form.owner && form.owner !== row.owner)
      out.push(tableOwnerStatement(schema, name, form.owner, row.kind))
    return out
  },
  loses: (row) =>
    row.kind === 'v' || row.kind === 'm'
      ? 'The view goes; the tables it reads stay.'
      : 'Every row in the table goes with it. Nothing brings them back.',
  remove: (row, { schema }) => [dropTableStatement(schema, row.name, row.kind)],
})
const kindWords: Record<string, string> = {
  r: 'Table',
  p: 'Table',
  v: 'View (read-only)',
  m: 'Materialized view (read-only)',
}
