import { labelColumn } from '@platform/data'
import { MetadataRowEditor } from '../../metadata/drawer.tsx'
import { Page } from '../../shell/page.tsx'
import { href } from '../../url.ts'
import { Notice } from '../../ui/bits.tsx'
import { CollectionIcon, BackIcon } from '../../ui/icons.tsx'
import { RecordActions, RecordBody } from './body.tsx'
import { useRecordForm } from './form.ts'
import { crumbsOf, recordTitle } from './helpers.ts'
import { useRecordPage } from './page.ts'
import { DeleteRecord, RecordSidebar } from './side.tsx'
import { useRecordWriter } from './writer.ts'

export function Item() {
  const page = useRecordPage()
  const {
    all,
    catalog,
    collection,
    creating,
    fields,
    from,
    id,
    info,
    loaded,
    original,
    readable,
    refresh,
    startText,
    table,
    unreachable,
    version,
    wanted,
    withheld,
    workspace,
    ws,
  } = page
  const form = useRecordForm({
    creating,
    fields,
    id,
    original,
    startText,
    table,
    ws,
    version,
  })
  const writer = useRecordWriter({
    creating,
    errors: form.errors,
    from,
    id,
    info,
    onSaved: () => form.setDraft({}),
    readable,
    refresh,
    reload: loaded.reload,
    startText,
    table,
    values: form.values,
    version,
    ws,
  })
  const { formRef, saving, confirming, setConfirming, problem, save, remove } = writer

  const back = from ?? href('/content/records', { ws, c: table })
  if (!info)
    return (
      <Page title="Record" icon={<CollectionIcon size={22} />}>
        <Notice
          tone="warning"
          title={`The database shows you no collection named ${ws}.${table}`}
        />
      </Page>
    )
  const title = creating ? `New record` : recordTitle(labelColumn(catalog, ws, table), original, id)
  // A record that did not load offers nothing to save or delete.
  const present = creating || Boolean(original)
  const canDelete = !creating && info.can_delete && present
  const dirty = form.changed.length > 0
  return (
    <Page
      title={title}
      icon={
        <a href={back} class="header-back" aria-label={from ? 'Back' : `Back to ${table}`}>
          <BackIcon size={20} />
        </a>
      }
      crumbs={crumbsOf(workspace, collection, ws, table)}
      actions={
        <RecordActions
          canDelete={canDelete}
          creating={creating}
          dirty={dirty}
          errors={form.errors}
          formRef={formRef}
          saving={saving}
          setConfirming={setConfirming}
          present={present}
        />
      }
      sidebar={
        <RecordSidebar
          all={all}
          creating={creating}
          id={id}
          original={original}
          table={table}
          ws={ws}
        />
      }
    >
      {problem && (
        <Notice tone="danger" title={problem.title}>
          {problem.detail}
        </Notice>
      )}
      <RecordBody
        form={{
          errors: form.errors,
          fields,
          formRef,
          onChange: (name, text) => form.setDraft({ ...form.draft, [name]: text }),
          save,
          statement: form.statement,
          textOf: form.textOf,
          unreachable,
          values: form.values,
          version,
          withheld,
        }}
        record={{
          creating,
          hasData: Boolean(loaded.data),
          labels: loaded.data?.labels ?? {},
          original,
          problem: loaded.error,
          wanted,
        }}
      />
      {!creating && original && (
        <MetadataRowEditor schema={ws} table={table} row={original} onSaved={loaded.reload} />
      )}
      <DeleteRecord
        confirming={confirming}
        remove={remove}
        saving={saving}
        setConfirming={setConfirming}
        table={table}
        version={version}
        ws={ws}
      />
    </Page>
  )
}
