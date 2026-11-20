import clsx from 'clsx'
import type { ComponentChildren } from 'preact'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import {
  type Condition,
  type Filter,
  type Operator,
  columnsOf,
  deleteRecord,
  fieldMetadata,
  records,
  relationLabels,
  tableOf,
  tablePolicies,
  valueless,
} from '@platform/data'
import { qualified, inFilter, inList } from '@platform/vocabulary'
import { operatorLabels } from './labels.ts'
import { count, plural } from '../format.ts'
import { describe, useLoad, useSession } from '../session.tsx'
import { Page, SideGroup, useWorkspace } from '../shell.tsx'
import { filterStart, filterValue } from '../fields/edit.ts'
import { FilterLine } from '../fields/inputs.tsx'
import { Value } from '../fields/renderers.tsx'
import { resolveFields } from '../fields/resolve.ts'
import type { Field } from '../fields/types.ts'
import { presentationOf } from '@platform/data'
import { href } from '../url.ts'
import { Badge, Empty, Loading, Notice } from '../ui/bits.tsx'
import { Action, Button } from '../ui/button.tsx'
import { Checkbox, Select } from '../ui/form.tsx'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  CollectionIcon,
  FilterIcon,
  HiddenIcon,
  iconFor,
  InfoIcon,
  LockIcon,
  PlusIcon,
  PolicyIcon,
  RefreshIcon,
  SearchIcon,
  SettingsIcon,
  TrashIcon,
} from '../ui/icons.tsx'
import { Confirm, Menu } from '../ui/overlay.tsx'
import { Legend, Rights } from '../access/rights.tsx'

function readFilter(text: string | undefined): Filter {
  if (!text) return {}
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? (parsed as Filter) : {}
  } catch {
    return {}
  }
}

function conditionText(
  condition: Condition,
  draw?: (value: unknown) => ComponentChildren
): ComponentChildren {
  const label = operatorLabels[condition.op]
  if (valueless.includes(condition.op)) return label
  const raw = Array.isArray(condition.value) ? condition.value.join(', ') : condition.value
  if (!draw) return `${label} ${String(raw)}`
  return (
    <>
      {label} {draw(raw)}
    </>
  )
}

export function CollectionSidebar({
  schema,
  table,
  extra,
}: {
  schema: string
  table: string
  extra?: preact.ComponentChildren
}) {
  const { catalog } = useSession()
  const info = tableOf(catalog, schema, table)
  const columns = columnsOf(catalog, schema, table)
  const policies = useLoad((db) => tablePolicies(db, schema, table), [schema, table])
  if (!info) return null
  const hidden = columns.filter((c) => !c.can_select)
  const writable = columns.filter((c) => c.can_update)
  return (
    <>
      {extra}
      <SideGroup title="Information" icon={<InfoIcon size={16} />}>
        <dl class="facts">
          <dt>Collection</dt>
          <dd class="mono">{`${schema}.${table}`}</dd>
          <dt>Owner</dt>
          <dd class="mono">{info.owner}</dd>
          <dt>Kind</dt>
          <dd>{info.kind === 'v' ? 'View' : info.kind === 'p' ? 'Partitioned table' : 'Table'}</dd>
          <dt>Row security</dt>
          <dd>
            {info.rls ? (
              <Badge tone="info">{info.force_rls ? 'On, forced' : 'On'}</Badge>
            ) : (
              <Badge>Off</Badge>
            )}
          </dd>
        </dl>
        {info.comment && <p class="side-note">{info.comment}</p>}
      </SideGroup>
      <SideGroup title="Your rights" icon={<LockIcon size={16} />}>
        <Rights table={info} columns={columns} />
        <Legend />
        <p class="side-note">
          You read {columns.length - hidden.length} of {columns.length} fields and may change{' '}
          {writable.length}. PostgreSQL decides each one.
        </p>
        {hidden.length > 0 && (
          <ul class="side-list">
            {hidden.map((c) => (
              <li key={c.name}>
                <HiddenIcon size={14} aria-hidden="true" />
                <span class="mono">{c.name}</span>
                <span class="side-muted">no SELECT</span>
              </li>
            ))}
          </ul>
        )}
        <a
          class="side-link"
          href={href('/model/collection', { ws: schema, c: table, tab: 'access' })}
        >
          {info.can_alter
            ? 'Manage who reaches this collection'
            : 'Who else reaches this collection'}
        </a>
      </SideGroup>
      <SideGroup title="Row policies" icon={<PolicyIcon size={16} />} count={policies.data?.length}>
        {!info.rls ? (
          <p class="side-note">Row security is off: grants alone decide which rows you reach.</p>
        ) : policies.data && !policies.data.length ? (
          <p class="side-note">
            Row security is on and there is no policy: nobody but the owner reaches a row.
          </p>
        ) : null}
        {policies.data?.map((p) => (
          <div key={p.name} class={clsx('policy', p.applies && 'is-yours')}>
            <div class="policy-head">
              <strong class="mono">{p.name}</strong>
              <Badge tone={p.applies ? 'primary' : 'neutral'}>
                {p.applies ? 'applies to you' : 'others'}
              </Badge>
            </div>
            <p class="policy-meta">
              {p.command} · {p.permissive.toLowerCase()} · {p.roles.join(', ')}
            </p>
            {p.using && <code class="policy-expr">USING {p.using}</code>}
            {p.check && <code class="policy-expr">WITH CHECK {p.check}</code>}
          </div>
        ))}
        {policies.error ? <p class="side-note">{describe(policies.error).title}</p> : null}
      </SideGroup>
    </>
  )
}

/** The form that adds one condition: a field, an operator its type offers, and a value. */
function FilterBuilder({
  fields,
  onAdd,
}: {
  /** The fields that may be filtered on: those the reader reads and the owner offers. */
  fields: Field[]
  onAdd: (column: string, condition: Condition) => void
}) {
  const [open, setOpen] = useState(false)
  const [column, setColumn] = useState(fields[0]?.name ?? '')
  const field = fields.find((one) => one.name === column) ?? fields[0]
  const ops = field?.type.filter.operators ?? []
  const [op, setOp] = useState<Operator>(ops[0] ?? 'eq')
  const [value, setValue] = useState(field ? filterStart(field) : '')
  // Another field is another type: its own operators, and its own first value.
  useEffect(() => {
    if (!ops.includes(op)) setOp(ops[0] ?? 'eq')
    setValue(field ? filterStart(field) : '')
  }, [column])
  const apply = (event: Event) => {
    event.preventDefault()
    if (!field) return
    onAdd(field.name, { op, value: filterValue(field, op, value) })
    setOpen(false)
    setValue(filterStart(field))
  }
  const ValueInput = field?.type.filter.Input ?? FilterLine
  return (
    <div class="menu-anchor">
      <Button icon={<FilterIcon size={16} />} aria-expanded={open} onClick={() => setOpen(!open)}>
        Filter
      </Button>
      <Menu open={open} onClose={() => setOpen(false)} align="start">
        <form class="filter-form" onSubmit={apply}>
          <p class="menu-label">Show rows where</p>
          <Select
            value={column}
            onChange={(e) => setColumn(e.currentTarget.value)}
            aria-label="Field"
          >
            {fields.map((one) => (
              <option key={one.name} value={one.name}>
                {one.name}
              </option>
            ))}
          </Select>
          <Select
            value={op}
            onChange={(e) => setOp(e.currentTarget.value as Operator)}
            aria-label="Operator"
          >
            {ops.map((o) => (
              <option key={o} value={o}>
                {operatorLabels[o]}
              </option>
            ))}
          </Select>
          {field && !valueless.includes(op) && (
            <ValueInput field={field} op={op} text={value} onChange={setValue} />
          )}
          <Button tone="primary" type="submit">
            Add filter
          </Button>
        </form>
      </Menu>
    </div>
  )
}

const pageSizes = [25, 50, 100, 250]

export function Records() {
  const { catalog, withDb, notify, presentations } = useSession()
  const location = useLocation()
  const { query } = location
  const ws = useWorkspace()
  const table = query.c ?? ''
  const info = tableOf(catalog, ws, table)
  const mark = presentationOf(presentations, ws, table)
  const workspace = presentationOf(presentations, ws)
  const CollectionGlyph = iconFor(mark.icon) ?? CollectionIcon
  const columns = columnsOf(catalog, ws, table)
  const readable = columns.filter((c) => c.can_select)
  const [showSystem, setShowSystem] = useState(false)
  const hidden = columns.filter((c) => !c.can_select)
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
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [draftSearch, setDraftSearch] = useState(search)
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => setDraftSearch(search), [search])
  useEffect(() => setSelected(new Set()), [ws, table])

  const place = (changes: Record<string, string | undefined>) => {
    const next = { ...query, ...changes }
    location.route(href('/content/records', next), true)
  }

  // '/' focuses the search, as in most data tools.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.key === '/' &&
        !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
      ) {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [])

  // Search as you type, after a short pause.
  useEffect(() => {
    if (draftSearch === search) return
    const timer = setTimeout(() => place({ q: draftSearch || undefined, p: undefined }), 300)
    return () => clearTimeout(timer)
  }, [draftSearch])

  const loaded = useLoad(
    info && readable.length
      ? async (db) => {
          const page = await records(db, {
            schema: ws,
            table,
            columns: readable.map((c) => c.name),
            searchable: readable.map((c) => c.name),
            filter,
            search,
            sort,
            limit,
            offset: (pageNumber - 1) * limit,
          })
          const labels = await relationLabels(
            db,
            catalog,
            ws,
            table,
            page.rows,
            readable.map((c) => c.name)
          )
          // The fields' own metadata: what each is called, where it appears and how it is
          // drawn, for the fields this reader reaches.
          const described = await fieldMetadata(db, ws, table)
          return { ...page, labels, described }
        }
      : null,
    [ws, table, query.f, search, query.s, limit, pageNumber, catalog]
  )

  // The fields of the collection, each read once: what PostgreSQL says of the column, what
  // the field says of itself, and the type that draws it. A field this reader may not reach
  // has no saying here: PostgreSQL did not return its metadata.
  const described = loaded.data?.described
  const fields = useMemo(
    () => resolveFields(catalog, ws, table, described),
    [catalog, ws, table, described]
  )
  const readableFields = fields.filter((field) => field.column.can_select)
  // The record's own fields first, then the platform's: who changed it and when.
  const listed = readableFields.filter((field) => inList(field.views))
  const shown = [
    ...listed.filter((field) => !field.system),
    ...listed.filter((field) => field.system && (showSystem || field.name === 'updated_at')),
  ]
  // The fields the filter builder offers: those whose saying lets it.
  const filterable = readableFields.filter((field) => inFilter(field.views))
  /** The name of the row a relation points at, when the reader may read it. */
  const labelOf = (field: Field, value: unknown) => loaded.data?.labels[field.name]?.[String(value)]
  const rows = loaded.data?.rows ?? []
  const total = loaded.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / limit))
  const canDelete = Boolean(info?.can_delete && readable.some((c) => c.name === 'id'))
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(String(r.id)))

  const toggleSort = (name: string) => {
    const current = sort[0]
    const next = current === name ? `-${name}` : current === `-${name}` ? undefined : name
    place({ s: next, p: undefined })
  }

  const removeSelected = async () => {
    setDeleting(true)
    try {
      const ids = [...selected]
      const removed = await withDb(async (db) => {
        let n = 0
        for (const id of ids) n += await deleteRecord(db, ws, table, id)
        return n
      })
      const refused = ids.length - removed
      if (refused > 0)
        notify({
          tone: 'error',
          title: `${plural(removed, 'record')} deleted, ${plural(refused, 'record')} not`,
          detail:
            'PostgreSQL deleted no row it would not let you reach: a row policy on this collection keeps the rest from you.',
        })
      else notify({ tone: 'success', title: `${plural(removed, 'record')} deleted` })
      setSelected(new Set())
      setConfirming(false)
      loaded.reload()
    } catch (error) {
      notify({ tone: 'error', ...describe(error) })
    } finally {
      setDeleting(false)
    }
  }

  if (!table)
    return (
      <Page
        title="Records"
        crumbs={[{ label: 'Content', href: href('/content', { ws }) }]}
        icon={<CollectionIcon size={22} />}
      >
        <Empty icon={<CollectionIcon size={28} />} title="Choose a collection">
          Pick one from the list to read its records.
        </Empty>
      </Page>
    )
  if (!info)
    return (
      <Page
        title={table}
        crumbs={[{ label: 'Content', href: href('/content', { ws }) }, { label: ws }]}
        icon={<CollectionIcon size={22} />}
      >
        <Notice tone="warning" title={`PostgreSQL shows you no collection named ${ws}.${table}`}>
          It does not exist, or your role holds no right on it. The catalog only lists what you may
          reach.
        </Notice>
      </Page>
    )

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
        <>
          {selected.size > 0 && canDelete && (
            <Action
              tone="danger"
              label={`Delete ${selected.size} selected`}
              icon={<TrashIcon size={20} />}
              onClick={() => setConfirming(true)}
            />
          )}
          {info.can_alter && (
            <Action
              tone="secondary"
              label="Collection settings"
              icon={<SettingsIcon size={20} />}
              href={href('/model/collection', { ws, c: table })}
            />
          )}
          {(info.can_insert || columns.some((c) => c.can_insert)) && (
            <Action
              label="New record"
              icon={<PlusIcon size={22} />}
              href={href('/content/item', { ws, c: table, id: '+' })}
            />
          )}
        </>
      }
      toolbar={
        <>
          <label class="search">
            <SearchIcon size={16} aria-hidden="true" />
            <span class="sr-only">Search</span>
            <input
              ref={searchRef}
              type="search"
              value={draftSearch}
              onInput={(e) => setDraftSearch(e.currentTarget.value)}
              placeholder={`Search ${plural(readable.length, 'readable field')}`}
            />
            <kbd>/</kbd>
          </label>
          {filterable.length > 0 && (
            <FilterBuilder
              fields={filterable}
              onAdd={(column, condition) =>
                place({ f: JSON.stringify({ ...filter, [column]: condition }), p: undefined })
              }
            />
          )}
          {Object.entries(filter).map(([column, condition]) => (
            <span key={column} class="chip">
              <span class="mono">{column}</span>{' '}
              {conditionText(condition, (value) => {
                const field = readableFields.find((one) => one.name === column)
                if (!field) return String(value)
                return <Value value={value} field={field} situation="filter" />
              })}
              <button
                type="button"
                aria-label={`Remove the filter on ${column}`}
                onClick={() => {
                  const next = { ...filter }
                  delete next[column]
                  place({
                    f: Object.keys(next).length ? JSON.stringify(next) : undefined,
                    p: undefined,
                  })
                }}
              >
                <CloseIcon size={14} />
              </button>
            </span>
          ))}
          <span class="toolbar-gap" />
          <Checkbox checked={showSystem} onChange={setShowSystem} label="System fields" />
          <button
            type="button"
            class="icon-button"
            aria-label="Read again"
            title="Read again"
            onClick={loaded.reload}
          >
            <RefreshIcon size={18} />
          </button>
        </>
      }
      sidebar={<CollectionSidebar schema={ws} table={table} />}
    >
      {!readable.length ? (
        <Notice tone="warning" title="You may not read any field of this collection">
          {info.can_insert || columns.some((c) => c.can_insert)
            ? 'You may still add records: PostgreSQL grants you INSERT without SELECT, so a write reports how many rows it touched and nothing more.'
            : 'PostgreSQL grants your role no SELECT here.'}
        </Notice>
      ) : loaded.error ? (
        <Notice tone="danger" title={describe(loaded.error).title}>
          {describe(loaded.error).detail}
        </Notice>
      ) : (
        <>
          <div class={clsx('grid-wrap', loaded.loading && 'is-loading')}>
            <table class="grid">
              <thead>
                <tr>
                  {canDelete && (
                    <th class="grid-check sticky">
                      <input
                        type="checkbox"
                        aria-label="Select every record on this page"
                        checked={allSelected}
                        onChange={(e) =>
                          setSelected(
                            e.currentTarget.checked
                              ? new Set(rows.map((r) => String(r.id)))
                              : new Set()
                          )
                        }
                      />
                    </th>
                  )}
                  {shown.map((field, i) => {
                    const direction =
                      sort[0] === field.name
                        ? 'ascending'
                        : sort[0] === `-${field.name}`
                          ? 'descending'
                          : 'none'
                    return (
                      <th
                        key={field.name}
                        aria-sort={direction}
                        class={clsx(
                          field.type.numeric && 'is-number',
                          i === 0 && 'sticky',
                          i === 0 && canDelete && 'sticky-2'
                        )}
                      >
                        <button
                          type="button"
                          class="grid-sort"
                          onClick={() => toggleSort(field.name)}
                        >
                          <span title={field.named ? field.name : undefined}>{field.label}</span>
                          {direction === 'ascending' ? (
                            <ArrowUpIcon size={14} aria-hidden="true" />
                          ) : direction === 'descending' ? (
                            <ArrowDownIcon size={14} aria-hidden="true" />
                          ) : null}
                        </button>
                      </th>
                    )
                  })}
                  {hidden.map((c) => (
                    <th
                      key={c.name}
                      class="grid-hidden"
                      title={`PostgreSQL gives you no SELECT on ${c.name}`}
                    >
                      <span>
                        <LockIcon size={13} aria-hidden="true" /> {c.name}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const id = row.id === undefined ? null : String(row.id)
                  const open = id ? href('/content/item', { ws, c: table, id }) : undefined
                  return (
                    <tr
                      key={id ?? index}
                      class={clsx(open && 'is-link', id && selected.has(id) && 'is-selected')}
                      onClick={(e) => {
                        if (!open || (e.target as HTMLElement).closest('input, a, button')) return
                        location.route(open)
                      }}
                    >
                      {canDelete && (
                        <td class="grid-check sticky">
                          <input
                            type="checkbox"
                            aria-label="Select this record"
                            checked={Boolean(id && selected.has(id))}
                            onChange={(e) => {
                              const next = new Set(selected)
                              if (e.currentTarget.checked) next.add(id!)
                              else next.delete(id!)
                              setSelected(next)
                            }}
                          />
                        </td>
                      )}
                      {shown.map((field, i) => {
                        const cell = (
                          <Value
                            value={row[field.name]}
                            field={field}
                            situation="list"
                            label={labelOf(field, row[field.name])}
                          />
                        )
                        return (
                          <td
                            key={field.name}
                            class={clsx(
                              field.type.numeric && 'is-number',
                              i === 0 && 'sticky',
                              i === 0 && canDelete && 'sticky-2'
                            )}
                          >
                            {i === 0 && open ? (
                              <a href={open} class="grid-open clip clip-wide">
                                {cell}
                              </a>
                            ) : (
                              cell
                            )}
                          </td>
                        )
                      })}
                      {hidden.map((c) => (
                        <td key={c.name} class="grid-hidden" aria-label="hidden" />
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {!loaded.loading && loaded.data && !rows.length && (
              <Empty
                icon={<SearchIcon size={26} />}
                title={
                  Object.keys(filter).length || search
                    ? 'No record matches'
                    : 'No record reaches you'
                }
              >
                {Object.keys(filter).length || search
                  ? 'Change the search or remove a filter.'
                  : info.rls
                    ? 'The collection may hold rows that a row policy keeps from you. See the policies in the sidebar.'
                    : 'The collection is empty.'}
              </Empty>
            )}
            {!loaded.data && loaded.loading && <Loading />}
          </div>
          <footer class="pager">
            <span>
              {total
                ? `${count((pageNumber - 1) * limit + 1)}–${count(Math.min(total, pageNumber * limit))} of ${count(total)}`
                : '0 records'}
            </span>
            <span class="pager-size">
              <Select
                value={String(limit)}
                onChange={(e) => place({ n: e.currentTarget.value, p: undefined })}
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
                onClick={() => place({ p: String(pageNumber - 1) })}
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
                onClick={() => place({ p: String(pageNumber + 1) })}
              >
                <ChevronRightIcon size={18} />
              </button>
            </span>
          </footer>
        </>
      )}
      <Confirm
        open={confirming}
        title={`Delete ${plural(selected.size, 'record')}?`}
        confirm="Delete"
        busy={deleting}
        onConfirm={removeSelected}
        onClose={() => setConfirming(false)}
      >
        <p>
          Each runs as <span class="mono">DELETE FROM {qualified(ws, table)} WHERE id = …</span>{' '}
          under your role. A row policy may keep PostgreSQL from deleting some of them; you will be
          told how many it deleted.
        </p>
      </Confirm>
    </Page>
  )
}
