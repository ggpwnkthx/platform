import type { ColumnInfo } from '@platform/data'
import { readFilter } from './filter.tsx'
import { pageSizes } from './pager.tsx'

/**
 * The list the address asks for: how many records a page holds, which page it is, the
 * order they are in, and the filter that narrows them.
 */
export function recordsQuery(query: Record<string, string>, readable: ColumnInfo[]) {
  const filter = readFilter(query.f)
  const search = query.q ?? ''
  const limit = pageSizes.includes(Number(query.n)) ? Number(query.n) : 25
  const pageNumber = Math.max(1, Number(query.p) || 1)
  const hasUpdated = readable.some((c) => c.name === 'updated_at')
  const sort = query.s
    ? query.s.split(',')
    : hasUpdated
      ? ['-updated_at']
      : readable.some((c) => c.name === 'id')
        ? ['id']
        : []
  return { filter, search, limit, pageNumber, sort }
}
