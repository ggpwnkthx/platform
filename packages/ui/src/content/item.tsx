import { ActionIcon, Button, Group, Modal, Stack, Text } from '@mantine/core'
import { activity, linkedRows, record, type LinkedRow } from '@platform/core'
import { Save, Trash2 } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { NoCollection } from '../bits/empty.tsx'
import { ItemMark } from '../bits/marks.tsx'
import { Empty, Page, Problem } from '../bits/page.tsx'
import { useFields } from '../fields/resolve.ts'
import { textOf } from '../fields/values.tsx'
import { useDb, usePlace } from '../session/hooks.ts'
import { useSession } from '../session/context.ts'
import { useNames } from '../shell/names.ts'
import { CollectionAside } from './aside.tsx'
import { FieldOf, Revisions, SystemFields } from './form.tsx'
import { RelatedRows } from './related.tsx'
import { useSeededForm } from './seed.ts'
import { drawnValue, type Row } from './query.ts'
import { useRecordWriter } from './writer.ts'

export function Item() {
  const place = usePlace()
  const { catalog } = useSession()
  const names = useNames()
  const navigate = useNavigate()
  const { info, fields, loading } = useFields(place.ws, place.c)
  const id = place.id
  const readable = fields.filter((f) => f.column?.can_select).map((f) => f.name)
  const loaded = useDb(
    ['record', place.ws, place.c, id, readable],
    (one) => record(one, place.ws, place.c, readable, id),
    !!id && !loading && readable.length > 0
  )
  const history = useDb(
    ['revisions', place.ws, place.c, id],
    (one) => activity(one, { schema: place.ws, table: place.c, row: id, limit: 20 }),
    !!id
  )
  const row = loaded.data as Row | null | undefined
  // The rows this record is linked to, and the rows that point at it.
  const linkFields = fields.filter((f) => f.link?.kind === 'links')
  const childFields = fields.filter((f) => f.link?.kind === 'children')
  const links = useDb(
    ['links', place.ws, place.c, id],
    async (one) => {
      const out: Record<string, LinkedRow[]> = {}
      for (const f of linkFields) out[f.name] = await linkedRows(one, catalog, f.link!.path, id)
      return out
    },
    !!id && linkFields.length > 0
  )
  // The record form goes back to where the reader came from: a page of the interface, nowhere else.
  const from = place.params.get('from')
  const back =
    from?.startsWith('/') && !from.startsWith('//')
      ? from
      : place.to('/data/records', { c: place.c })
  const said = names(place.ws, place.c)
  const writer = useRecordWriter({
    ws: place.ws,
    table: place.c,
    id,
    readable,
    row,
    fields,
  })
  const seed = `${place.c}/${id}/${row ? row.version : ''}/${loading}/${links.isLoading}`
  const ready = useSeededForm({
    writer,
    row,
    links: links.data ?? {},
    id,
    params: place.params,
    loading: loading || links.isLoading,
    seed,
  })
  if (!info)
    return (
      <Page title="Record">
        <NoCollection name={place.c} />
      </Page>
    )
  const save = async () => {
    // A new record leaves the page once it is written; a refused one stays, to say why.
    if ((await writer.save()) === 'written' && !id) navigate(back)
  }
  const remove = async () => {
    if ((await writer.remove()) === 'written') navigate(back)
  }
  return (
    <Page
      title={
        id
          ? textOf(
              row?.[
                fields.find((f) => f.kind === 'text' && !f.system && f.column?.can_select)?.name ??
                  'id'
              ]
            ) || 'Record'
          : `New in ${said.name}`
      }
      crumbs={[
        <Link key="c" to={back}>
          {said.name}
        </Link>,
        id ? 'Record' : 'New',
      ]}
      mark={<ItemMark {...said} size={44} table />}
      actions={
        <>
          {id && info.can_delete && (
            <ActionIcon
              size={44}
              radius="xl"
              variant="light"
              color="red"
              aria-label="Delete"
              title="Delete"
              onClick={() => writer.setDeleting(true)}
            >
              <Trash2 size={20} />
            </ActionIcon>
          )}
          {writer.inForm.some(writer.writable) && (
            <ActionIcon
              size={44}
              radius="xl"
              aria-label="Save"
              title="Save"
              onClick={save}
              disabled={!!id && !writer.form.isDirty()}
            >
              <Save size={20} />
            </ActionIcon>
          )}
        </>
      }
      aside={
        id ? (
          <Stack gap="lg">
            <SystemFields fields={fields} row={row} />
            <RelatedRows fields={childFields} id={id} />
            <Revisions history={history.data} />
          </Stack>
        ) : (
          <CollectionAside schema={place.ws} table={place.c} fields={fields} />
        )
      }
    >
      <Problem error={loaded.error ?? writer.refusal} />
      {id && loaded.isSuccess && !row && (
        <Empty>
          No such record that you may read: it is gone, or a row policy keeps it from you.
        </Empty>
      )}
      <Stack maw={720}>
        {ready &&
          writer.inForm.map((f) => (
            <FieldOf
              key={f.name}
              field={f}
              value={drawnValue(f, links.data ?? {}, writer.form.values)}
              writable={writer.writable(f)}
              error={writer.form.errors[f.name]}
              onChange={(value) => writer.form.setFieldValue(f.name, value)}
            />
          ))}
        {fields.some((f) => !f.system && f.views.record === 'hide') && (
          <Text fz="sm" c="dimmed">
            The owner keeps{' '}
            {fields
              .filter((f) => !f.system && f.views.record === 'hide')
              .map((f) => f.label)
              .join(', ')}{' '}
            out of this form.
          </Text>
        )}
      </Stack>
      <Modal
        opened={writer.deleting}
        onClose={() => writer.setDeleting(false)}
        title="Delete this record?"
      >
        <Group justify="flex-end">
          <Button variant="default" onClick={() => writer.setDeleting(false)}>
            Cancel
          </Button>
          <Button color="red" onClick={remove}>
            Delete
          </Button>
        </Group>
      </Modal>
    </Page>
  )
}
