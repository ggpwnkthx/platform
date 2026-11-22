import type { ActivityInfo } from '@platform/data'
import { display } from '../format.ts'
import type { BadgeTone } from '../ui/bits.tsx'

export const operations: Record<string, { label: string; tone: BadgeTone }> = {
  INSERT: { label: 'Created', tone: 'success' },
  UPDATE: { label: 'Updated', tone: 'info' },
  DELETE: { label: 'Deleted', tone: 'danger' },
  TRUNCATE: { label: 'Truncated', tone: 'danger' },
}

/** What a revision's row is called: its title or name, else the start of its id. */
export function recordLabel(entry: ActivityInfo): string {
  const row = entry.after_row ?? entry.before_row ?? {}
  for (const key of ['title', 'name', 'full_name', 'label', 'wording']) {
    const value = row[key]
    if (typeof value === 'string' && value)
      return value.length > 48 ? `${value.slice(0, 47)}…` : value
  }
  return rowId(entry).slice(0, 8)
}

const rowId = (entry: ActivityInfo) => display(entry.after_row?.id ?? entry.before_row?.id ?? '')

/** The fields a revision changed: every field, for a creation or a deletion. */
export function changes(entry: ActivityInfo): { field: string; before: unknown; after: unknown }[] {
  const before = entry.before_row ?? {}
  const after = entry.after_row ?? {}
  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])]
  return fields
    .filter(
      (f) => entry.operation !== 'UPDATE' || JSON.stringify(before[f]) !== JSON.stringify(after[f])
    )
    .filter((f) => entry.operation !== 'UPDATE' || !['updated_at', 'version'].includes(f))
    .map((field) => ({ field, before: before[field], after: after[field] }))
}
