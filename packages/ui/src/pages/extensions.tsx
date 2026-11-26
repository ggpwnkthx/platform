import { Alert } from '@mui/material'
import {
  createExtensionStatement,
  dropExtensionStatement,
  updateExtensionStatement,
} from '@platform/core'
import { SelectInput, useGetList } from 'react-admin'
import { defineKind, choices, mono, required, fromView } from '../data/kinds.ts'
import { Mono, Tag } from '../kit/marks.tsx'
import { useSession } from '../session/session.ts'

/** The extensions the server offers, and the ones this database has installed. */
interface ExtensionRow {
  name: string
  available: string
  installed: string | null
  comment: string
  schema: string | null
  trusted: boolean
}
function ExtensionInputs() {
  const { catalog } = useSession()
  const found = useGetList<ExtensionRow & { id: string }>('extensions', {
    pagination: { page: 1, perPage: 1000 },
  })
  const open = (found.data ?? []).filter((e) => !e.installed).map((e) => e.name)
  return (
    <>
      <SelectInput source="name" label="Extension" choices={choices(open)} {...mono} />
      <SelectInput
        source="schema"
        label="SCHEMA (empty: the extension's own)"
        choices={choices(catalog.schemas.filter((s) => s.kind === 'user').map((s) => s.name))}
        {...mono}
      />
    </>
  )
}
export const extensions = defineKind<ExtensionRow, object, { name: string; schema: string }>({
  name: 'extensions',
  title: 'Extensions',
  note: 'Packaged types, functions and operators (pg_available_extensions). A trusted extension may be created by a role with CREATE on the database; any other needs a superuser.',
  noun: 'extension',
  empty: 'The server offers no extension.',
  read: fromView<ExtensionRow>('catalog_extensions', [], 'installed IS NULL, name'),
  key: (row) => row.name,
  columns: [
    { source: 'name', label: 'Extension', render: (row) => <Mono>{row.name}</Mono> },
    {
      source: 'installed',
      label: 'Installed',
      render: (row) =>
        row.installed ? (
          <>
            <Tag color="info">{`${row.installed} in ${row.schema}`}</Tag>{' '}
            {row.installed !== row.available && (
              <Tag color="warning">{`${row.available} offered`}</Tag>
            )}
          </>
        ) : (
          <>
            {row.available} {row.trusted && <Tag>trusted</Tag>}
          </>
        ),
    },
    { source: 'comment', label: 'Comment' },
  ],
  may: (_where, { identity }) => identity.can_create_schema || identity.is_operator,
  mayRow: (row, _where, { identity }) =>
    !!row.installed &&
    row.name !== 'plpgsql' &&
    (identity.can_create_schema || identity.is_operator),
  Inputs: ({ row }) =>
    row ? (
      <Alert severity="info">{`Running this brings it to version ${row.available}.`}</Alert>
    ) : (
      <ExtensionInputs />
    ),
  create: (form) => [
    createExtensionStatement(required(form.name, 'Choose an extension.'), form.schema || null),
  ],
  update(_form, _where, row) {
    if (row.installed === row.available)
      throw new Error('It is the version the server offers already.')
    return [updateExtensionStatement(row.name)]
  },
  loses: () =>
    'Whatever the extension made goes with it; PostgreSQL refuses while a column or an index uses it.',
  remove: (row) => [dropExtensionStatement(row.name)],
})
