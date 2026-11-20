import type { FunctionComponent } from 'preact'
import type { MetadataEntry, MetadataScope, MetadataTarget } from '@platform/vocabulary'
import { platformKeyEditors } from './editors/builtin.tsx'

/**
 * The key editors the interface holds: the platform's own, and the installation's.
 *
 * Metadata is a collection, and a piece of it is a row: a key, and a JSON value. Most keys
 * are just that, and are changed in the record form. A few mean something the interface
 * reads for itself — where a field appears, how it is drawn, how an item is named — and a
 * raw document is the wrong form for those. A key editor is the right one: it is given the
 * item and the rows it carries, and it draws the form that changes its keys.
 *
 * It is the same seam a field type is (`fields/registry.ts`): the platform registers its
 * own, and an installation that keeps a key of its own — a retention rule, a review policy —
 * may register an editor for it in its extensions. An editor edits; it does not decide.
 * The database's row security still says who may change an item's metadata.
 */

/** What a key editor is given. */
export interface KeyEditorProps {
  /** The item whose metadata is edited. */
  target: MetadataTarget
  /** May the reader change the item's metadata? An editor that may not is drawn as read. */
  owner: boolean
  /** The item's own metadata, as its owner and its readers may see it. */
  entries: MetadataEntry[]
  /** Told once a change is saved, so the item's metadata may be read again. */
  onSaved?: () => void
}

/** One editor of one or more keys. */
export interface MetadataKeyEditor {
  /** The name the editor is known by. */
  name: string
  /** What it edits, as a heading. */
  title: string
  /** What it edits, in a sentence, of the item it is shown for. */
  note?: (target: MetadataTarget) => string
  /** The keys it edits. They are its own: they are not listed among an item's other keys. */
  keys: readonly string[]
  /** The kinds of item whose keys it edits. */
  scopes: readonly MetadataScope[]
  /** The form that changes them. */
  Editor: FunctionComponent<KeyEditorProps>
}

/** The editors held, by name, in the order they were added. */
const held = new Map<string, MetadataKeyEditor>(
  platformKeyEditors.map((editor) => [editor.name, editor])
)

/**
 * Adds a key editor of the installation's own, or replaces one the platform holds by taking
 * its name.
 */
export function registerMetadataKeyEditor(editor: MetadataKeyEditor): void {
  held.set(editor.name, editor)
}

/** Every key editor held, in the order they were added. */
export function knownKeyEditors(): MetadataKeyEditor[] {
  return [...held.values()]
}

/** The editors of one kind of item, in the order they are shown. */
export function keyEditorsFor(scope: MetadataScope): MetadataKeyEditor[] {
  return knownKeyEditors().filter((editor) => editor.scopes.includes(scope))
}

/**
 * The editor of one key of one kind of item, if it has one. Of two that edit the same key,
 * the one added last is the key's, so an installation's own wins over the platform's.
 */
export function keyEditorOf(scope: MetadataScope, key: string): MetadataKeyEditor | null {
  return keyEditorsFor(scope).findLast((editor) => editor.keys.includes(key)) ?? null
}

/** Does the key have an editor of its own, for this kind of item? */
export function hasKeyEditor(scope: MetadataScope, key: string): boolean {
  return keyEditorOf(scope, key) !== null
}
