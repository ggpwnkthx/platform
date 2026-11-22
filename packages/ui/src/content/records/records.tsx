import { useState } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import { type Condition, columnsOf, presentationOf, tableOf } from '@platform/data'
import type { Field } from '../../fields/field.ts'
import { plural } from '../../format.ts'
import { describe, useSession } from '../../session.tsx'
import { Page } from '../../shell/page.tsx'
import { useWorkspaceView } from '../../workspace/view.ts'
import { href } from '../../url.ts'
import { Notice } from '../../ui/bits.tsx'
import { CollectionIcon, iconFor } from '../../ui/icons.tsx'
import { CollectionSidebar } from '../sidebar.tsx'
import { RecordsActions } from './actions.tsx'
import { useRecordsDelete } from './delete.ts'
import { useRecordsFields } from './fields.ts'
import { DeleteRecords } from './delete-confirm.tsx'
import { useRecordsLoad } from './load.ts'
import { FilterBuilder } from './filter.tsx'
import { useChosen, useSearchBox } from './hooks.ts'
import { RecordsList } from './list.tsx'
import { NoCollection, NoReadableFields, NoTable } from './missing.tsx'
import { recordsQuery } from './query.ts'
import { RecordsToolbar } from './toolbar.tsx'

/** The list of the records of one collection, read from the database. */
export function Records() {
  const { catalog, presentations } = useSession()
  const location = useLocation()
  const { query } = location
  const { ws, shown: workspace } = useWorkspaceView()
  const table = query.c ?? ''
  const info = tableOf(catalog, ws, table)
  const mark = presentationOf(presentations, ws, table)
  const CollectionGlyph = iconFor(mark.icon) ?? CollectionIcon
  const columns = columnsOf(catalog, ws, table)
  const readable = columns.filter((c) => c.can_select)
  const [showSystem, setShowSystem] = useState(false)
  const hidden = columns.filter((c) => !c.can_select)
  const { filter, search, limit, pageNumber, sort } = recordsQuery(query, readable)
  const [confirming, setConfirming] = useState(false)

  const place = (changes: Record<string, string | undefined>) => {
    const next = { ...query, ...changes }
    location.route(href('/content/records', next), true)
  }

  const searchBox = useSearchBox(search, (text) => place({ q: text || undefined, p: undefined }))

  const loaded = useRecordsLoad({
    catalog,
    ws,
    table,
    readable,
    filter,
    search,
    sort,
    limit,
    pageNumber,
  })

  const { readableFields, shown, filterable } = useRecordsFields({
    catalog,
    ws,
    table,
    described: loaded.data?.described,
    showSystem,
  })
  /** The name of the row a relation points at, when the reader may read it. */
  const labelOf = (field: Field, value: unknown) => loaded.data?.labels[field.name]?.[String(value)]
  const rows = loaded.data?.rows ?? []
  const total = loaded.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / limit))
  const canDelete = Boolean(info?.can_delete && readable.some((c) => c.name === 'id'))
  const chosen = useChosen(rows, ws, table)
  const { selected, allSelected } = chosen

  const toggleSort = (name: string) => {
    const current = sort[0]
    const next = current === name ? `-${name}` : current === `-${name}` ? undefined : name
    place({ s: next, p: undefined })
  }

  const { deleting, removeSelected } = useRecordsDelete({
    ws,
    table,
    selected,
    onDeleted: () => {
      chosen.setSelected(new Set())
      setConfirming(false)
      loaded.reload()
    },
  })

  if (!table) return <NoCollection ws={ws} />
  if (!info) return <NoTable ws={ws} table={table} />

  return (
    <Page
      title={mark.displayName ?? table}
      icon={<CollectionGlyph size={22} />}
      presentation={mark}
      crumbs={[
        { label: 'Content', href: href('/content', { ws }) },
        { label: workspace.displayName ?? ws, href: href('/content', { ws }) },
      ]}
      subtitle={
        loaded.data
          ? `${plural(total, 'record')}${Object.keys(filter).length || search ? ' match' : ' reach you'}`
          : undefined
      }
      actions={
        <RecordsActions
          info={info}
          columns={columns}
          table={table}
          ws={ws}
          chosen={selected.size}
          canDelete={canDelete}
          onDelete={() => setConfirming(true)}
        />
      }
      toolbar={
        <RecordsToolbar
          draft={searchBox.draft}
          setDraft={searchBox.setDraft}
          searchRef={searchBox.ref}
          readable={readable.length}
          filter={filter}
          readableFields={readableFields}
          showSystem={showSystem}
          setShowSystem={setShowSystem}
          filterBuilder={
            filterable.length > 0 ? (
              <FilterBuilder
                fields={filterable}
                onAdd={(column: string, condition: Condition) =>
                  place({ f: JSON.stringify({ ...filter, [column]: condition }), p: undefined })
                }
              />
            ) : null
          }
          onRemoveFilter={(column) => {
            const next = { ...filter }
            delete next[column]
            place({
              f: Object.keys(next).length ? JSON.stringify(next) : undefined,
              p: undefined,
            })
          }}
          onReadAgain={loaded.reload}
        />
      }
      sidebar={<CollectionSidebar schema={ws} table={table} />}
    >
      {!readable.length ? (
        <NoReadableFields mayInsert={info.can_insert || columns.some((c) => c.can_insert)} />
      ) : loaded.error ? (
        <Notice tone="danger" title={describe(loaded.error).title}>
          {describe(loaded.error).detail}
        </Notice>
      ) : (
        <RecordsList
          rows={rows}
          fields={shown}
          hidden={hidden}
          sort={sort}
          canDelete={canDelete}
          allSelected={allSelected}
          labelOf={labelOf}
          selected={selected}
          onSort={toggleSort}
          onSelectAll={chosen.selectAll}
          onSelect={chosen.toggle}
          onOpen={(to) => location.route(to)}
          loading={loaded.loading}
          hasData={Boolean(loaded.data)}
          filtered={Boolean(Object.keys(filter).length || search)}
          rls={info.rls}
          ws={ws}
          table={table}
          total={total}
          pageNumber={pageNumber}
          limit={limit}
          pages={pages}
          onPage={(page) => place({ p: String(page) })}
          onLimit={(n) => place({ n, p: undefined })}
        />
      )}
      <DeleteRecords
        confirming={confirming}
        deleting={deleting}
        count={selected.size}
        ws={ws}
        table={table}
        onConfirm={removeSelected}
        onClose={() => setConfirming(false)}
      />
    </Page>
  )
}
