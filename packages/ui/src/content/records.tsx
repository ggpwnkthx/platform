import { ActionIcon, Button } from '@mantine/core'
import { useDebouncedCallback } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { deleteRecord, transaction } from '@platform/core'
import { Cog, Plus, Trash2 } from 'lucide-react'
import { DataTable } from 'mantine-datatable'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { NoCollection } from '../bits/empty.tsx'
import { ItemMark } from '../bits/marks.tsx'
import { Page, Problem } from '../bits/page.tsx'
import { Value } from '../fields/renderers.tsx'
import { useFields } from '../fields/resolve.ts'
import { useSession } from '../session/context.ts'
import { usePlace } from '../session/hooks.ts'
import { useNames } from '../shell/names.ts'
import { CollectionAside } from './aside.tsx'
import { DeleteRecords } from './delete.tsx'
import { Toolbar } from './toolbar.tsx'
import { pageSizes, type Row, useRecords } from './query.ts'

/** The records of a collection: search, filters, sort, pages and a count — all kept in the address. */
export function Records() {
  const { catalog, db, refresh } = useSession()
  const place = usePlace()
  const names = useNames()
  const navigate = useNavigate()
  const { info, fields, loading } = useFields(place.ws, place.c)
  const [selected, setSelected] = useState<Row[]>([])
  const [confirming, setConfirming] = useState(false)
  const [refusal, setRefusal] = useState<unknown>(null)
  const search = useDebouncedCallback((q: string) => place.set({ q, page: null }), 300)
  const { found, readable, shown, hasId, filter, q, sort, page, size } = useRecords({
    catalog,
    ws: place.ws,
    table: place.c,
    fields,
    enabled: !!info && !loading,
    params: place.params,
  })

  if (!info)
    return (
      <Page title="Records">
        <NoCollection name={place.c} />
      </Page>
    )
  const said = names(place.ws, place.c)
  const remove = async () => {
    try {
      await db.exclusive((one) =>
        transaction(one, async () => {
          for (const row of selected) await deleteRecord(one, place.ws, place.c, String(row.id))
        })
      )
      notifications.show({
        color: 'green',
        message: `Deleted ${selected.length} record${selected.length === 1 ? '' : 's'}.`,
      })
      setSelected([])
      setConfirming(false)
      await refresh()
    } catch (error) {
      setRefusal(error)
    }
  }
  return (
    <Page
      title={said.name}
      crumbs={[
        <Link key="c" to={place.to('/data')}>
          {names(place.ws).name}
        </Link>,
        'Records',
      ]}
      mark={<ItemMark {...said} size={44} table />}
      aside={<CollectionAside schema={place.ws} table={place.c} fields={fields} />}
      actions={
        <>
          {selected.length > 0 && (
            <Button
              color="red"
              variant="light"
              leftSection={<Trash2 size={16} />}
              onClick={() => setConfirming(true)}
            >
              Delete {selected.length}
            </Button>
          )}
          {fields.some((f) => f.column.can_insert) && info.kind !== 'v' && hasId && (
            <ActionIcon
              size={44}
              radius="xl"
              component={Link}
              to={place.to('/data/item', { c: place.c })}
              aria-label="New record"
              title="New record"
            >
              <Plus />
            </ActionIcon>
          )}
          <ActionIcon
            size={44}
            radius="xl"
            component={Link}
            to={place.to('/data/model/collection', { c: place.c })}
            aria-label="The data model of this collection"
            title="The data model of this collection"
          >
            <Cog />
          </ActionIcon>
        </>
      }
    >
      <Toolbar
        fields={readable.filter((f) => f.views.filter !== 'hide')}
        filter={filter}
        value={q}
        onSearch={search}
        onAdd={(name, one) => place.set({ [`f.${name}`]: `${one.op}.${one.value}`, page: null })}
        onRemove={(name) => place.set({ [`f.${name}`]: null, page: null })}
      />
      <Problem error={found.error} />
      <DataTable<Row>
        withTableBorder
        borderRadius="md"
        minHeight={180}
        highlightOnHover
        pinFirstColumn={shown.length > 3}
        fetching={found.isFetching}
        records={found.data?.rows ?? []}
        idAccessor={(row) => String(row.id ?? JSON.stringify(row))}
        noRecordsText={
          info.rls && !info.can_alter ? 'No row that a policy lets you see.' : 'No records.'
        }
        columns={shown.map((field) => ({
          accessor: field.name,
          title: field.label,
          sortable: true,
          textAlign: field.type.numeric ? 'right' : 'left',
          // A value longer than its column ends in an ellipsis; the whole value is in its hint.
          render: (row: Row) => (
            <div className="cell">
              <Value
                field={field}
                value={row[field.name]}
                situation="list"
                label={found.data?.labels[field.name]?.[String(row[field.name])]}
              />
            </div>
          ),
        }))}
        sortStatus={{
          columnAccessor: sort.replace(/^-/, ''),
          direction: sort.startsWith('-') ? 'desc' : 'asc',
        }}
        onSortStatusChange={(status) =>
          place.set({
            sort: `${status.direction === 'desc' ? '-' : ''}${status.columnAccessor}`,
            page: null,
          })
        }
        totalRecords={found.data?.total ?? 0}
        recordsPerPage={size}
        recordsPerPageOptions={pageSizes}
        onRecordsPerPageChange={(next) => place.set({ size: String(next), page: null })}
        page={page}
        onPageChange={(next) => place.set({ page: String(next) }, false)}
        paginationText={({ from, to, totalRecords }) => `${from}–${to} of ${totalRecords}`}
        {...(hasId
          ? {
              onRowClick: ({ record: row }: { record: Row }) =>
                navigate(place.to('/data/item', { c: place.c, id: String(row.id) })),
            }
          : {})}
        {...(hasId && info.can_delete
          ? { selectedRecords: selected, onSelectedRecordsChange: setSelected }
          : {})}
      />
      <DeleteRecords
        count={selected.length}
        opened={confirming}
        refusal={refusal}
        onCancel={() => setConfirming(false)}
        onConfirm={remove}
      />
    </Page>
  )
}
