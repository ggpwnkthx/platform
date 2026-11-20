import {
  columnsOf,
  isSystemWorkspace,
  metadata,
  metadataCollection,
  metadataFilter,
  metadataStart,
  metadataTargetOf,
  records,
  tableOf,
  type Catalog,
} from '@platform/data'
import { fieldTarget, type MetadataEntry, type MetadataTarget } from '@platform/vocabulary'
import { PgError } from '@platform/pg-client'
import { useMemo } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import { Value } from '../fields/renderers.tsx'
import { resolveFields } from '../fields/resolve.ts'
import { ago } from '../format.ts'
import { describe, useLoad, useSession } from '../session.tsx'
import { Empty, Loading, Notice } from '../ui/bits.tsx'
import { InfoIcon, PlusIcon } from '../ui/icons.tsx'
import { Drawer } from '../ui/overlay.tsx'
import { href } from '../url.ts'
import { hasKeyEditor, keyEditorOf, keyEditorsFor } from './registry.ts'

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

const { schema: metaSchema, table: metaTable } = metadataCollection

/** May the reader change an item's metadata? PostgreSQL gives that to the owner of the item. */
export function ownsItem(catalog: Catalog, target: MetadataTarget): boolean {
  if (target.scope === 'workspace')
    return Boolean(catalog.schemas.find((s) => s.name === target.schema)?.can_alter)
  return Boolean(tableOf(catalog, target.schema, target.table ?? '')?.can_alter)
}

/**
 * A refusal of the metadata collection's own, in the reader's words. An item carries a key
 * once — that is the collection's one rule of its own, kept by a unique index — and
 * PostgreSQL's way of saying so names the index, not the rule.
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

/** The address this page is at, so the record form may come back to it. */
function useHere(): string {
  const { url } = useLocation()
  return url
}

/** The record form of one row of the metadata collection, or of a new one about an item. */
function rowHref(id: string, from: string, target?: MetadataTarget): string {
  const start = target ? metadataStart(target) : {}
  return href('/content/item', {
    ws: metaSchema,
    c: metaTable,
    id,
    from,
    ...Object.fromEntries(Object.entries(start).map(([name, value]) => [`v.${name}`, value])),
  })
}

/** The metadata collection itself, filtered to one item: the same rows, in the records grid. */
const collectionHref = (target: MetadataTarget): string =>
  href('/content/records', {
    ws: metaSchema,
    c: metaTable,
    f: JSON.stringify(metadataFilter(target)),
  })

/** The columns the list of an item's keys is drawn with, where the reader may read them. */
const listed = ['id', 'key', 'value', 'updated_by', 'updated_at', 'version']

/**
 * The rows an item carries in the metadata collection, besides the keys that have editors
 * of their own. A key is a link to its row: it is read, changed and removed in the record
 * form, by its id and its version, as every row is.
 */
function MetadataRows({ target, tick }: { target: MetadataTarget; tick?: unknown }) {
  const { catalog } = useSession()
  const here = useHere()
  const info = tableOf(catalog, metaSchema, metaTable)
  const columns = columnsOf(catalog, metaSchema, metaTable)
    .filter((c) => c.can_select && listed.includes(c.name))
    .map((c) => c.name)
  const fields = useMemo(() => resolveFields(catalog, metaSchema, metaTable), [catalog])
  const value = fields.find((field) => field.name === 'value')
  const found = useLoad(
    info && columns.length
      ? (db) =>
          records(db, {
            schema: metaSchema,
            table: metaTable,
            columns,
            searchable: [],
            filter: metadataFilter(target),
            search: '',
            sort: ['key'],
            limit: 200,
            offset: 0,
          })
      : null,
    [target.scope, target.schema, target.table, target.column, catalog, tick]
  )
  if (!info)
    return (
      <Notice tone="warning" title="PostgreSQL shows you no metadata collection">
        Your role has no right on <span class="mono">platform.item_metadata</span>.
      </Notice>
    )
  if (found.error) return <Notice tone="danger" title={describe(found.error).title} />
  if (!found.data) return <Loading />
  const rows = (found.data.rows as Record<string, unknown>[]).filter(
    (row) => !hasKeyEditor(target.scope, String(row.key))
  )
  if (!rows.length)
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
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={String(row.id ?? row.key)}>
            <td class="mono">
              {row.id === undefined ? (
                String(row.key)
              ) : (
                <a class="grid-open" href={rowHref(String(row.id), here)}>
                  {String(row.key)}
                </a>
              )}
            </td>
            <td>
              {value ? (
                <Value value={row.value} field={value} situation="list" />
              ) : (
                JSON.stringify(row.value)
              )}
            </td>
            <td class="cell-muted">
              {String(row.updated_by ?? '')}
              {typeof row.updated_at === 'string' ? `, ${ago(row.updated_at)}` : ''}
              {row.version === undefined ? '' : ` · v${String(row.version)}`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** The links that lead from an item to the collection its metadata is kept in. */
function MetadataLinks({ target, owner }: { target: MetadataTarget; owner: boolean }) {
  const { catalog } = useSession()
  const here = useHere()
  const info = tableOf(catalog, metaSchema, metaTable)
  if (!info) return null
  return (
    <div class="row-actions">
      <a class="button button-secondary button-small" href={collectionHref(target)}>
        Open as a collection
      </a>
      {owner && info.can_insert && (
        <a class="button button-secondary button-small" href={rowHref('+', here, target)}>
          <PlusIcon size={16} aria-hidden="true" />
          <span>Add key</span>
        </a>
      )}
    </div>
  )
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

/** The editors of an item's keys, one under the other, over the item's metadata read once. */
function KeyEditorSections({
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

/**
 * A field's metadata, beside the field: the editors of the keys the interface reads for
 * itself, and the field's other rows in the metadata collection. A field's metadata is as
 * private as the field: PostgreSQL returns the rows of the fields the reader may reach, and
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
