import { Fragment } from 'preact'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import {
  activity,
  columnsOf,
  deleteRecord,
  fieldMetadata,
  insertRecord,
  labelColumn,
  record,
  relationLabels,
  systemColumns,
  tableOf,
  updateRecord,
} from '@platform/data'
import { ident, qualified, inRecord, isLocked } from '@platform/sql'
import { ago, display, shortType } from '../format.ts'
import { describe, useLoad, useSession } from '../session.tsx'
import { Page, SideGroup, useWorkspace } from '../shell.tsx'
import { fieldText, fieldValue, isWide } from '../fields/edit.ts'
import { Value } from '../fields/renderers.tsx'
import { resolveFields } from '../fields/resolve.ts'
import { defaultText } from '../fields/text.ts'
import type { Field as FieldInfo } from '../fields/types.ts'
import { presentationOf } from '@platform/data'
import { href } from '../url.ts'
import { Badge, Loading, Notice, Statement } from '../ui/bits.tsx'
import { Action } from '../ui/button.tsx'
import { Field } from '../ui/form.tsx'
import {
  BackIcon,
  CheckIcon,
  CollectionIcon,
  HiddenIcon,
  HistoryIcon,
  InfoIcon,
  LockIcon,
  TrashIcon,
} from '../ui/icons.tsx'
import { Confirm } from '../ui/overlay.tsx'
import { CollectionSidebar } from './records.tsx'
import { RevisionList } from '../activity/activity.tsx'

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
  // The record is read only when there is a column to read it with.
  const wanted = !creating && Boolean(info) && readable.length > 0
  const loaded = useLoad(
    // One connection, two questions: the record itself, and what its fields are called and
    // where they appear. A field this reader may not reach is not in the second answer:
    // PostgreSQL did not return its metadata.
    info
      ? async (db) => {
          const row = wanted
            ? await record(
                db,
                ws,
                table,
                readable.map((c) => c.name),
                id
              )
            : null
          // The name of the row a relation points at, so the record may draw it by name.
          const labels = row
            ? await relationLabels(
                db,
                catalog,
                ws,
                table,
                [row],
                readable.map((c) => c.name)
              )
            : {}
          return {
            record: row,
            labels,
            described: await fieldMetadata(db, ws, table),
          }
        }
      : null,
    [ws, table, id, catalog, creating, wanted]
  )
  const original = loaded.data?.record ?? null
  // The fields of the collection, each read once: what PostgreSQL says of the column, what
  // the field says of itself — its name, where it appears, how it is drawn — and the type
  // that follows. The saying is the field's own metadata, so PostgreSQL's row security
  // decided who may read it.
  const described = loaded.data?.described
  const all = useMemo(
    () => resolveFields(catalog, ws, table, described),
    [catalog, ws, table, described]
  )
  /** May the reader reach the field at all, in the form they are in? */
  const reachable = (field: FieldInfo) =>
    creating ? field.column.can_insert : field.column.can_select || field.column.can_update
  const own = all.filter((field) => !field.system)
  const fields = own.filter((field) => reachable(field) && inRecord(field.views))
  const unreachable = own.filter((field) => !reachable(field))
  // The fields the owner keeps out of the record, though the reader may reach them.
  const withheld = own.filter((field) => reachable(field) && !inRecord(field.views))
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [problem, setProblem] = useState<{ title: string; detail?: string } | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  useEffect(() => {
    setDraft({})
    setProblem(null)
  }, [ws, table, id])

  /** What the form held for a field when it opened: the stored value, as text. */
  const storedText = (field: FieldInfo) =>
    creating ? '' : fieldText(field, original?.[field.name])
  /** What the form holds for a field now: what was typed, or what was stored. */
  const textOf = (field: FieldInfo) => draft[field.name] ?? storedText(field)
  const changed = fields.filter(
    (field) => field.name in draft && draft[field.name] !== storedText(field)
  )
  const errors: Record<string, string> = {}
  const values: Record<string, unknown> = {}
  for (const field of changed) {
    const parsed = fieldValue(field, draft[field.name]!)
    if ('error' in parsed) errors[field.name] = parsed.error
    else values[field.name] = parsed.value
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
      // The write, and then the record as it stands: when PostgreSQL changed no row, what
      // it holds now says whether someone else changed it first.
      const outcome = await withDb(async (db) => {
        const affected = await updateRecord(db, ws, table, id, values, version)
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
                    {systemColumns.map((name) => {
                      const field = all.find((one) => one.name === name)
                      if (!field || !(name in original)) return null
                      return (
                        <Fragment key={name}>
                          <dt>{name.replace('_', ' ').replace(/^./, (c) => c.toUpperCase())}</dt>
                          <dd>
                            <Value value={original[name]} field={field} situation="record" />
                          </dd>
                        </Fragment>
                      )
                    })}
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
      {loaded.error ? (
        <Notice tone="danger" title={describe(loaded.error).title}>
          {describe(loaded.error).detail ?? 'PostgreSQL could not read this record.'}
        </Notice>
      ) : !loaded.data ? (
        <Loading />
      ) : !creating && wanted && original === null ? (
        <Notice tone="warning" title="No such record reaches you">
          It does not exist, or a row policy keeps it from your role.
        </Notice>
      ) : (
        <form ref={formRef} class="form" onSubmit={save}>
          {fields.map((field) => (
            <RecordField
              key={field.name}
              field={field}
              creating={creating}
              text={textOf(field)}
              error={errors[field.name]}
              onChange={(text) => setDraft({ ...draft, [field.name]: text })}
              stored={original?.[field.name]}
              storedLabel={loaded.data?.labels[field.name]?.[String(original?.[field.name])]}
            />
          ))}
          {withheld.length > 0 && (
            <div class="field field-wide unreachable">
              <p>
                <HiddenIcon size={16} aria-hidden="true" />
                Not in the record:{' '}
                {withheld.map((c, i) => (
                  <span key={c.name}>
                    {i > 0 && ', '}
                    <span class="mono">{c.name}</span>
                  </span>
                ))}
                . The owner of this collection keeps these fields out of the form.
              </p>
            </div>
          )}
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

/**
 * One field of the record form: its name, what it is, and either the input that changes it or
 * the value it holds. Which of the two is PostgreSQL's to say first — a column it computes is
 * never written, and a right it withholds is not offered — and the owner's after it.
 */
function RecordField({
  field,
  creating,
  text,
  error,
  onChange,
  stored,
  storedLabel,
}: {
  field: FieldInfo
  creating: boolean
  /** What the form holds for the field: text, as typed. */
  text: string
  error?: string
  onChange: (text: string) => void
  /** The value the record holds, when there is a record. */
  stored: unknown
  /** The name of the row a relation points at, when the reader may read it. */
  storedLabel?: string | null
}) {
  const { column, computed } = field
  const id = `field-${field.name}`
  // PostgreSQL computes some columns itself, and the owner of a collection may lock a field:
  // either way it is shown, and never offered as an input.
  const locked = isLocked(field.views)
  const writable = !computed && !locked && (creating ? column.can_insert : column.can_update)
  const reason = computed
    ? column.generated
      ? 'PostgreSQL computes this column: a generated column is never written.'
      : 'PostgreSQL numbers this column itself: an identity column is never written.'
    : locked
      ? 'The owner of this collection marked this field read-only.'
      : 'PostgreSQL gives you no UPDATE on this field.'
  const wide = isWide(field, text)
  const Input = field.type.Input
  return (
    <Field
      id={id}
      label={field.label}
      required={column.required && !column.default}
      wide={wide}
      error={error}
      hint={column.comment ?? undefined}
      aside={
        <span class="field-tags">
          <span class="field-type mono">{shortType(column.type)}</span>
          {!column.can_select && (
            <Badge tone="warning" title="You may write this field but not read it back">
              write-only
            </Badge>
          )}
          {!writable && (
            <Badge title={reason}>
              <LockIcon size={12} aria-hidden="true" /> read-only
            </Badge>
          )}
        </span>
      }
    >
      {!computed && !locked ? (
        <Input
          field={field}
          id={id}
          text={text}
          onChange={onChange}
          disabled={!writable}
          creating={creating}
          wide={wide}
        />
      ) : !column.can_select ? (
        <p class="side-note">
          You may write this field, but you may not read it back: PostgreSQL grants you no SELECT on
          it.
        </p>
      ) : creating ? (
        <p class="side-note">
          {column.default
            ? `PostgreSQL writes this field: ${defaultText(column.default)} by default.`
            : 'PostgreSQL writes this field itself.'}
        </p>
      ) : (
        // A field the reader may not change is drawn, not offered: the record shows what it
        // holds, drawn the way the field says it is drawn.
        <div class="value-readonly">
          <Value value={stored} field={field} situation="record" label={storedLabel} />
        </div>
      )}
    </Field>
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
