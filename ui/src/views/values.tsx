import clsx from 'clsx'
import type { ColumnInfo } from '../db/types.ts'
import { display, moment } from '../format.ts'
import { kindOf } from '../state/catalog.ts'
import { CheckIcon, CloseIcon } from '../ui/icons.tsx'

/** One value in a table cell, drawn by its type. */
export function Cell({
  value,
  column,
  label,
  choices,
}: {
  value: unknown
  column: ColumnInfo
  label?: string
  /** The values a CHECK allows, when the column is chosen from a list. */
  choices?: string[] | null
}) {
  if (value === null || value === undefined) return <span class="null">null</span>
  const kind = kindOf(column.type)
  if (choices && typeof value === 'string')
    return <span class={clsx('choice', `choice-${choiceTone(value)}`)}>{value}</span>
  if (label !== undefined)
    return (
      <span class="cell-relation" title={String(value)}>
        <span class="clip">{label || <span class="mono">{String(value).slice(0, 8)}…</span>}</span>
      </span>
    )
  if (kind === 'boolean')
    return value ? (
      <span class="cell-bool is-true">
        <CheckIcon size={15} aria-hidden="true" />
        <span class="sr-only">true</span>
      </span>
    ) : (
      <span class="cell-bool">
        <CloseIcon size={15} aria-hidden="true" />
        <span class="sr-only">false</span>
      </span>
    )
  if (kind === 'moment') return <span class="mono">{moment(value)}</span>
  if (kind === 'uuid')
    return (
      <span class="mono" title={String(value)}>
        {String(value).slice(0, 8)}
      </span>
    )
  if (kind === 'json') return <span class="mono cell-json clip">{display(value)}</span>
  if (kind === 'integer' || kind === 'number')
    return <span class={clsx('mono', 'cell-number')}>{display(value)}</span>
  if (['date', 'time'].includes(kind)) return <span class="mono">{display(value)}</span>
  return (
    <span class="clip" title={display(value)}>
      {display(value)}
    </span>
  )
}

/** A colour for a listed value, by what the word means rather than where it falls in the list. */
export function choiceTone(value: string): number {
  if (/^(published|won|active|customer|done|approved|paid|open)$/i.test(value)) return 3
  if (/^(lost|inactive|former|retraction|rejected|cancelled|closed|blocked)/i.test(value)) return 4
  if (/^(draft|qualify|prospect|new|pending|minor)$/i.test(value)) return 0
  if (/^(review|propose|negotiate|material|partner|in_progress)$/i.test(value)) return 1
  return 2
}
