import { useState } from 'preact/hooks'
import { ago, display } from '../format.ts'
import { describe, useLoad, useSession } from '../session.tsx'
import { Empty, Loading, Notice } from '../ui/bits.tsx'
import { Button } from '../ui/button.tsx'
import { Field, Input, TextArea } from '../ui/form.tsx'
import { EditIcon, InfoIcon, PlusIcon, TrashIcon } from '../ui/icons.tsx'
import { Drawer } from '../ui/overlay.tsx'
import { PresentationEditor } from './editors/presentation.tsx'
import { RenderersEditor } from './editors/renderers.tsx'
import { ViewsEditor } from './editors/views.tsx'
import { metadata, removeMetadata, setMetadata } from '@platform/data'
import {
  fieldTarget,
  type MetadataEntry,
  type MetadataTarget,
  isReservedKey,
} from '@platform/vocabulary'

/**
 * The metadata of an item, as panels and drawers: the keys it carries, the form that changes
 * one, and — for a field — the editors of the keys the interface reads for itself. Those
 * editors live in `editors/`; what is here is everything around them.
 */

/** A value as the editor shows it: a string as itself, anything else as JSON. */
const asText = (value: unknown) =>
  typeof value === 'string' ? value : JSON.stringify(value, null, 2)

function parse(text: string): unknown {
  const trimmed = text.trim()
  if (/^[[{"]|^(true|false|null|-?\d+(\.\d+)?)$/.test(trimmed)) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return text
    }
  }
  return text
}

/** The key being edited, and the value it holds. */
interface Editing {
  key: string
  text: string
  version?: number
  isNew: boolean
}

/** The presentation of a workspace or a collection, as a panel of its own. */
export function PresentationPanel({ target, owner }: { target: MetadataTarget; owner: boolean }) {
  const item = target.scope
  return (
    <section class="panel">
      <header class="panel-head">
        <div>
          <h2>Presentation</h2>
          <p>
            How this {item} is named and marked. It is three keys of its metadata, so PostgreSQL
            keeps its rules: {owner ? 'you own it, so you may change it' : 'only its owner may'}.
          </p>
        </div>
      </header>
      <PresentationEditor target={target} owner={owner} />
    </section>
  )
}

/**
 * The metadata of an item: what it is, as opposed to what it holds. Row security decides who
 * reads it and who changes it: the owner of the item.
 */
export function MetadataPanel({ target, owner }: { target: MetadataTarget; owner: boolean }) {
  const item = target.scope
  const [editing, setEditing] = useState<Editing | null>(null)
  return (
    <section class="panel">
      <header class="panel-head">
        <div>
          <h2>Metadata</h2>
          <p>
            What this {item} is, kept beside it in <span class="mono">platform.item_metadata</span>.{' '}
            {owner ? 'You own it, so you may change it.' : 'Only its owner may change it.'}
          </p>
        </div>
        {owner && (
          <Button
            icon={<PlusIcon size={16} />}
            onClick={() => setEditing({ key: '', text: '', isNew: true })}
          >
            Add key
          </Button>
        )}
      </header>
      <MetadataKeys target={target} owner={owner} onEdit={setEditing} />
      <KeyDrawer
        editing={editing}
        target={target}
        onClose={() => setEditing(null)}
        onSaved={() => setEditing(null)}
      />
    </section>
  )
}

/** The keys an item carries, and the buttons that change them. */
function MetadataKeys({
  target,
  owner,
  onEdit,
  entries,
  onChanged,
}: {
  target: MetadataTarget
  owner: boolean
  onEdit: (editing: Editing) => void
  /** The keys already read; without them the component reads them itself. */
  entries?: MetadataEntry[]
  /** Told when a key was removed, so the reader may read the keys again. */
  onChanged?: () => void
}) {
  const { withDb, notify } = useSession()
  const found = useLoad(entries ? null : (db) => metadata(db, target), [
    target.scope,
    target.schema,
    target.table,
    target.column,
  ])
  const rows = entries ?? found.data
  const remove = async (entry: MetadataEntry) => {
    try {
      const affected = await withDb((db) => removeMetadata(db, target, entry.key))
      notify(
        affected
          ? { tone: 'success', title: `Removed ${entry.key}` }
          : {
              tone: 'error',
              title: 'PostgreSQL removed nothing',
              detail: 'Only the owner may change this metadata.',
            }
      )
      if (onChanged) onChanged()
      else found.reload()
    } catch (error) {
      notify({ tone: 'error', ...describe(error) })
    }
  }
  // The keys the interface reads for itself have editors of their own; the rest of the
  // metadata is listed here.
  const others = (rows ?? []).filter((entry) => !isReservedKey(target.scope, entry.key))
  if (found.error) return <Notice tone="danger" title={describe(found.error).title} />
  if (!rows) return <Loading />
  if (!others.length)
    return (
      <Empty icon={<InfoIcon size={24} />} title="No other metadata yet">
        Keys such as <span class="mono">purpose</span>, <span class="mono">contact</span> or{' '}
        <span class="mono">display_field</span> describe it for everyone who may reach it.
      </Empty>
    )
  return (
    <table class="grid grid-plain">
      <thead>
        <tr>
          <th>Key</th>
          <th>Value</th>
          <th>Changed</th>
          {owner && (
            <th class="grid-actions">
              <span class="sr-only">Actions</span>
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {others.map((entry) => (
          <tr key={entry.key}>
            <td class="mono">{entry.key}</td>
            <td class={typeof entry.value === 'string' ? '' : 'mono'}>{display(entry.value)}</td>
            <td class="cell-muted">
              {entry.updated_by}, {ago(entry.updated_at)} · v{entry.version}
            </td>
            {owner && (
              <td class="grid-actions">
                <button
                  type="button"
                  class="icon-button"
                  aria-label={`Edit ${entry.key}`}
                  onClick={() =>
                    onEdit({
                      key: entry.key,
                      text: asText(entry.value),
                      version: entry.version,
                      isNew: false,
                    })
                  }
                >
                  <EditIcon size={16} />
                </button>
                <button
                  type="button"
                  class="icon-button"
                  aria-label={`Remove ${entry.key}`}
                  onClick={() => remove(entry)}
                >
                  <TrashIcon size={16} />
                </button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** The form that changes one key of an item's metadata. */
function KeyForm({
  editing,
  target,
  onClose,
  onSaved,
}: {
  editing: Editing
  target: MetadataTarget
  onClose: () => void
  onSaved: () => void
}) {
  const { withDb, notify } = useSession()
  const [draft, setDraft] = useState(editing)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const save = async () => {
    setBusy(true)
    setProblem(null)
    try {
      const affected = await withDb((db) =>
        setMetadata(db, target, draft.key.trim(), parse(draft.text), draft.version)
      )
      if (!affected) {
        setProblem('Someone changed this key since you opened it. Close and open it again.')
        return
      }
      notify({ tone: 'success', title: `Saved ${draft.key}` })
      onSaved()
    } catch (error) {
      setProblem(describe(error).title)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div class="form">
      {problem && <Notice tone="danger" title={problem} />}
      <Field label="Key" id="meta-key" wide required hint="1 to 128 characters.">
        <Input
          id="meta-key"
          mono
          value={draft.key}
          disabled={!draft.isNew}
          onInput={(e) => setDraft({ ...draft, key: e.currentTarget.value })}
        />
      </Field>
      <Field
        label="Value"
        id="meta-value"
        wide
        hint="Plain text is stored as a string; JSON (an object, a list, a number, true) is stored as itself."
      >
        <TextArea
          id="meta-value"
          rows={6}
          value={draft.text}
          onInput={(e) => setDraft({ ...draft, text: e.currentTarget.value })}
        />
      </Field>
      <div class="row-actions field-wide">
        <Button onClick={onClose}>Cancel</Button>
        <Button tone="primary" busy={busy} disabled={!draft.key.trim()} onClick={save}>
          Save
        </Button>
      </div>
    </div>
  )
}

/** The drawer that changes one key of an item's metadata. */
function KeyDrawer({
  editing,
  target,
  onClose,
  onSaved,
}: {
  editing: Editing | null
  target: MetadataTarget
  onClose: () => void
  onSaved: () => void
}) {
  return (
    <Drawer
      open={editing !== null}
      onClose={onClose}
      title={editing?.isNew ? 'Add a metadata key' : `Edit ${editing?.key}`}
    >
      {editing && <KeyForm editing={editing} target={target} onClose={onClose} onSaved={onSaved} />}
    </Drawer>
  )
}

/**
 * A field's metadata, in a drawer: the name it is read by, and the keys it carries. A field's
 * metadata is as private as the field: PostgreSQL returns the rows of the fields the reader may
 * reach, and no others.
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
  const [editing, setEditing] = useState<Editing | null>(null)
  // The field's own metadata, read once: the editor of where it appears and the list of the
  // keys it carries are two views of the same rows.
  const found = useLoad(
    (db) => metadata(db, target),
    [target.scope, target.schema, target.table, target.column]
  )
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`Metadata of ${column}`}
      subtitle="What this field is, kept beside it in platform.item_metadata."
    >
      {editing ? (
        <KeyForm
          editing={editing}
          target={target}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      ) : !found.data ? (
        <Loading />
      ) : (
        <>
          <PresentationEditor target={target} owner={owner} />
          <div class="drawer-section">
            <div>
              <h3 class="drawer-title">Where it appears</h3>
              <p class="drawer-note">
                The list, the record and the filters. A field may be shown in one and hidden in
                another; PostgreSQL still decides who may read it and who may write it.
              </p>
            </div>
            <ViewsEditor
              target={target}
              owner={owner}
              entries={found.data}
              onSaved={found.reload}
            />
          </div>
          <div class="drawer-section">
            <div>
              <h3 class="drawer-title">How it is drawn</h3>
              <p class="drawer-note">
                A value may be drawn differently in each place it appears: a uuid is eight
                characters in the grid and thirty-six in the record. The saying is the field's own
                metadata, so PostgreSQL keeps its rules.
              </p>
            </div>
            <RenderersEditor
              target={target}
              owner={owner}
              entries={found.data}
              onSaved={found.reload}
            />
          </div>
          <div class="drawer-section">
            <div class="row-actions row-start">
              {owner && (
                <Button
                  icon={<PlusIcon size={16} />}
                  onClick={() => setEditing({ key: '', text: '', isNew: true })}
                >
                  Add key
                </Button>
              )}
            </div>
            <MetadataKeys
              target={target}
              owner={owner}
              onEdit={setEditing}
              entries={found.data}
              onChanged={found.reload}
            />
          </div>
        </>
      )}
    </Drawer>
  )
}
