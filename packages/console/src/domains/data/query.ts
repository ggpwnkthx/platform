/**
 * The query of a list, between the url of a page of the console and the
 * parameters of Data.
 *
 * The url of a page of a collection is the whole state of the page: the
 * search, the filter, the sort and the page. A reader who sends the url
 * to somebody sends the page.
 */

import type { ListQuery } from './client'

/** The query of a list, as the console reads it from a url. */
export interface PageQuery {
  readonly search: string
  /** The filter, as the caller wrote it. */
  readonly filterText: string
  readonly sort: string
  readonly limit: number
  readonly cursor: string
  readonly count: boolean
  /** The query of Data, when the url is understood. */
  readonly list: ListQuery
  /** What the console did not understand. */
  readonly problem: string | null
}

/** The sizes of a page the console offers. */
export const PAGE_SIZES = [10, 25, 50, 100, 200] as const

/** Reads the query of a list from the parameters of a url. */
export function readPageQuery(params: URLSearchParams): PageQuery {
  const search = (params.get('q') ?? '').trim().slice(0, 256)
  const filterText = (params.get('filter') ?? '').trim()
  const sort = (params.get('sort') ?? '').trim()
  const cursor = params.get('cursor') ?? ''
  const count = params.get('count') === '1' || params.get('count') === 'true'
  const requested = Number(params.get('limit') ?? 25)
  const limit = Number.isInteger(requested) && requested >= 1 && requested <= 200 ? requested : 25

  let problem: string | null = null
  let filter: unknown
  if (filterText) {
    try {
      filter = JSON.parse(filterText)
      if (typeof filter !== 'object' || filter === null || Array.isArray(filter)) {
        problem = 'the filter is not a json object'
        filter = undefined
      }
    } catch {
      problem = 'the filter is not json'
      filter = undefined
    }
  }

  const sortFields = sort
    .split(',')
    .map((field) => field.trim())
    .filter((field) => field.length > 0)
    .slice(0, 3)

  const list: ListQuery = {
    limit,
    ...(search ? { search } : {}),
    ...(filter !== undefined ? { filter } : {}),
    ...(sortFields.length > 0 ? { sort: sortFields } : {}),
    ...(cursor ? { cursor } : {}),
    ...(count ? { includeCount: true } : {}),
  }
  return { search, filterText, sort, limit, cursor, count, list, problem }
}

/** The url of a page of the same list, with some parameters changed. */
export function pageUrl(
  path: string,
  query: PageQuery,
  changes: Partial<Record<'q' | 'filter' | 'sort' | 'limit' | 'cursor' | 'count', string>>
): string {
  const params = new URLSearchParams()
  const current: Record<string, string> = {
    q: query.search,
    filter: query.filterText,
    sort: query.sort,
    limit: query.limit === 25 ? '' : String(query.limit),
    cursor: '',
    count: query.count ? '1' : '',
  }
  for (const [key, value] of Object.entries({ ...current, ...changes })) {
    if (value) params.set(key, value)
  }
  const suffix = params.toString()
  return suffix ? `${path}?${suffix}` : path
}

/** The sort of a column: ascending, descending, or none. */
export function sortOf(query: PageQuery, field: string): 'asc' | 'desc' | null {
  const first = query.sort.split(',')[0]?.trim()
  if (first === field) return 'asc'
  if (first === `-${field}`) return 'desc'
  return null
}

/** The sort a column offers next: ascending, then descending, then none. */
export function nextSortOf(query: PageQuery, field: string): string {
  const current = sortOf(query, field)
  if (current === null) return field
  if (current === 'asc') return `-${field}`
  return ''
}
