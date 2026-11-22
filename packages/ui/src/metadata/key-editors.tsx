import type { MetadataEntry, MetadataTarget } from '@platform/vocabulary'
import { keyEditorOf, keyEditorsFor } from './registry.ts'

/** The editors of an item's keys, one under the other, over the item's metadata read once. */
export function KeyEditorSections({
  target,
  owner,
  entries,
  only,
  onSaved,
}: {
  target: MetadataTarget
  owner: boolean
  entries: MetadataEntry[]
  /** The one key whose editor is shown; without it, every editor of this kind of item. */
  only?: string
  onSaved: () => void
}) {
  const one = only === undefined ? null : keyEditorOf(target.scope, only)
  const editors = only === undefined ? keyEditorsFor(target.scope) : one ? [one] : []
  return (
    <>
      {editors.map(({ name, title, note, Editor }) => (
        <div key={name} class="drawer-section">
          <div>
            <h3 class="drawer-title">{title}</h3>
            {note && <p class="drawer-note">{note(target)}</p>}
          </div>
          <Editor target={target} owner={owner} entries={entries} onSaved={onSaved} />
        </div>
      ))}
    </>
  )
}
