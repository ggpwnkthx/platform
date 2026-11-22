import type { Field as FieldInfo } from '../../fields/field.ts'
import { href } from '../../url.ts'
import { display } from '../../format.ts'
import { inRecord } from '@platform/vocabulary'

/** The start of the names the address gives a new record's fields by: `v.title=…`. */
const startPrefix = 'v.'

/**
 * What a new record starts with, as the address says it: a page that sends the reader here
 * to make a row about something names that something, so the form opens with it filled in.
 * It is a start and no more — every value is still the reader's to change, and the database's
 * to refuse.
 */
export function startOf(query: Record<string, string>): Record<string, string> {
  const start: Record<string, string> = {}
  for (const [name, value] of Object.entries(query))
    if (name.startsWith(startPrefix) && name.length > startPrefix.length)
      start[name.slice(startPrefix.length)] = value
  return start
}

/** Where the reader came from, when it is a page of this interface and nowhere else. */
export function cameFrom(from: string | undefined): string | null {
  return from && /^\/(?!\/)/.test(from) && !from.includes('\\') ? from : null
}

/** What the page calls the record: the label column's value, or the first of its name. */
export function recordTitle(
  label: string | null,
  original: Record<string, unknown> | null,
  id: string
): string {
  return (label && original ? display(original[label]) : '') || `Record ${id.slice(0, 8)}`
}

/** How many values the save binds: the ones of the record, and the version it expects. */
export function boundCount(
  values: Record<string, unknown>,
  creating: boolean,
  version: number | undefined
): number {
  if (creating) return Object.keys(values).length
  return Object.keys(values).length + (version !== undefined ? 2 : 1)
}

/**
 * The fields of the collection, as the reader may reach them: the ones the form offers, the
 * ones the database withholds, and the ones the owner keeps out of the record.
 */
export function fieldsOf(all: FieldInfo[], creating: boolean) {
  /** May the reader reach the field at all, in the form they are in? */
  const reachable = (field: FieldInfo) =>
    creating ? field.column.can_insert : field.column.can_select || field.column.can_update
  const own = all.filter((field) => !field.system)
  return {
    fields: own.filter((field) => reachable(field) && inRecord(field.views)),
    unreachable: own.filter((field) => !reachable(field)),
    withheld: own.filter((field) => reachable(field) && !inRecord(field.views)),
  }
}

/** The trail of the page: the workspace, and the collection the record is in. */
export function crumbsOf(
  workspace: { displayName?: string | null },
  collection: { displayName?: string | null },
  ws: string,
  table: string
): { label: string; href: string }[] {
  return [
    { label: workspace.displayName ?? ws, href: href('/content', { ws }) },
    {
      label: collection.displayName ?? table,
      href: href('/content/records', { ws, c: table }),
    },
  ]
}
