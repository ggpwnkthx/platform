import type { ViewMode } from '@platform/core'

/** Two sayings are the same when they are the same text: what an owner has said, and what is asked. */
export const changed = (held: unknown, wanted: unknown) =>
  JSON.stringify(held ?? null) !== JSON.stringify(wanted ?? null)

export const modeWords: Record<ViewMode, string> = {
  show: 'Shown',
  hide: 'Hidden',
  readonly: 'Shown and locked',
}
export const situationWords = {
  list: 'In the records grid',
  record: 'In the record form',
  filter: 'In the filter builder',
}
