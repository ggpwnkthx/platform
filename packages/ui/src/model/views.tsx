import {
  dropTableStatement,
  refreshViewStatement,
  tableOf,
  viewInvokerStatement,
  viewStatement,
} from '@platform/core'
import { BooleanInput, TextInput } from 'react-admin'
import { useWatch } from 'react-hook-form'
import { Alert } from '@mui/material'
import { defineKind, mono, required, fromView, createsIn } from '../data/kinds.ts'
import { Mono, Tag } from '../kit/marks.tsx'
import { TableName } from './tables.tsx'

/**
 * A schema's views: queries kept under a name, read like a table. A view reads as its
 * caller unless its owner says otherwise; a materialized view keeps the rows its owner read
 * when it was last refreshed, so its readers see them whatever the policies of what it reads.
 */
interface ViewRow {
  schema: string
  name: string
  kind: 'v' | 'm'
  definition: string
  security_invoker: boolean
  populated: boolean
}
interface ViewForm {
  name: string
  query: string
  materialized: boolean
  security_invoker: boolean
  refresh: boolean
}
const reads = (row: ViewRow) =>
  row.kind === 'm' ? (
    <Tag color="warning">owner, at REFRESH</Tag>
  ) : row.security_invoker ? (
    <Tag color="info">invoker</Tag>
  ) : (
    <Tag color="warning">owner</Tag>
  )
function ViewInputs({ row }: { row?: ViewRow }) {
  const materialized = useWatch({ name: 'materialized' }) || row?.kind === 'm'
  const invoker = useWatch({ name: 'security_invoker' })
  return (
    <>
      {!row && <TextInput source="name" label="View name" {...mono} />}
      {!row && <BooleanInput source="materialized" label="MATERIALIZED" helperText={false} />}
      {(!row || row.kind === 'v') && (
        <TextInput source="query" label="Query: SELECT …" multiline minRows={6} {...mono} />
      )}
      {!materialized && (
        <BooleanInput
          source="security_invoker"
          label="security_invoker: the querying role's privileges and policies apply"
          helperText={false}
        />
      )}
      {(materialized || (!materialized && invoker === false)) && (
        <Alert severity="warning">
          {materialized
            ? 'A materialized view keeps what its owner could read, and shows it to everyone granted SELECT on it: row policies do not reach it.'
            : 'Read as its owner, the view shows every reader what its owner may read: the row policies of what it reads apply to the owner, not to the reader.'}
        </Alert>
      )}
      {row?.kind === 'm' && (
        <BooleanInput source="refresh" label="REFRESH MATERIALIZED VIEW" helperText={false} />
      )}
    </>
  )
}
export const views = defineKind<ViewRow, { schema: string }, ViewForm>({
  name: 'views',
  title: 'Views',
  note: 'A view is a stored query, selected from like a table. It stores no rows; a materialized view stores the rows of its last refresh.',
  noun: 'view',
  empty: 'This schema holds no view that you may reach.',
  read: fromView<ViewRow>('catalog_views', ['schema'], 'name'),
  key: (row) => row.name,
  columns: [
    {
      source: 'name',
      label: 'View',
      render: (row) => <TableName schema={row.schema} name={row.name} />,
    },
    {
      source: 'kind',
      label: 'Kind',
      render: (row) => (row.kind === 'm' ? 'Materialized' : 'View'),
    },
    { source: 'security_invoker', label: 'Runs as', render: reads },
    {
      source: 'definition',
      label: 'Query',
      render: (row) => <Mono title={row.definition}>{row.definition}</Mono>,
    },
  ],
  may: createsIn,
  mayRow: (row, _where, { catalog }) => !!tableOf(catalog, row.schema, row.name)?.can_alter,
  Inputs: ViewInputs,
  defaults: (_where, row) =>
    row
      ? {
          query: row.definition.trim().replace(/;$/, ''),
          security_invoker: row.security_invoker,
          refresh: false,
        }
      : { materialized: false, security_invoker: true },
  create: (form, { schema }) => [
    viewStatement({
      schema,
      name: required(form.name, 'Name the view.'),
      query: form.query,
      materialized: form.materialized,
      securityInvoker: form.security_invoker,
    }),
  ],
  update(form, { schema }, row) {
    const out: string[] = []
    if (row.kind === 'm') {
      if (form.refresh) out.push(refreshViewStatement(schema, row.name))
    } else {
      if ((form.query ?? '').trim() !== row.definition.trim().replace(/;$/, ''))
        out.push(
          viewStatement({
            schema,
            name: row.name,
            query: form.query,
            replace: true,
            securityInvoker: form.security_invoker,
          })
        )
      else if (!!form.security_invoker !== row.security_invoker)
        out.push(viewInvokerStatement(schema, row.name, !!form.security_invoker))
    }
    return out
  },
  loses: () => 'The view goes; the tables it reads stay.',
  remove: (row, { schema }) => [dropTableStatement(schema, row.name, row.kind)],
})
