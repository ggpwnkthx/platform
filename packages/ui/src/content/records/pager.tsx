import { count } from '../../format.ts'
import { Empty } from '../../ui/bits.tsx'
import { ChevronLeftIcon, ChevronRightIcon, SearchIcon } from '../../ui/icons.tsx'
import { Select } from '../../ui/form.tsx'

export const pageSizes = [25, 50, 100, 250]

/** What the list has to say when it holds nothing. */
export function NoRecords({ filtered, rls }: { filtered: boolean; rls: boolean }) {
  return (
    <Empty
      icon={<SearchIcon size={26} />}
      title={filtered ? 'No record matches' : 'No record reaches you'}
    >
      {filtered
        ? 'Change the search or remove a filter.'
        : rls
          ? 'The collection may hold rows that a row policy keeps from you. See the policies in the sidebar.'
          : 'The collection is empty.'}
    </Empty>
  )
}

/** The pages of the list, and how many records each holds. */
export function RecordsPager({
  total,
  pageNumber,
  limit,
  pages,
  onPage,
  onLimit,
}: {
  total: number
  pageNumber: number
  limit: number
  pages: number
  onPage: (page: number) => void
  onLimit: (limit: string) => void
}) {
  return (
    <footer class="pager">
      <span>
        {total
          ? `${count((pageNumber - 1) * limit + 1)}–${count(Math.min(total, pageNumber * limit))} of ${count(total)}`
          : '0 records'}
      </span>
      <span class="pager-size">
        <Select
          value={String(limit)}
          onChange={(e) => onLimit(e.currentTarget.value)}
          aria-label="Records per page"
        >
          {pageSizes.map((n) => (
            <option key={n} value={n}>
              {n} per page
            </option>
          ))}
        </Select>
      </span>
      <span class="pager-nav">
        <button
          type="button"
          class="icon-button"
          aria-label="Previous page"
          disabled={pageNumber <= 1}
          onClick={() => onPage(pageNumber - 1)}
        >
          <ChevronLeftIcon size={18} />
        </button>
        <span>
          Page {pageNumber} of {pages}
        </span>
        <button
          type="button"
          class="icon-button"
          aria-label="Next page"
          disabled={pageNumber >= pages}
          onClick={() => onPage(pageNumber + 1)}
        >
          <ChevronRightIcon size={18} />
        </button>
      </span>
    </footer>
  )
}
