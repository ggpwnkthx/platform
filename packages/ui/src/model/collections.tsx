import { Box } from '@mui/material'
import {
  type Catalog,
  collectionTarget,
  commentCollectionStatement,
  createCollectionStatements,
  dropCollectionStatement,
  InvalidName,
  metadataStatement,
  schemaStatement,
  type TableInfo,
  tableOf,
  tablesIn,
} from '@platform/core'
import { SelectInput, TextInput } from 'react-admin'
import { Link } from 'react-router-dom'
import { defineKind } from '../data/kinds.ts'
import { useNames, useWorkspace } from '../kit/place.ts'
import { ItemMark, Mono, Tag } from '../kit/marks.tsx'
import { useSession } from '../session/session.ts'
import { Role } from '../access/roles.tsx'

/** The model of a workspace, as kinds: its collections, their keys and rules, their links. */
export interface Place {
  schema: string
  table: string
}
export const choices = (names: readonly string[]) => names.map((id) => ({ id, name: id }))
export const mono = { className: 'mono', helperText: false } as const
export const ownsTable = ({ schema, table }: Place, { catalog }: { catalog: Catalog }) =>
  !!tableOf(catalog, schema, table)?.can_alter
export const ownsSchema = ({ schema }: { schema: string }, { catalog }: { catalog: Catalog }) =>
  !!catalog.schemas.find((s) => s.name === schema)?.can_alter
/** Who may grant is PostgreSQL's answer: the owner, or a role that holds a right WITH GRANT OPTION. */
export const grantsOn = (
  { schema, table }: { schema: string; table?: string },
  { catalog }: { catalog: Catalog }
) =>
  !!(table ? tableOf(catalog, schema, table) : catalog.schemas.find((s) => s.name === schema))
    ?.can_grant
export const required = (value: unknown, what: string) => {
  const text = String(value ?? '').trim()
  if (!text) throw new InvalidName(what)
  return text
}
export const onDelete = [
  { id: 'restrict', name: 'Refuse while records point at it' },
  { id: 'cascade', name: 'Delete the records that point at it' },
  { id: 'set_null', name: 'Empty the field of the records that point at it' },
]
/** The collections of the workspace in view, to choose one of. */
export function CollectionInput(props: { source: string; label: string; schema: string }) {
  const { catalog } = useSession()
  const names = tablesIn(catalog, props.schema)
    .filter((t) => t.kind !== 'v')
    .map((t) => t.name)
  return (
    <SelectInput source={props.source} label={props.label} choices={choices(names)} {...mono} />
  )
}
export function CollectionName({ schema, name }: { schema: string; name: string }) {
  const said = useNames()(schema, name)
  return (
    <Box
      component={Link}
      to={`/w/${schema}/${name}`}
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
 * A collection's name as people read it, in a table's cell: its own name is its title. Without
 * a schema it is a collection of the workspace in view.
 */
export function CollectionLabel({ schema, name }: { schema?: string; name: string }) {
  const here = useWorkspace()?.name ?? ''
  const said = useNames()(schema ?? here, name)
  return said.name === name ? <Mono>{name}</Mono> : <span title={name}>{said.name}</span>
}

export const workspaces = defineKind<{ name: string }, object, { name: string; owner: string }>({
  name: 'workspaces',
  title: 'Workspaces',
  note: 'A workspace is a schema: the unit of ownership and of permission.',
  noun: 'workspace',
  empty: 'No workspace that you may use.',
  read: async (_db, _where, { catalog }) => catalog.schemas,
  key: (row) => row.name,
  columns: [{ source: 'name', label: 'Workspace' }],
  Inputs: () => (
    <>
      <TextInput
        source="name"
        label="Name in the database: in the address and the SQL (a schema)"
        {...mono}
      />
      <TextInput
        source="owner"
        label="Owner: a group, or leave it empty to own it yourself"
        {...mono}
      />
    </>
  ),
  create: (form) => [
    schemaStatement(required(form.name, 'Name the workspace.'), form.owner?.trim() || null),
  ],
})

export const collections = defineKind<
  TableInfo,
  { schema: string },
  { name: string; display_name: string; note: string }
>({
  name: 'collections',
  title: 'Collections',
  note: 'A collection is a table. A new one starts with row security on and no row policies, so nobody sees its records until a policy lets them.',
  noun: 'collection',
  empty: 'No collection in this workspace that you may reach.',
  read: async (_db, { schema }, { catalog }) => tablesIn(catalog, schema),
  key: (row) => row.name,
  columns: [
    {
      source: 'name',
      label: 'Collection',
      render: (row) => <CollectionName schema={row.schema} name={row.name} />,
    },
    {
      source: 'kind',
      label: 'Kind',
      render: (row) => (row.kind === 'v' ? 'View (read-only)' : 'Collection'),
    },
    {
      source: 'rls',
      label: 'Row security',
      render: (row) => <Tag color="info">{row.rls ? 'Policies decide records' : 'Off'}</Tag>,
    },
    { source: 'owner', label: 'Owner', render: (row) => <Role name={row.owner} /> },
    { source: 'comment', label: 'Note' },
  ],
  may: ({ schema }, { catalog }) => !!catalog.schemas.find((s) => s.name === schema)?.can_create,
  Inputs: () => (
    <>
      <TextInput
        source="name"
        label="Name in the database: in the address and the SQL (a table)"
        {...mono}
      />
      <TextInput source="display_name" label="The name people read" helperText={false} />
      <TextInput source="note" label="Note" helperText={false} />
    </>
  ),
  create(form, { schema }) {
    const name = required(form.name, 'Name the collection.')
    return [
      ...createCollectionStatements(schema, name),
      ...(form.note?.trim() ? [commentCollectionStatement(schema, name, form.note)] : []),
      ...(form.display_name?.trim()
        ? [
            metadataStatement(
              collectionTarget(schema, name),
              'display_name',
              form.display_name.trim()
            ),
          ]
        : []),
    ]
  },
  loses: () => 'Every record in the collection goes with it. Nothing brings them back.',
  remove: (row, { schema }) => [dropCollectionStatement(schema, row.name)],
})
