import { useState } from 'preact/hooks'
import { metadata, removeMetadata, setMetadata } from '../db/platform.ts'
import type { MetadataEntry } from '../db/types.ts'
import { ago, display } from '../format.ts'
import { describe, useLoad, useSession } from '../session.tsx'
import { Empty, Loading, Notice } from '../ui/bits.tsx'
import { Button } from '../ui/button.tsx'
import { Field, Input, TextArea } from '../ui/form.tsx'
import { EditIcon, InfoIcon, PlusIcon, TrashIcon } from '../ui/icons.tsx'
import { Drawer } from '../ui/overlay.tsx'

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

/**
 * The metadata of a workspace or a collection: what it is, as opposed to what it holds.
 * Row security decides who reads it and who changes it: the owner of the item.
 */
export function MetadataPanel({
  schema,
  table,
  owner,
}: {
  schema: string
  table: string | null
  owner: boolean
}) {
  const { withDb, notify } = useSession()
  const found = useLoad((db) => metadata(db, schema, table), [schema, table])
  const [editing, setEditing] = useState<{
    key: string
    text: string
    version?: number
    isNew: boolean
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const save = async () => {
    if (!editing) return
    setBusy(true)
    setProblem(null)
    try {
      const affected = await withDb((db) =>
        setMetadata(db, schema, table, editing.key.trim(), parse(editing.text), editing.version)
      )
      if (!affected) {
        setProblem('Someone changed this key since you opened it. Close and open it again.')
        return
      }
      notify({ tone: 'success', title: `Saved ${editing.key}` })
      setEditing(null)
      found.reload()
    } catch (error) {
      setProblem(describe(error).title)
    } finally {
      setBusy(false)
    }
  }
  const remove = async (entry: MetadataEntry) => {
    try {
      const affected = await withDb((db) => removeMetadata(db, schema, table, entry.key))
      notify(
        affected
          ? { tone: 'success', title: `Removed ${entry.key}` }
          : {
              tone: 'error',
              title: 'PostgreSQL removed nothing',
              detail: 'Only the owner may change this metadata.',
            }
      )
      found.reload()
    } catch (error) {
      notify({ tone: 'error', ...describe(error) })
    }
  }
  return (
    <section class="panel">
      <header class="panel-head">
        <div>
          <h2>Metadata</h2>
          <p>
            What this {table ? 'collection' : 'workspace'} is, kept beside it in{' '}
            <span class="mono">platform.item_metadata</span>.{' '}
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
      {found.error ? (
        <Notice tone="danger" title={describe(found.error).title} />
      ) : !found.data ? (
        <Loading />
      ) : found.data.length ? (
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
            {found.data.map((entry) => (
              <tr key={entry.key}>
                <td class="mono">{entry.key}</td>
                <td class={typeof entry.value === 'string' ? '' : 'mono'}>
                  {display(entry.value)}
                </td>
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
                        setEditing({
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
      ) : (
        <Empty icon={<InfoIcon size={24} />} title="No metadata yet">
          Keys such as <span class="mono">purpose</span>, <span class="mono">contact</span> or{' '}
          <span class="mono">display_field</span> describe it for everyone who may reach it.
        </Empty>
      )}
      <Drawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.isNew ? 'Add a metadata key' : `Edit ${editing?.key}`}
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button tone="primary" busy={busy} disabled={!editing?.key.trim()} onClick={save}>
              Save
            </Button>
          </>
        }
      >
        {problem && <Notice tone="danger" title={problem} />}
        {editing && (
          <div class="form">
            <Field label="Key" id="meta-key" wide required hint="1 to 128 characters.">
              <Input
                id="meta-key"
                mono
                value={editing.key}
                disabled={!editing.isNew}
                onInput={(e) => setEditing({ ...editing, key: e.currentTarget.value })}
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
                value={editing.text}
                onInput={(e) => setEditing({ ...editing, text: e.currentTarget.value })}
              />
            </Field>
          </div>
        )}
      </Drawer>
    </section>
  )
}
