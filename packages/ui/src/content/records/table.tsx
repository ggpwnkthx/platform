import clsx from 'clsx'
import type { ColumnInfo } from '@platform/data'
import { Value } from '../../fields/renderers/renderers.tsx'
import type { Field } from '../../fields/field.ts'
import { ArrowDownIcon, ArrowUpIcon, LockIcon } from '../../ui/icons.tsx'

/** The head of the list: the fields, in the order they are read, and the hidden ones. */
export function RecordsHead({
  fields,
  hidden,
  sort,
  canDelete,
  allSelected,
  onSort,
  onSelectAll,
}: {
  fields: Field[]
  hidden: ColumnInfo[]
  sort: string[]
  canDelete: boolean
  allSelected: boolean
  onSort: (name: string) => void
  onSelectAll: (checked: boolean) => void
}) {
  return (
    <thead>
      <tr>
        {canDelete && (
          <th class="grid-check sticky">
            <input
              type="checkbox"
              aria-label="Select every record on this page"
              checked={allSelected}
              onChange={(e) => onSelectAll(e.currentTarget.checked)}
            />
          </th>
        )}
        {fields.map((field, i) => {
          const direction =
            sort[0] === field.name
              ? 'ascending'
              : sort[0] === `-${field.name}`
                ? 'descending'
                : 'none'
          return (
            <th
              key={field.name}
              aria-sort={direction}
              class={clsx(
                field.type.numeric && 'is-number',
                i === 0 && 'sticky',
                i === 0 && canDelete && 'sticky-2'
              )}
            >
              <button type="button" class="grid-sort" onClick={() => onSort(field.name)}>
                <span title={field.named ? field.name : undefined}>{field.label}</span>
                {direction === 'ascending' ? (
                  <ArrowUpIcon size={14} aria-hidden="true" />
                ) : direction === 'descending' ? (
                  <ArrowDownIcon size={14} aria-hidden="true" />
                ) : null}
              </button>
            </th>
          )
        })}
        {hidden.map((c) => (
          <th
            key={c.name}
            class="grid-hidden"
            title={`The database gives you no SELECT on ${c.name}`}
          >
            <span>
              <LockIcon size={13} aria-hidden="true" /> {c.name}
            </span>
          </th>
        ))}
      </tr>
    </thead>
  )
}

/** One record of the list: its fields, and the way it is chosen. */
export function RecordRow({
  row,
  fields,
  hidden,
  labelOf,
  open,
  selected,
  canDelete,
  onSelect,
  onOpen,
}: {
  row: Record<string, unknown>
  fields: Field[]
  hidden: ColumnInfo[]
  labelOf: (field: Field, value: unknown) => string | undefined
  open: string | undefined
  selected: boolean
  canDelete: boolean
  onSelect: (id: string, checked: boolean) => void
  onOpen: (href: string) => void
}) {
  const id = row.id === undefined ? null : String(row.id)
  return (
    <tr
      class={clsx(open && 'is-link', id && selected && 'is-selected')}
      onClick={(e) => {
        if (!open || (e.target as HTMLElement).closest('input, a, button')) return
        onOpen(open)
      }}
    >
      {canDelete && (
        <td class="grid-check sticky">
          <input
            type="checkbox"
            aria-label="Select this record"
            checked={Boolean(id && selected)}
            onChange={(e) => onSelect(id!, e.currentTarget.checked)}
          />
        </td>
      )}
      {fields.map((field, i) => {
        const cell = (
          <Value
            value={row[field.name]}
            field={field}
            situation="list"
            label={labelOf(field, row[field.name])}
          />
        )
        return (
          <td
            key={field.name}
            class={clsx(
              field.type.numeric && 'is-number',
              i === 0 && 'sticky',
              i === 0 && canDelete && 'sticky-2'
            )}
          >
            {i === 0 && open ? (
              <a href={open} class="grid-open clip clip-wide">
                {cell}
              </a>
            ) : (
              cell
            )}
          </td>
        )
      })}
      {hidden.map((c) => (
        <td key={c.name} class="grid-hidden" aria-label="hidden" />
      ))}
    </tr>
  )
}
