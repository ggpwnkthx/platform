import { isSystemWorkspace, metadata, metadataCollection, metadataTargetOf } from '@platform/data'
import { fieldTarget } from '@platform/vocabulary'
import { describe, useLoad, useSession } from '../session.tsx'
import { Loading, Notice } from '../ui/bits.tsx'
import { Drawer } from '../ui/overlay.tsx'
import { KeyEditorSections } from './key-editors.tsx'
import { ownsItem } from './shared.ts'
import { MetadataLinks, MetadataRows } from './rows.tsx'
import { keyEditorOf } from './registry.ts'

const { schema: metaSchema, table: metaTable } = metadataCollection

/**
 * A field's metadata, beside the field: the editors of the keys the interface reads for
 * itself, and the field's other rows in the metadata collection. A field's metadata is as
 * private as the field: the database returns the rows of the fields the reader may reach, and
 * no others.
 */
export function FieldMetadataDrawer({
  schema,
  table,
  column,
  owner,
  open,
  onClose,
}: {
  schema: string
  table: string
  column: string
  owner: boolean
  open: boolean
  onClose: () => void
}) {
  const target = fieldTarget(schema, table, column)
  const found = useLoad(open ? (db) => metadata(db, target) : null, [
    open,
    target.scope,
    target.schema,
    target.table,
    target.column,
  ])
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`Metadata of ${column}`}
      subtitle="What this field is: its rows in the system collection platform.item_metadata."
    >
      {found.error ? (
        <Notice tone="danger" title={describe(found.error).title} />
      ) : !found.data ? (
        <Loading />
      ) : (
        <>
          <KeyEditorSections
            target={target}
            owner={owner}
            entries={found.data}
            onSaved={found.reload}
          />
          <div class="drawer-section">
            <div>
              <h3 class="drawer-title">Other keys</h3>
              <p class="drawer-note">
                Every other key the field carries. A key is a row of the metadata collection: it is
                opened, changed and removed in the record form.
              </p>
            </div>
            <MetadataLinks target={target} owner={owner} />
            <MetadataRows target={target} tick={found.data} />
          </div>
        </>
      )}
    </Drawer>
  )
}

/**
 * Under a row of the metadata collection, in the record form: the editor of its key, when
 * the key has one. The row is still a row — its value is still there to read — but a key
 * the interface reads for itself is changed in the form made for it, about the item the row
 * names.
 */
export function MetadataRowEditor({
  schema,
  table,
  row,
  onSaved,
}: {
  schema: string
  table: string
  row: Record<string, unknown> | null
  onSaved: () => void
}) {
  const { catalog } = useSession()
  const ours = isSystemWorkspace(catalog, schema) && schema === metaSchema && table === metaTable
  const target = ours ? metadataTargetOf(row) : null
  const key = typeof row?.key === 'string' ? row.key : ''
  const editor = target ? keyEditorOf(target.scope, key) : null
  const found = useLoad(target && editor ? (db) => metadata(db, target) : null, [
    target?.scope,
    target?.schema,
    target?.table,
    target?.column,
    key,
    row?.version,
  ])
  if (!target || !editor) return null
  return (
    <section class="panel">
      <header class="panel-head">
        <div>
          <h2>{editor.title}</h2>
          <p>
            <span class="mono">{key}</span> is a key the interface reads for itself, so it has an
            editor of its own. What it saves is this row.
          </p>
        </div>
      </header>
      {found.error ? (
        <Notice tone="danger" title={describe(found.error).title} />
      ) : !found.data ? (
        <Loading />
      ) : (
        <KeyEditorSections
          target={target}
          owner={ownsItem(catalog, target)}
          entries={found.data}
          only={key}
          onSaved={() => {
            found.reload()
            onSaved()
          }}
        />
      )}
    </section>
  )
}
