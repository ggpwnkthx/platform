import {
  metadataCollection,
  metadataFilter,
  metadataStart,
  tableOf,
  type Catalog,
} from '@platform/data'
import type { MetadataTarget } from '@platform/vocabulary'
import { useLocation } from 'preact-iso'
import { href } from '../url.ts'

/**
 * The metadata collection, and the little that is known about every item's share of it.
 */

export const { schema: metaSchema, table: metaTable } = metadataCollection

/** May the reader change an item's metadata? The database gives that to the owner of the item. */
export function ownsItem(catalog: Catalog, target: MetadataTarget): boolean {
  if (target.scope === 'workspace')
    return Boolean(catalog.schemas.find((s) => s.name === target.schema)?.can_alter)
  return Boolean(tableOf(catalog, target.schema, target.table ?? '')?.can_alter)
}

/** The address this page is at, so the record form may come back to it. */
export function useHere(): string {
  const { url } = useLocation()
  return url
}

/** The record form of one row of the metadata collection, or of a new one about an item. */
export function rowHref(id: string, from: string, target?: MetadataTarget): string {
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
export const collectionHref = (target: MetadataTarget): string =>
  href('/content/records', {
    ws: metaSchema,
    c: metaTable,
    f: JSON.stringify(metadataFilter(target)),
  })

/** The columns the list of an item's keys is drawn with, where the reader may read them. */
export const listed = ['id', 'key', 'value', 'updated_by', 'updated_at', 'version']
