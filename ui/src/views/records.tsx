import clsx from 'clsx'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import type { Db } from '../db/connect.ts'
import {
  type Condition,
  type Filter,
  type Operator,
  operatorLabels,
  valueless,
} from '../db/filter.ts'
import { deleteRecord, metadata, records } from '../db/platform.ts'
import { ident, qualified } from '../db/sql.ts'
import type { Catalog, ColumnInfo, PolicyInfo } from '../db/types.ts'
import { count, plural } from '../format.ts'
import { describe, useLoad, useSession } from '../session.tsx'
import { Page, SideGroup, useWorkspace } from '../shell.tsx'
import {
  choicesOf,
  columnsOf,
  kindOf,
  labelColumn,
  relationOf,
  systemColumns,
  tableOf,
} from '../state/catalog.ts'
import { href } from '../state/url.ts'
import { Badge, Empty, Loading, Notice } from '../ui/bits.tsx'
import { Action, Button } from '../ui/button.tsx'
import { Checkbox, Input, Select } from '../ui/form.tsx'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  CollectionIcon,
  FilterIcon,
  HiddenIcon,
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
import { Legend, Rights } from './rights.tsx'
import { Cell } from './values.tsx'

/** The operators that make sense for a column, by its type. */
export function operatorsFor(column: ColumnInfo, choices: string[] | null): Operator[] {
  if (choices) return ['eq', 'neq', 'in', 'not_in', 'is_null', 'not_null']
  switch (kindOf(column.type)) {
    case 'text':
      return ['contains', 'eq', 'neq', 'starts_with', 'ends_with', 'in', 'is_null', 'not_null']
    case 'integer':
    case 'number':
    case 'date':
    case 'time':
    case 'moment':
      return ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_null', 'not_null']
    case 'boolean':
      return ['eq', 'is_null', 'not_null']
    default:
      return ['eq', 'neq', 'contains', 'is_null', 'not_null']
  }
}

function readFilter(text: string | undefined): Filter {
  if (!text) return {}
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? (parsed as Filter) : {}
  } catch {
    return {}
  }
}

function conditionText(condition: Condition): string {
  const label = operatorLabels[condition.op]
  if (valueless.includes(condition.op)) return label
  const value = Array.isArray(condition.value)
    ? condition.value.join(', ')
    : String(condition.value)
  return `${label} ${value}`
}

/** The labels of the rows a relation column points at, read in one statement per target. */
export async function relationLabels(
  db: Db,
  catalog: Catalog,
  schema: string,
  table: string,
  rows: Record<string, unknown>[],
  columns: string[]
): Promise<Record<string, Record<string, string>>> {
  const out: Record<string, Record<string, string>> = {}
  for (const column of columns) {
    const relation = relationOf(catalog, schema, table, column)
    if (!relation) continue
    const ids = [
      ...new Set(rows.map((r) => r[column]).filter((v) => v !== null && v !== undefined)),
    ]
    if (!ids.length) continue
    const label = labelColumn(catalog, relation.target_schema, relation.target_table)
    const target = tableOf(catalog, relation.target_schema, relation.target_table)
    if (!label || !target?.can_select) continue
    try {
      const found = await db.query<{ id: string; label: string }>(
        `SELECT id::text AS id, ${ident(label)}::text AS label FROM ${qualified(relation.target_schema, relation.target_table)} WHERE id::text = ANY($1)`,
        [ids.map(String)]
      )
      out[column] = Object.fromEntries(found.rows.map((r) => [r.id, r.label]))
    } catch {
      // A label the reader may not read stays an id.
    }
  }
  return out
}

/** The row policies on a collection, and whether each one speaks for the reader. */
export async function tablePolicies(db: Db, schema: string, table: string) {
  const result = await db.query<PolicyInfo & { applies: boolean }>(
    `SELECT schemaname::text AS schema, tablename::text AS table, policyname::text AS name, permissive,
            roles::text[] AS roles, cmd AS command, qual AS using, with_check AS check,
            EXISTS (SELECT 1 FROM unnest(roles) r
                     WHERE r = 'public' OR (EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r)
                                            AND pg_has_role(session_user, r, 'MEMBER'))) AS applies
       FROM pg_policies WHERE schemaname = $1 AND tablename = $2 ORDER BY policyname`,
    [schema, table]
  )
  return result.rows
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
              <Badge tone="primary">{info.force_rls ? 'On, forced' : 'On'}</Badge>
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

function FilterBuilder({
  columns,
  choices,
  onAdd,
}: {
  columns: ColumnInfo[]
  choices: (column: string) => string[] | null
  onAdd: (column: string, condition: Condition) => void
}) {
  const [open, setOpen] = useState(false)
  const [column, setColumn] = useState(columns[0]?.name ?? '')
  const info = columns.find((c) => c.name === column) ?? columns[0]
  const options = info ? choices(info.name) : null
  const ops = info ? operatorsFor(info, options) : []
  const [op, setOp] = useState<Operator>(ops[0] ?? 'eq')
  const [value, setValue] = useState('')
  useEffect(() => {
    if (!ops.includes(op)) setOp(ops[0] ?? 'eq')
    setValue(options?.[0] ?? '')
  }, [column])
  const apply = (event: Event) => {
    event.preventDefault()
    if (!info) return
    const kind = kindOf(info.type)
    let parsed: unknown = value
    if (op === 'in' || op === 'not_in')
      parsed = value
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)
    else if (kind === 'boolean') parsed = value === 'true'
    onAdd(info.name, { op, value: valueless.includes(op) ? null : parsed })
    setOpen(false)
    setValue('')
  }
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
            {columns.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
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
          {!valueless.includes(op) &&
            (info && kindOf(info.type) === 'boolean' ? (
              <Select
                value={value || 'true'}
                onChange={(e) => setValue(e.currentTarget.value)}
                aria-label="Value"
              >
                <option value="true">true</option>
                <option value="false">false</option>
              </Select>
            ) : options && (op === 'eq' || op === 'neq') ? (
              <Select
                value={value}
                onChange={(e) => setValue(e.currentTarget.value)}
                aria-label="Value"
              >
                {options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                value={value}
                onInput={(e) => setValue(e.currentTarget.value)}
                placeholder={op === 'in' || op === 'not_in' ? 'a, b, c' : 'Value'}
                aria-label="Value"
              />
            ))}
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
  const { catalog, withDb, notify } = useSession()
  const location = useLocation()
  const { query } = location
  const ws = useWorkspace()
  const table = query.c ?? ''
  const info = tableOf(catalog, ws, table)
  const columns = columnsOf(catalog, ws, table)
  const readable = columns.filter((c) => c.can_select)
  const [showSystem, setShowSystem] = useState(false)
  // The record's own fields first, then the platform's: who changed it and when.
  const shown = [
    ...readable.filter((c) => !systemColumns.includes(c.name)),
    ...readable.filter(
      (c) => systemColumns.includes(c.name) && (showSystem || c.name === 'updated_at')
    ),
  ]
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
          const about = await metadata(db, ws, table)
          return { ...page, labels, about }
        }
      : null,
    [ws, table, query.f, search, query.s, limit, pageNumber, catalog]
  )

  const choices = (column: string) => choicesOf(catalog, ws, table, column)
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

  const memoKey = useMemo(() => JSON.stringify(filter), [query.f])
  void memoKey

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

  const display =
    (loaded.data?.about.find((m) => m.key === 'display_field')?.value as string | undefined) ?? null
  void display

  return (
    <Page
      title={table}
      icon={<CollectionIcon size={22} />}
      crumbs={[
        { label: 'Content', href: href('/content', { ws }) },
        { label: ws, href: href('/content', { ws }) },
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
          <FilterBuilder
            columns={readable}
            choices={choices}
            onAdd={(column, condition) =>
              place({ f: JSON.stringify({ ...filter, [column]: condition }), p: undefined })
            }
          />
          {Object.entries(filter).map(([column, condition]) => (
            <span key={column} class="chip">
              <span class="mono">{column}</span> {conditionText(condition)}
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
                  {shown.map((c, i) => {
                    const direction =
                      sort[0] === c.name
                        ? 'ascending'
                        : sort[0] === `-${c.name}`
                          ? 'descending'
                          : 'none'
                    return (
                      <th
                        key={c.name}
                        aria-sort={direction}
                        class={clsx(
                          ['integer', 'number'].includes(kindOf(c.type)) && 'is-number',
                          i === 0 && 'sticky',
                          i === 0 && canDelete && 'sticky-2'
                        )}
                      >
                        <button type="button" class="grid-sort" onClick={() => toggleSort(c.name)}>
                          <span>{c.name}</span>
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
                      {shown.map((c, i) => (
                        <td
                          key={c.name}
                          class={clsx(
                            ['integer', 'number'].includes(kindOf(c.type)) && 'is-number',
                            i === 0 && 'sticky',
                            i === 0 && canDelete && 'sticky-2'
                          )}
                        >
                          {i === 0 && open ? (
                            <a href={open} class="grid-open clip clip-wide">
                              <Cell
                                value={row[c.name]}
                                column={c}
                                label={loaded.data?.labels[c.name]?.[String(row[c.name])]}
                              />
                            </a>
                          ) : (
                            <Cell
                              value={row[c.name]}
                              column={c}
                              choices={choices(c.name)}
                              label={
                                relationOf(catalog, ws, table, c.name)
                                  ? (loaded.data?.labels[c.name]?.[String(row[c.name])] ?? '')
                                  : undefined
                              }
                            />
                          )}
                        </td>
                      ))}
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
