import { metadata } from '@platform/data'
import type { MetadataTarget } from '@platform/vocabulary'
import { PgError } from '@platform/pg-client'
import { describe, useLoad } from '../session.tsx'
import { Loading, Notice } from '../ui/bits.tsx'
import { MetadataLinks, MetadataRows } from './rows.tsx'
import { keyEditorsFor } from './registry.ts'
import { metaSchema, metaTable } from './shared.ts'

/**
 * The metadata of an item, where the item is shown.
 *
 * Metadata is a system collection — `platform.item_metadata` — and nothing here is a second
 * way of reading or changing it. What an item carries is that collection, filtered to the
 * item: read by the question every collection is read by, drawn by the fields every
 * collection is drawn by, and changed in the record form every row is changed in. The keys
 * the interface reads for itself have editors of their own, held in `registry.ts`; what is
 * left here is where the two are put — beside the item they are about.
 */

/**
 * A refusal of the metadata collection's own, in the reader's words. An item carries a key
 * once — that is the collection's one rule of its own, kept by a unique index — and
 * The database's way of saying so names the index, not the rule.
 */
export function metadataRefusal(
  schema: string,
  table: string,
  error: unknown
): { title: string; detail?: string } | null {
  if (schema !== metaSchema || table !== metaTable) return null
  if (!(error instanceof PgError) || error.code !== '23505') return null
  return {
    title: 'This item already carries that key',
    detail:
      'An item has one row for each key. Open the row it already has and change its value, or give this one another key.',
  }
}

/**
 * The metadata of an item: what it is, as opposed to what it holds. It is the metadata
 * collection, filtered to the item; row security decides who reads it and who changes it.
 */
export function MetadataPanel({ target, owner }: { target: MetadataTarget; owner: boolean }) {
  const item = target.scope
  return (
    <section class="panel">
      <header class="panel-head">
        <div>
          <h2>Metadata</h2>
          <p>
            What this {item} is: its rows in the system collection{' '}
            <span class="mono">platform.item_metadata</span>.{' '}
            {owner ? 'You own it, so you may change them.' : 'Only its owner may change them.'}
          </p>
        </div>
        <MetadataLinks target={target} owner={owner} />
      </header>
      <MetadataRows target={target} />
    </section>
  )
}

/**
 * The keys of an item that have editors of their own, each in a panel: one panel for every
 * editor registered for this kind of item.
 */
export function KeyEditorPanels({ target, owner }: { target: MetadataTarget; owner: boolean }) {
  const editors = keyEditorsFor(target.scope)
  const found = useLoad(editors.length ? (db) => metadata(db, target) : null, [
    target.scope,
    target.schema,
    target.table,
    target.column,
  ])
  return (
    <>
      {editors.map(({ name, title, note, Editor }) => (
        <section key={name} class="panel">
          <header class="panel-head">
            <div>
              <h2>{title}</h2>
              {note && <p>{note(target)}</p>}
            </div>
          </header>
          {found.data ? (
            <Editor target={target} owner={owner} entries={found.data} onSaved={found.reload} />
          ) : found.error ? (
            <Notice tone="danger" title={describe(found.error).title} />
          ) : (
            <Loading />
          )}
        </section>
      ))}
    </>
  )
}
