import { LinearProgress, Typography } from '@mui/material'
import { columnsOf, tableOf } from '@platform/core'
import { useState } from 'react'
import {
  Create,
  DeleteButton,
  Edit,
  Labeled,
  SaveButton,
  SimpleForm,
  Toolbar,
  useNotify,
  useRecordContext,
  useRedirect,
  useRefresh,
  useResourceContext,
} from 'react-admin'
import { Link } from 'react-router-dom'
import tokens from 'virtual:design-tokens'
import { Value } from '../fields/renderers.tsx'
import type { Field } from '../fields/types.ts'
import { textOf } from '../fields/values.tsx'
import { ItemMark } from '../kit/marks.tsx'
import { Refusal } from '../kit/said.tsx'
import { PageTitle } from '../kit/Page.tsx'
import { useSession } from '../session/session.ts'
import { RecordAside } from './Aside.tsx'
import { useCollection } from './collection.ts'

/**
 * Whether a field is offered as an input. It is PostgreSQL's own answer — the right on the
 * column, or on the join table's two keys — narrowed by what the owner says of the field.
 */
function useWritable(creating: boolean) {
  const { catalog } = useSession()
  return (f: Field) => {
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
      f.views.record !== 'readonly' &&
      !!(creating ? f.column?.can_insert : f.column?.can_update)
    )
  }
}

/** The one record form: each field an input where the reader may write it, its value where they may not. */
function RecordForm({
  creating,
  refusal,
  onRefused,
}: {
  creating: boolean
  refusal: unknown
  onRefused(error: unknown): void
}) {
  const { resource, fields, info, said } = useCollection()
  const record = useRecordContext()
  const writable = useWritable(creating)
  const redirect = useRedirect()
  const inForm = fields.filter(
    (f) =>
      !f.system &&
      f.views.record !== 'hide' &&
      f.link?.kind !== 'children' &&
      (creating ? writable(f) : f.virtual || f.column?.can_select || writable(f))
  )
  const hidden = fields.filter((f) => !f.system && f.views.record === 'hide')
  const named =
    fields.find((f) => f.kind === 'text' && !f.system && f.column?.can_select)?.name ?? 'id'
  // A row of the grid stands in for the record until it is read: it holds no links yet, and a
  // form drawn from it would be drawn again, over what the reader had begun to type.
  const read = creating || fields.every((f) => f.link?.kind !== 'links' || record?.[f.name])
  if (!read) return <LinearProgress data-loading />
  return (
    <SimpleForm
      sx={{ maxWidth: tokens.layout.form }}
      toolbar={
        <Toolbar sx={{ bgcolor: 'transparent', px: 0, gap: 2 }}>
          {inForm.some(writable) && <SaveButton />}
          {!creating && info?.can_delete && (
            <DeleteButton
              mutationMode="pessimistic"
              mutationOptions={{ onError: onRefused, onSuccess: () => redirect('list', resource) }}
            />
          )}
        </Toolbar>
      }
    >
      <PageTitle
        title={creating ? `New in ${said.name}` : textOf(record?.[named]) || 'Record'}
        crumb={<Link to={`/${resource}`}>{said.name}</Link>}
        mark={<ItemMark {...said} table />}
      />
      <Refusal error={refusal} />
      {inForm.map((f) =>
        writable(f) ? (
          <f.type.Input key={f.name} field={f} source={f.name} label={f.label} />
        ) : (
          <Labeled key={f.name} label={f.label} data-locked={f.name}>
            <Value field={f} situation="record" />
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

/** A record's page: the form, and PostgreSQL's answer to what it writes — said the one way a refusal is said. */
function RecordPage({ creating }: { creating: boolean }) {
  const resource = useResourceContext()!
  const notify = useNotify()
  const redirect = useRedirect()
  const refresh = useRefresh()
  const [refusal, setRefusal] = useState<unknown>(null)
  const answered = {
    onError: setRefusal,
    onSuccess(written: Record<string, unknown>) {
      setRefusal(null)
      notify((written.note as string) ?? (creating ? 'The record was written.' : 'Saved.'), {
        type: written.note ? 'warning' : 'success',
      })
      if (creating) redirect('list', resource)
      else refresh()
    },
  }
  const form = <RecordForm creating={creating} refusal={refusal} onRefused={setRefusal} />
  const page = { component: 'div', actions: false, title: ' ', mutationOptions: answered } as const
  return creating ? (
    <Create {...page}>{form}</Create>
  ) : (
    <Edit {...page} mutationMode="pessimistic" aside={<RecordAside />}>
      {form}
    </Edit>
  )
}
export const RecordEdit = () => <RecordPage creating={false} />
export const RecordCreate = () => <RecordPage creating />
