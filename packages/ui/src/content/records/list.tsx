import clsx from 'clsx'
import type { ColumnInfo } from '@platform/data'
import type { Field } from '../../fields/field.ts'
import { href } from '../../url.ts'
import { Loading } from '../../ui/bits.tsx'
import { NoRecords, RecordsPager } from './pager.tsx'
import { RecordRow, RecordsHead } from './table.tsx'

/** The list itself: the rows the database holds, and the pages they are on. */
export function RecordsList({
  rows,
  fields,
  hidden,
  sort,
  canDelete,
  allSelected,
  labelOf,
  selected,
  onSort,
  onSelectAll,
  onSelect,
  onOpen,
  loading,
  hasData,
  filtered,
  rls,
  ws,
  table,
  total,
  pageNumber,
  limit,
  pages,
  onPage,
  onLimit,
}: {
  rows: Record<string, unknown>[]
  fields: Field[]
  hidden: ColumnInfo[]
  sort: string[]
  canDelete: boolean
  allSelected: boolean
  labelOf: (field: Field, value: unknown) => string | undefined
  /** The records the reader has chosen, by id. */
  selected: Set<string>
  onSort: (name: string) => void
  onSelectAll: (checked: boolean) => void
  onSelect: (id: string, checked: boolean) => void
  onOpen: (href: string) => void
  loading: boolean
  hasData: boolean
  filtered: boolean
  rls: boolean
  ws: string
  table: string
  total: number
  pageNumber: number
  limit: number
  pages: number
  onPage: (page: number) => void
  onLimit: (limit: string) => void
}) {
  return (
    <>
      <div class={clsx('grid-wrap', loading && 'is-loading')}>
        <table class="grid">
          <RecordsHead
            fields={fields}
            hidden={hidden}
            sort={sort}
            canDelete={canDelete}
            allSelected={allSelected}
            onSort={onSort}
            onSelectAll={onSelectAll}
          />
          <tbody>
            {rows.map((row, index) => {
              const id = row.id === undefined ? null : String(row.id)
              const open = id ? href('/content/item', { ws, c: table, id }) : undefined
              return (
                <RecordRow
                  key={id ?? index}
                  row={row}
                  fields={fields}
                  hidden={hidden}
                  labelOf={labelOf}
                  open={open}
                  selected={Boolean(id && selected.has(id))}
                  canDelete={canDelete}
                  onSelect={onSelect}
                  onOpen={onOpen}
                />
              )
            })}
          </tbody>
        </table>
        {!loading && hasData && !rows.length && <NoRecords filtered={filtered} rls={rls} />}
        {!hasData && loading && <Loading />}
      </div>
      <RecordsPager
        total={total}
        pageNumber={pageNumber}
        limit={limit}
        pages={pages}
        onPage={onPage}
        onLimit={onLimit}
      />
    </>
  )
}
