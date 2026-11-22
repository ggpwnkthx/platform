import { narrows, type Wanted } from '@platform/vocabulary'

/**
 * What a role is to hold, as the editor wishes it: the whole collection, some of its fields,
 * or nothing at all. A wish is the editor's own state — the database's holding is elsewhere.
 */

/** What a role is to hold once one privilege on one field is given or taken. */
export function toggleField(
  current: Wanted,
  privilege: string,
  column: string,
  on: boolean,
  every: string[]
): Wanted {
  if (!narrows(privilege)) return current
  if (on) {
    if (current === 'all') return current
    const columns = current === 'none' ? [] : current
    return columns.includes(column) ? columns : [...columns, column]
  }
  // Taking one field from the whole collection leaves the others, by name.
  const columns = current === 'all' ? every : current === 'none' ? [] : current
  const left = columns.filter((name) => name !== column)
  return left.length ? left : 'none'
}

/** Are two wishes the same? */
export const sameWanted = (a: Wanted, b: Wanted): boolean =>
  typeof a === 'string' || typeof b === 'string'
    ? a === b
    : a.length === b.length && a.every((column) => b.includes(column))
