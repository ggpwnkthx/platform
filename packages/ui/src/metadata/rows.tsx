import { columnsOf, metadataFilter, records, tableOf } from '@platform/data'
import type { MetadataTarget } from '@platform/vocabulary'
import { useMemo } from 'preact/hooks'
import { Value } from '../fields/renderers/renderers.tsx'
import { resolveFields } from '../fields/resolve.ts'
import { ago } from '../format.ts'
import { describe, useLoad, useSession } from '../session.tsx'
import { Empty, Loading, Notice } from '../ui/bits.tsx'
import { InfoIcon, PlusIcon } from '../ui/icons.tsx'
import { hasKeyEditor } from './registry.ts'
import { collectionHref, listed, metaSchema, metaTable, rowHref, useHere } from './shared.ts'

/**
 * The rows an item carries in the metadata collection, besides the keys that have editors
 * of their own. A key is a link to its row: it is read, changed and removed in the record
 * form, by its id and its version, as every row is.
 */
export function MetadataRows({ target, tick }: { target: MetadataTarget; tick?: unknown }) {
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
      <Notice tone="warning" title="The database shows you no metadata collection">
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
export function MetadataLinks({ target, owner }: { target: MetadataTarget; owner: boolean }) {
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
