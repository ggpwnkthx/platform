import { useMemo, useState } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import { fieldMetadata, presentationOf, tableOf, tablesIn } from '@platform/data'
import { fieldTarget, fieldsViewsStatement } from '@platform/vocabulary'
import { CollectionAccess, FieldAccess } from '../../access/collections/access.tsx'
import { RunnerProblem, useRunner } from '../../access/runner.tsx'
import { resolveFields } from '../../fields/resolve.ts'
import { FieldMetadataDrawer } from '../../metadata/drawer.tsx'
import { Page } from '../../shell/page.tsx'
import { useWorkspace } from '../../workspace/view.ts'
import { useLoad, useSession } from '../../session.tsx'
import { href } from '../../url.ts'
import { Notice } from '../../ui/bits.tsx'
import { Action } from '../../ui/button.tsx'
import { CollectionIcon, iconFor, PlusIcon, TagIcon, TrashIcon } from '../../ui/icons.tsx'
import { CollectionAbout } from './about.tsx'
import { AddFieldDrawer, DeleteCollectionConfirm, DropFieldConfirm } from './drawers.tsx'
import { CollectionFields } from './fields.tsx'
import { CollectionTabs } from './tabs.tsx'
import { commentStatement, emptyField, fieldStatements, type FieldDraft } from '../statements.ts'
import { usePreview } from '../preview.ts'
import { Button } from '../../ui/button.tsx'

/** The model of one collection: its fields, its note, and who reaches it. */
export function CollectionModel() {
  const { catalog, presentations } = useSession()
  const location = useLocation()
  const ws = useWorkspace()
  const table = location.query.c ?? ''
  const tab = location.query.tab ?? 'fields'
  const info = tableOf(catalog, ws, table)
  const shown = presentationOf(presentations, ws, table)
  const workspace = presentationOf(presentations, ws)
  const CollectionGlyph = iconFor(shown.icon) ?? CollectionIcon
  const runner = useRunner()
  const [adding, setAdding] = useState<FieldDraft | null>(null)
  const [dropping, setDropping] = useState<string | null>(null)
  const [described, setDescribed] = useState<string | null>(null)
  const [accessOf, setAccessOf] = useState<string | null>(null)
  // What each field says of itself: its name, where it appears and how it is drawn. It is
  // read again whenever the catalog is, since a statement that ran may have changed it.
  const about = useLoad(info ? (db) => fieldMetadata(db, ws, table) : null, [ws, table, catalog])
  const fields = useMemo(
    () => resolveFields(catalog, ws, table, about.data),
    [catalog, ws, table, about.data]
  )
  // The fields that say nothing yet: every field carries its own views, and these do not.
  const missing = about.data ? fields.filter((field) => !field.hasViews) : []
  const [deleting, setDeleting] = useState(false)
  const [confirmName, setConfirmName] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const owner = Boolean(info?.can_alter)
  const others = tablesIn(catalog, ws).map((t) => t.name)
  const addPreview = usePreview(
    async () => (adding ? fieldStatements(ws, table, adding) : []),
    [JSON.stringify(adding)]
  )
  if (!info)
    return (
      <Page title={table || 'Collection'} icon={<CollectionIcon size={22} />}>
        <Notice
          tone="warning"
          title={`The database shows you no collection named ${ws}.${table}`}
        />
      </Page>
    )
  return (
    <Page
      title={shown.displayName ?? table}
      icon={<CollectionGlyph size={22} />}
      presentation={shown}
      crumbs={[
        { label: 'Data model', href: href('/model', { ws }) },
        { label: workspace.displayName ?? ws },
      ]}
      subtitle={
        owner
          ? `You own ${ws}.${table}: its model and its access are yours.`
          : `Owned by ${info.owner}. You may read its model; the database gives changes to the owner.`
      }
      actions={
        <>
          {owner && info.kind !== 'v' && (
            <Action
              tone="danger"
              label="Delete collection"
              icon={<TrashIcon size={20} />}
              onClick={() => setDeleting(true)}
            />
          )}
          {owner && info.kind !== 'v' && tab === 'fields' && (
            <Action
              label="Add field"
              icon={<PlusIcon size={22} />}
              onClick={() => setAdding(emptyField())}
            />
          )}
        </>
      }
      toolbar={<CollectionTabs ws={ws} table={table} tab={tab} />}
    >
      <RunnerProblem runner={runner} />
      {tab === 'about' ? (
        <CollectionAbout
          ws={ws}
          table={table}
          owner={owner}
          comment={info.comment ?? null}
          note={note}
          setNote={setNote}
          saving={runner.busy}
          onSave={async () => {
            if (await runner.runStatements([commentStatement(ws, table, note ?? '')], 'Note saved'))
              setNote(null)
          }}
        />
      ) : tab === 'access' ? (
        <CollectionAccess table={info} />
      ) : (
        <>
          {owner && about.data && missing.length > 0 && (
            <div class="row-actions row-start">
              <Button
                icon={<TagIcon size={16} />}
                busy={runner.busy}
                onClick={() =>
                  runner.runStatements(
                    [fieldsViewsStatement(missing.map((c) => fieldTarget(ws, table, c.name)))],
                    'Every field carries its own views'
                  )
                }
              >
                Give every field its own views
              </Button>
            </div>
          )}
          <CollectionFields
            ws={ws}
            table={table}
            info={info}
            catalog={catalog}
            fields={fields}
            owner={owner}
            onDescribe={setDescribed}
            onAccess={setAccessOf}
            onDrop={setDropping}
          />
        </>
      )}
      <FieldMetadataDrawer
        schema={ws}
        table={table}
        column={described ?? ''}
        owner={owner}
        open={described !== null}
        onClose={() => setDescribed(null)}
      />
      <FieldAccess schema={ws} table={table} column={accessOf} onClose={() => setAccessOf(null)} />
      <AddFieldDrawer
        table={table}
        adding={adding}
        setAdding={setAdding}
        collections={others}
        preview={addPreview}
        runner={runner}
        onDone={() => undefined}
      />
      <DropFieldConfirm
        ws={ws}
        table={table}
        dropping={dropping}
        setDropping={setDropping}
        runner={runner}
      />
      <DeleteCollectionConfirm
        ws={ws}
        table={table}
        deleting={deleting}
        setDeleting={setDeleting}
        confirmName={confirmName}
        setConfirmName={setConfirmName}
        runner={runner}
      />
    </Page>
  )
}
