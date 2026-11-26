import { LinearProgress, Typography } from '@mui/material'
import { columnsOf, tableOf } from '@platform/core'
import { Save, Trash2 } from 'lucide-react'
import { useState } from 'react'
import {
  Create,
  DeleteButton,
  Edit,
  Labeled,
  SaveButton,
  SimpleForm,
  useNotify,
  useRecordContext,
  useRedirect,
  useRefresh,
  useResourceContext,
} from 'react-admin'
import { Link } from 'react-router-dom'
import tokens from 'virtual:design-tokens'
import { Value } from '../columns/renderers.tsx'
import type { Column } from '../columns/types.ts'
import { textOf } from '../columns/values.tsx'
import { ItemMark, iconSize } from '../kit/marks.tsx'
import { Refusal } from '../kit/said.tsx'
import { Tip } from '../kit/Header.tsx'
import { PageTitle } from '../kit/Page.tsx'
import { useSession } from '../session/session.ts'
import { RowAside } from './Aside.tsx'
import { useTable } from './table.ts'

/**
 * Whether a column is offered as an input. It is PostgreSQL's own answer — the right on the
 * column, or on the join table's two keys — narrowed by what the owner says of the column.
 */
function useWritable(creating: boolean) {
  const { catalog } = useSession()
  return (f: Column) => {
    if (f.link) {
      const { schema, table, fk, target } = f.link.path
      const keys = columnsOf(catalog, schema, table).filter((c) => [fk, target].includes(c.name))
      return (
        f.link.kind === 'links' &&
        !!tableOf(catalog, schema, table)?.can_delete &&
        keys.every((c) => c.can_insert)
      )
    }
    return (
      !f.system &&
      !f.computed &&
      f.views.row !== 'readonly' &&
      !!(creating ? f.column?.can_insert : f.column?.can_update)
    )
  }
}

/** The one row form: each column an input where the reader may write it, its value where they may not. */
function RowForm({
  creating,
  refusal,
  onRefused,
}: {
  creating: boolean
  refusal: unknown
  onRefused(error: unknown): void
}) {
  const { resource, columns, info, said } = useTable()
  const row = useRecordContext()
  const writable = useWritable(creating)
  const redirect = useRedirect()
  const inForm = columns.filter(
    (f) =>
      !f.system &&
      f.views.row !== 'hide' &&
      f.link?.kind !== 'children' &&
      (creating ? writable(f) : f.virtual || f.column?.can_select || writable(f))
  )
  const hidden = columns.filter((f) => !f.system && f.views.row === 'hide')
  const named =
    columns.find((f) => f.kind === 'text' && !f.system && f.column?.can_select)?.name ?? 'id'
  // A row of the grid stands in for the row until it is read: it holds no links yet, and a
  // form drawn from it would be drawn again, over what the reader had begun to type.
  const read = creating || columns.every((f) => f.link?.kind !== 'links' || row?.[f.name])
  if (!read) return <LinearProgress data-loading />
  return (
    <SimpleForm sx={{ maxWidth: tokens.layout.form }} toolbar={false}>
      <PageTitle
        title={creating ? 'Insert row' : textOf(row?.[named]) || 'Row'}
        crumb={<Link to={`/${resource}`}>{said.name}</Link>}
        mark={<ItemMark {...said} table />}
        actions={
          <>
            {!creating && info?.can_delete && (
              <Tip title="Delete">
                <DeleteButton
                  mutationMode="pessimistic"
                  variant="outlined"
                  icon={<Trash2 size={iconSize} />}
                  mutationOptions={{
                    onError: onRefused,
                    onSuccess: () => redirect('list', resource),
                  }}
                />
              </Tip>
            )}
            {/* Drawn outside the form's element, so it submits through the form's context. */}
            {inForm.some(writable) && (
              <Tip title={creating ? 'Insert' : 'Update'}>
                <SaveButton
                  type="button"
                  label={creating ? 'Insert' : 'Update'}
                  icon={<Save size={iconSize} />}
                />
              </Tip>
            )}
          </>
        }
      />
      <Refusal error={refusal} />
      {inForm.map((f) =>
        writable(f) ? (
          <f.type.Input key={f.name} column={f} source={f.name} label={f.label} />
        ) : (
          <Labeled key={f.name} label={f.label} data-locked={f.name}>
            <Value column={f} situation="row" />
          </Labeled>
        )
      )}
      {hidden.length > 0 && (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          The owner keeps {hidden.map((f) => f.label).join(', ')} out of this form.
        </Typography>
      )}
    </SimpleForm>
  )
}

/** A row's page: the form, and PostgreSQL's answer to what it writes — said the one way a refusal is said. */
function RowPage({ creating }: { creating: boolean }) {
  const resource = useResourceContext()!
  const notify = useNotify()
  const redirect = useRedirect()
  const refresh = useRefresh()
  const [refusal, setRefusal] = useState<unknown>(null)
  const answered = {
    onError: setRefusal,
    onSuccess(written: Record<string, unknown>) {
      setRefusal(null)
      notify((written.note as string) ?? (creating ? 'INSERT 1.' : 'UPDATE 1.'), {
        type: written.note ? 'warning' : 'success',
      })
      if (creating) redirect('list', resource)
      else refresh()
    },
  }
  const form = <RowForm creating={creating} refusal={refusal} onRefused={setRefusal} />
  const page = { component: 'div', actions: false, title: ' ', mutationOptions: answered } as const
  return creating ? (
    <Create {...page}>{form}</Create>
  ) : (
    <Edit {...page} mutationMode="pessimistic" aside={<RowAside />}>
      {form}
    </Edit>
  )
}
export const RowEdit = () => <RowPage creating={false} />
export const RowCreate = () => <RowPage creating />
