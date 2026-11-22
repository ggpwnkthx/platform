import clsx from 'clsx'
import type { Catalog, TableInfo } from '@platform/data'
import type { Field } from '../../fields/field.ts'
import { shortType } from '../../format.ts'
import { Badge } from '../../ui/bits.tsx'
import { KeyIcon, LockIcon, RelationIcon, TagIcon, TrashIcon } from '../../ui/icons.tsx'
import { describeConstraint, FieldLacks, FieldRenderers, FieldViews } from './cells.tsx'

/** The fields of one collection, and what the reader may do with each of them. */
export function CollectionFields({
  ws,
  table,
  info,
  catalog,
  fields,
  owner,
  onDescribe,
  onAccess,
  onDrop,
}: {
  ws: string
  table: string
  info: TableInfo
  catalog: Catalog
  fields: Field[]
  owner: boolean
  onDescribe: (column: string) => void
  onAccess: (column: string) => void
  onDrop: (column: string) => void
}) {
  const constraintsOf = (column: string) =>
    catalog.constraints.filter(
      (c) => c.schema === ws && c.table === table && c.type !== 'p' && c.columns.includes(column)
    )
  return (
    <div class="grid-wrap">
      <table class="grid">
        <thead>
          <tr>
            <th>Field</th>
            <th>Type</th>
            <th>Views</th>
            <th>Drawn as</th>
            <th>Required</th>
            <th>Default</th>
            <th>Constraints</th>
            <th>You lack</th>
            <th>Note</th>
            <th class="grid-actions">
              <span class="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {fields.map((field) => {
            const { column: c, relation, system } = field
            return (
              <tr key={c.name} class={clsx(system && 'is-system')}>
                <td>
                  <span class="mono strong">{c.name}</span>
                  {field.named && <span class="field-alias">{field.label}</span>}
                  {system && <Badge tone="outline">system</Badge>}
                </td>
                <td class="mono">
                  {relation ? (
                    <span>
                      <RelationIcon size={13} aria-hidden="true" /> {relation.target_table}
                    </span>
                  ) : (
                    <span>
                      {shortType(c.type)}
                      {c.generated && <Badge tone="outline">generated</Badge>}
                      {c.identity && <Badge tone="outline">identity</Badge>}
                    </span>
                  )}
                </td>
                <td>
                  <FieldViews field={field} />
                </td>
                <td>
                  <FieldRenderers field={field} />
                </td>
                <td>{c.required ? 'yes' : ''}</td>
                <td class="mono cell-muted">
                  <span class="clip clip-narrow" title={c.default ?? undefined}>
                    {c.default}
                  </span>
                </td>
                <td>
                  {constraintsOf(c.name).map((k) => (
                    <code key={k.name} class="constraint" title={k.definition}>
                      {describeConstraint(catalog, ws, table, c.name, k)}
                    </code>
                  ))}
                </td>
                <td>
                  <FieldLacks field={field} />
                </td>
                <td class="cell-muted">
                  <span class="clip clip-narrow" title={c.comment ?? undefined}>
                    {c.comment}
                  </span>
                </td>
                <td class="grid-actions">
                  <button
                    type="button"
                    class="icon-button"
                    aria-label={`Metadata of ${c.name}`}
                    title="Metadata"
                    onClick={() => onDescribe(c.name)}
                  >
                    <TagIcon size={16} />
                  </button>
                  <button
                    type="button"
                    class="icon-button"
                    aria-label={`Access to ${c.name}`}
                    title="Who holds this field"
                    onClick={() => onAccess(c.name)}
                  >
                    <KeyIcon size={16} />
                  </button>
                  {owner && !system && info.kind !== 'v' && (
                    <button
                      type="button"
                      class="icon-button"
                      aria-label={`Drop ${c.name}`}
                      title="Drop field"
                      onClick={() => onDrop(c.name)}
                    >
                      <TrashIcon size={16} />
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {!owner && (
        <p class="grid-note">
          <LockIcon size={14} aria-hidden="true" /> The database gives ALTER TABLE to the owner,{' '}
          {info.owner}, and its members.
        </p>
      )}
    </div>
  )
}
