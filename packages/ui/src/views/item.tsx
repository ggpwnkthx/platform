import clsx from 'clsx'
import { Fragment } from 'preact'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import {
  activity,
  deleteRecord,
  insertRecord,
  record,
  relationOptions,
  updateRecord,
} from '../db/platform.ts'
import { ident, qualified } from '@platform/sql'
import type { ColumnInfo } from '../db/types.ts'
import { ago, display, moment, shortType } from '../format.ts'
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
import { presentationOf } from '../state/presentation.ts'
import { href } from '../state/url.ts'
import { Badge, Loading, Notice, Statement } from '../ui/bits.tsx'
import { Action } from '../ui/button.tsx'
import { Field, Input, Select, TextArea } from '../ui/form.tsx'
import {
  BackIcon,
  CheckIcon,
  CollectionIcon,
  HiddenIcon,
  HistoryIcon,
  InfoIcon,
  LockIcon,
  RelationIcon,
  SearchIcon,
  TrashIcon,
} from '../ui/icons.tsx'
import { Confirm, Menu } from '../ui/overlay.tsx'
import { CollectionSidebar } from './records.tsx'
import { RevisionList } from './activity.tsx'

/** A column default as a person reads it: 'draft'::text is draft. */
const defaultText = (expression: string) =>
  expression.match(/^'((?:[^']|'')*)'::/)?.[1]?.replaceAll("''", "'") ?? expression

const longText = /(notes?|description|body|wording|content|summary|details|bio|text)$/

/** What the form holds for a column: text as typed. */
function asText(value: unknown, column: ColumnInfo): string {
  if (value === null || value === undefined) return ''
  if (kindOf(column.type) === 'json') return JSON.stringify(value, null, 2)
  return display(value)
}

/** The value a column receives from what was typed, or an error to show under the field. */
function fromText(text: string, column: ColumnInfo): { value: unknown } | { error: string } {
  const kind = kindOf(column.type)
  if (text === '') return { value: kind === 'text' && column.required ? '' : null }
  if (kind === 'json') {
    try {
      return { value: JSON.parse(text) }
    } catch {
      return { error: 'Not valid JSON' }
    }
  }
  if (kind === 'boolean') return { value: text === 'true' }
  if (kind === 'integer' && !/^-?\d+$/.test(text.trim())) return { error: 'A whole number' }
  if (kind === 'number' && !/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(text.trim()))
    return { error: 'A number' }
  return { value: kind === 'text' ? text : text.trim() }
}

function RelationPicker({
  schema,
  table,
  column,
  value,
  onChange,
  disabled,
  id,
}: {
  schema: string
  table: string
  column: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  id: string
}) {
  const { catalog, withDb } = useSession()
  const relation = relationOf(catalog, schema, table, column)!
  const target = tableOf(catalog, relation.target_schema, relation.target_table)
  const label = labelColumn(catalog, relation.target_schema, relation.target_table)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [options, setOptions] = useState<{ id: string; label: string }[]>([])
  const [current, setCurrent] = useState<string | null>(null)
  useEffect(() => {
    if (!value || !target?.can_select) {
      setCurrent(null)
      return
    }
    void withDb((db) =>
      relationOptions(db, relation.target_schema, relation.target_table, label, value)
    )
      .then((found) => setCurrent(found.find((o) => o.id === value)?.label ?? null))
      .catch(() => setCurrent(null))
  }, [value])
  useEffect(() => {
    if (!open || !target?.can_select) return
    const timer = setTimeout(() => {
      void withDb((db) =>
        relationOptions(db, relation.target_schema, relation.target_table, label, search)
      )
        .then(setOptions)
        .catch(() => setOptions([]))
    }, 150)
    return () => clearTimeout(timer)
  }, [open, search])
  if (!target?.can_select)
    return (
      <Input
        id={id}
        mono
        value={value}
        disabled={disabled}
        placeholder={`id in ${relation.target_table} (you may not read it)`}
        onInput={(e) => onChange(e.currentTarget.value)}
      />
    )
  return (
    <div class="menu-anchor relation">
      <button
        id={id}
        type="button"
        class="input relation-button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <RelationIcon size={16} aria-hidden="true" />
        {value ? (
          <span>
            {current ?? <span class="mono">{value}</span>}
            <small class="mono">{value.slice(0, 8)}</small>
          </span>
        ) : (
          <span class="placeholder">Choose a row of {relation.target_table}</span>
        )}
      </button>
      <Menu open={open} onClose={() => setOpen(false)} align="start">
        <label class="search search-menu">
          <SearchIcon size={16} aria-hidden="true" />
          <input
            value={search}
            onInput={(e) => setSearch(e.currentTarget.value)}
            placeholder={`Search ${relation.target_table}`}
            aria-label={`Search ${relation.target_table}`}
          />
        </label>
        <div class="relation-options" role="listbox">
          {!column || !options.length ? <p class="menu-note">Nothing found.</p> : null}
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              role="option"
              aria-selected={o.id === value}
              class={clsx('menu-item', o.id === value && 'is-current')}
              onClick={() => {
                onChange(o.id)
                setOpen(false)
              }}
            >
              <span>{o.label}</span>
              <small class="mono">{o.id.slice(0, 8)}</small>
            </button>
          ))}
          {value && (
            <button
              type="button"
              class="menu-item"
              onClick={() => {
                onChange('')
                setOpen(false)
              }}
            >
              <span class="side-muted">Clear</span>
            </button>
          )}
        </div>
      </Menu>
    </div>
  )
}

export function Item() {
  const { catalog, withDb, notify, presentations } = useSession()
  const location = useLocation()
  const ws = useWorkspace()
  const table = location.query.c ?? ''
  const workspace = presentationOf(presentations, ws)
  const collection = presentationOf(presentations, ws, table)
  const id = location.query.id ?? '+'
  const creating = id === '+'
  const info = tableOf(catalog, ws, table)
  const columns = columnsOf(catalog, ws, table)
  const readable = columns.filter((c) => c.can_select)
  const fields = columns.filter(
    (c) =>
      !systemColumns.includes(c.name) && (creating ? c.can_insert : c.can_select || c.can_update)
  )
  const unreachable = columns.filter(
    (c) =>
      !systemColumns.includes(c.name) && !(creating ? c.can_insert : c.can_select || c.can_update)
  )
  const loaded = useLoad(
    !creating && info && readable.length
      ? (db) =>
          record(
            db,
            ws,
            table,
            readable.map((c) => c.name),
            id
          )
      : null,
    [ws, table, id, catalog]
  )
  const original = loaded.data ?? null
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [problem, setProblem] = useState<{ title: string; detail?: string } | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  useEffect(() => {
    setDraft({})
    setProblem(null)
  }, [ws, table, id])

  const textOf = (c: ColumnInfo) =>
    c.name in draft ? draft[c.name]! : creating ? '' : asText(original?.[c.name], c)
  const changed = fields.filter(
    (c) => c.name in draft && draft[c.name] !== (creating ? '' : asText(original?.[c.name], c))
  )
  const errors: Record<string, string> = {}
  const values: Record<string, unknown> = {}
  for (const c of changed) {
    const parsed = fromText(draft[c.name]!, c)
    if ('error' in parsed) errors[c.name] = parsed.error
    else values[c.name] = parsed.value
  }
  const version = typeof original?.version === 'number' ? original.version : undefined
  const statement = useMemo(() => {
    const names = Object.keys(values)
    if (!names.length) return null
    if (creating)
      return `INSERT INTO ${qualified(ws, table)} (${names.map(ident).join(', ')})\nVALUES (${names.map((_, i) => `$${i + 1}`).join(', ')});`
    return `UPDATE ${qualified(ws, table)}\n   SET ${names.map((n, i) => `${ident(n)} = $${i + 1}`).join(',\n       ')}\n WHERE id = $${names.length + 1}${version !== undefined ? ` AND version = $${names.length + 2}` : ''};`
  }, [JSON.stringify(values), creating, version])

  const save = async (event?: Event) => {
    event?.preventDefault()
    if (Object.keys(errors).length) return
    setSaving(true)
    setProblem(null)
    try {
      if (creating) {
        const affected = await withDb((db) => insertRecord(db, ws, table, values))
        notify({
          tone: 'success',
          title: affected ? 'Record created' : 'PostgreSQL created no record',
        })
        location.route(href('/content/records', { ws, c: table }))
        return
      }
      const outcome = await withDb(async (db) => {
        const affected = await updateRecord(db, ws, table, id, values, version)
        if (affected)
          return {
            affected,
            now: readable.length
              ? await record(
                  db,
                  ws,
                  table,
                  readable.map((c) => c.name),
                  id
                )
              : null,
          }
        const now = readable.length
          ? await record(
              db,
              ws,
              table,
              readable.map((c) => c.name),
              id
            )
          : null
        return { affected, now }
      })
      if (outcome.affected) {
        notify({ tone: 'success', title: 'Saved' })
        setDraft({})
        loaded.reload()
      } else if (outcome.now && version !== undefined && outcome.now.version !== version) {
        setProblem({
          title: `Changed by ${display(outcome.now.updated_by) || 'someone else'} since you opened it`,
          detail: `It is at version ${display(outcome.now.version)}; you edited version ${version}. Your changes are still in the form: read the record again before saving.`,
        })
      } else {
        setProblem({
          title: 'PostgreSQL changed no row',
          detail:
            'A row policy on this collection does not let you change this record, or it is no longer there.',
        })
      }
    } catch (error) {
      setProblem(describe(error))
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    setSaving(true)
    try {
      const affected = await withDb((db) => deleteRecord(db, ws, table, id, version))
      setConfirming(false)
      if (affected) {
        notify({ tone: 'success', title: 'Record deleted' })
        location.route(href('/content/records', { ws, c: table }))
      } else
        setProblem({
          title: 'PostgreSQL deleted no row',
          detail: 'A row policy keeps this record from you, or it changed since you opened it.',
        })
    } catch (error) {
      setConfirming(false)
      setProblem(describe(error))
    } finally {
      setSaving(false)
    }
  }

  // Save with Ctrl or Cmd + S.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        event.preventDefault()
        formRef.current?.requestSubmit()
      }
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  })

  const back = href('/content/records', { ws, c: table })
  if (!info)
    return (
      <Page title="Record" icon={<CollectionIcon size={22} />}>
        <Notice tone="warning" title={`PostgreSQL shows you no collection named ${ws}.${table}`} />
      </Page>
    )
  const title = creating
    ? `New record`
    : (() => {
        const label = labelColumn(catalog, ws, table)
        return (label && original ? display(original[label]) : '') || `Record ${id.slice(0, 8)}`
      })()
  // A record that did not load offers nothing to save or delete.
  const present = creating || Boolean(original)
  const canDelete = !creating && info.can_delete && present
  const dirty = changed.length > 0
  return (
    <Page
      title={title}
      icon={
        <a href={back} class="header-back" aria-label={`Back to ${table}`}>
          <BackIcon size={20} />
        </a>
      }
      crumbs={[
        { label: workspace.displayName ?? ws, href: href('/content', { ws }) },
        { label: collection.displayName ?? table, href: back },
      ]}
      actions={
        <>
          {canDelete && (
            <Action
              tone="danger"
              label="Delete record"
              icon={<TrashIcon size={20} />}
              onClick={() => setConfirming(true)}
            />
          )}
          {present && (
            <Action
              label={creating ? 'Create record' : 'Save changes (Ctrl+S)'}
              icon={<CheckIcon size={22} />}
              busy={saving}
              disabled={(!dirty && !creating) || Object.keys(errors).length > 0}
              onClick={() => formRef.current?.requestSubmit()}
            />
          )}
        </>
      }
      sidebar={
        <CollectionSidebar
          schema={ws}
          table={table}
          extra={
            !creating && original ? (
              <>
                <SideGroup title="Record" icon={<InfoIcon size={16} />}>
                  <dl class="facts">
                    {systemColumns.map((name) =>
                      original && name in original ? (
                        <Fragment key={name}>
                          <dt>{name.replace('_', ' ').replace(/^./, (c) => c.toUpperCase())}</dt>
                          <dd class="mono">
                            {name.endsWith('_at')
                              ? moment(original[name])
                              : display(original[name])}
                          </dd>
                        </Fragment>
                      ) : null
                    )}
                  </dl>
                  {original && typeof original.updated_at === 'string' && (
                    <p class="side-note">Last changed {ago(original.updated_at)}.</p>
                  )}
                </SideGroup>
                <SideGroup title="Revisions" icon={<HistoryIcon size={16} />}>
                  <RowRevisions schema={ws} table={table} id={id} />
                </SideGroup>
              </>
            ) : undefined
          }
        />
      }
    >
      {problem && (
        <Notice tone="danger" title={problem.title}>
          {problem.detail}
        </Notice>
      )}
      {!creating && loaded.error ? (
        <Notice tone="danger" title={describe(loaded.error).title}>
          {describe(loaded.error).detail ?? 'PostgreSQL could not read this record.'}
        </Notice>
      ) : !creating && loaded.loading && !original ? (
        <Loading />
      ) : !creating && loaded.data === null ? (
        <Notice tone="warning" title="No such record reaches you">
          It does not exist, or a row policy keeps it from your role.
        </Notice>
      ) : (
        <form ref={formRef} class="form" onSubmit={save}>
          {fields.map((c) => {
            const fieldId = `field-${c.name}`
            const writable = creating ? c.can_insert : c.can_update
            const choices = choicesOf(catalog, ws, table, c.name)
            const relation = relationOf(catalog, ws, table, c.name)
            const kind = kindOf(c.type)
            const text = textOf(c)
            const set = (value: string) => setDraft({ ...draft, [c.name]: value })
            const wide =
              kind === 'json' ||
              longText.test(c.name) ||
              (kind === 'text' && !choices && text.length > 60)
            const tags = (
              <span class="field-tags">
                <span class="field-type mono">{shortType(c.type)}</span>
                {!c.can_select && (
                  <Badge tone="warning" title="You may write this field but not read it back">
                    write-only
                  </Badge>
                )}
                {!writable && (
                  <Badge title="PostgreSQL gives you no UPDATE on this field">
                    <LockIcon size={12} aria-hidden="true" /> read-only
                  </Badge>
                )}
              </span>
            )
            let control: preact.ComponentChildren
            if (relation)
              control = (
                <RelationPicker
                  id={fieldId}
                  schema={ws}
                  table={table}
                  column={c.name}
                  value={text}
                  onChange={set}
                  disabled={!writable}
                />
              )
            else if (choices)
              control = (
                <Select
                  id={fieldId}
                  value={text}
                  disabled={!writable}
                  onChange={(e) => set(e.currentTarget.value)}
                >
                  {(!c.required || !text) && (
                    <option value="">
                      {c.default && creating ? `${defaultText(c.default)} (default)` : '—'}
                    </option>
                  )}
                  {choices.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </Select>
              )
            else if (kind === 'boolean')
              control = (
                <Select
                  id={fieldId}
                  value={text}
                  disabled={!writable}
                  onChange={(e) => set(e.currentTarget.value)}
                >
                  <option value="">
                    {creating && c.default ? `${defaultText(c.default)} (default)` : 'null'}
                  </option>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </Select>
              )
            else if (kind === 'json' || (kind === 'text' && wide))
              control = (
                <TextArea
                  id={fieldId}
                  mono={kind === 'json'}
                  rows={kind === 'json' ? 6 : 4}
                  value={text}
                  disabled={!writable}
                  onInput={(e) => set(e.currentTarget.value)}
                />
              )
            else
              control = (
                <Input
                  id={fieldId}
                  type={kind === 'date' ? 'date' : kind === 'time' ? 'time' : 'text'}
                  inputMode={
                    kind === 'integer' ? 'numeric' : kind === 'number' ? 'decimal' : undefined
                  }
                  mono={kind !== 'text'}
                  value={text}
                  disabled={!writable}
                  placeholder={
                    creating && c.default
                      ? `Default: ${defaultText(c.default)}`
                      : kind === 'moment'
                        ? 'YYYY-MM-DD HH:MM:SS+00'
                        : undefined
                  }
                  onInput={(e) => set(e.currentTarget.value)}
                />
              )
            return (
              <Field
                key={c.name}
                id={fieldId}
                label={c.name}
                required={c.required && !c.default}
                wide={wide}
                error={errors[c.name]}
                hint={c.comment ?? undefined}
                aside={tags}
              >
                {control}
              </Field>
            )
          })}
          {unreachable.length > 0 && (
            <div class="field field-wide unreachable">
              <p>
                <HiddenIcon size={16} aria-hidden="true" />
                {creating ? 'You may not set' : 'Hidden from you'}:{' '}
                {unreachable.map((c, i) => (
                  <span key={c.name}>
                    {i > 0 && ', '}
                    <span class="mono">{c.name}</span>
                  </span>
                ))}
                . PostgreSQL grants your role no {creating ? 'INSERT' : 'SELECT or UPDATE'} on{' '}
                {unreachable.length === 1 ? 'it' : 'them'}.
              </p>
            </div>
          )}
          {statement && (
            <div class="field field-wide">
              <Statement
                sql={statement}
                label={`Saving runs this as you, with ${Object.keys(values).length + (creating ? 0 : version !== undefined ? 2 : 1)} bound values`}
              />
            </div>
          )}
          <button type="submit" hidden />
        </form>
      )}
      <Confirm
        open={confirming}
        title="Delete this record?"
        confirm="Delete"
        busy={saving}
        onConfirm={remove}
        onClose={() => setConfirming(false)}
      >
        <p>
          This runs{' '}
          <span class="mono">
            DELETE FROM {qualified(ws, table)} WHERE id = …
            {version !== undefined ? ' AND version = …' : ''}
          </span>{' '}
          as you. The revision stays in the activity log.
        </p>
      </Confirm>
    </Page>
  )
}

function RowRevisions({ schema, table, id }: { schema: string; table: string; id: string }) {
  const found = useLoad(
    (db) => activity(db, { schema, table, row: id, limit: 20 }),
    [schema, table, id]
  )
  if (found.loading && !found.data) return <Loading label="Reading revisions" />
  if (found.error) return <p class="side-note">{describe(found.error).title}</p>
  if (!found.data?.length)
    return (
      <p class="side-note">
        No revision you may read. Revisions are readable by the workspace's owners.
      </p>
    )
  return <RevisionList entries={found.data} compact />
}
