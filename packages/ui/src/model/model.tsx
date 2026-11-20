import clsx from 'clsx'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import {
  builtInTypes,
  collectionStatements,
  commentStatement,
  dropCollectionStatement,
  dropFieldStatement,
  emptyField,
  type FieldDraft,
  fieldStatements,
  fieldTypeLabels,
  numericTypes,
  type OnDelete,
  typeLabel,
} from './statements.ts'
import {
  collectionTarget,
  customViews,
  fieldTarget,
  fieldsViewsStatement,
  situations,
} from '@platform/vocabulary'
import { useLoad, useSession } from '../session.tsx'
import { Page, useWorkspace } from '../shell.tsx'
import { shortType } from '../format.ts'
import {
  choicesOf,
  columnsOf,
  fieldMetadata,
  systemColumns,
  tableOf,
  tablesIn,
} from '@platform/data'
import { rendererNamed } from '../fields/renderers.tsx'
import { resolveFields } from '../fields/resolve.ts'
import { presentationOf } from '@platform/data'
import { situationLabels } from '../metadata/labels.ts'
import { href } from '../url.ts'
import { Badge, Empty, Notice, Statement } from '../ui/bits.tsx'
import { Action, Button } from '../ui/button.tsx'
import { Checkbox, Field, Input, Select, TextArea } from '../ui/form.tsx'
import {
  BooleanIcon,
  ChevronRightIcon,
  CollectionIcon,
  DateIcon,
  iconFor,
  IntegerIcon,
  JsonIcon,
  KeyIcon,
  LockIcon,
  ModelIcon,
  MomentIcon,
  NumberIcon,
  PlusIcon,
  RelationIcon,
  TagIcon,
  TextIcon,
  TimeIcon,
  TrashIcon,
  UuidIcon,
} from '../ui/icons.tsx'
import { Confirm, Drawer } from '../ui/overlay.tsx'
import { FieldMetadataDrawer, KeyEditorPanels, MetadataPanel } from '../metadata/metadata.tsx'
import { CollectionAccess, FieldAccess } from '../access/collection-access.tsx'
import { Rights } from '../access/rights.tsx'
import { useRunner } from '../access/runner.tsx'

const typeIcons: Record<string, typeof TextIcon> = {
  text: TextIcon,
  integer: IntegerIcon,
  bigint: IntegerIcon,
  decimal: NumberIcon,
  float: NumberIcon,
  boolean: BooleanIcon,
  date: DateIcon,
  time: TimeIcon,
  timestamp: MomentIcon,
  uuid: UuidIcon,
  json: JsonIcon,
  relation: RelationIcon,
}

/** The mark a type is drawn with: its own, or the mark of a type nobody has drawn. */
const iconOfType = (type: string): typeof TextIcon => typeIcons[type] ?? TagIcon

/** Builds one field: its type, its name and the constraints the database will hold it to. */
export function FieldEditor({
  field,
  onChange,
  collections,
  prefix,
}: {
  field: FieldDraft
  onChange: (field: FieldDraft) => void
  collections: string[]
  prefix: string
}) {
  const { catalog } = useSession()
  const set = (changes: Partial<FieldDraft>) => onChange({ ...field, ...changes })
  const numeric = numericTypes.includes(field.type)
  // The types the installation holds besides the platform's own: an extension's, or its own.
  const others = catalog.types
  const own = builtInTypes.includes(field.type)
  const choice = (type: string, label: string, Icon: typeof TextIcon) => (
    <label key={type} class={clsx('type-option', field.type === type && 'is-chosen')}>
      <input
        type="radio"
        name={`${prefix}-type`}
        value={type}
        checked={field.type === type}
        onChange={() => set({ type, modifiers: undefined })}
      />
      <Icon size={18} aria-hidden="true" />
      <span>{label}</span>
    </label>
  )
  return (
    <div class="form">
      <fieldset class="field field-wide types">
        <legend class="field-label">Type</legend>
        <div class="type-grid">
          {builtInTypes.map((type) => choice(type, fieldTypeLabels[type]!, iconOfType(type)))}
        </div>
      </fieldset>
      {others.length > 0 && (
        <fieldset class="field field-wide types">
          <legend class="field-label">Types in this database</legend>
          <div class="type-grid">
            {others.map((type) => choice(type.name, type.label, iconOfType(type.name)))}
          </div>
        </fieldset>
      )}
      {!own && (
        <Field
          label="Modifier"
          id={`${prefix}-mod`}
          hint="What the type itself takes: Point, 4326 for a geometry. Empty for the plain type."
        >
          <Input
            id={`${prefix}-mod`}
            mono
            value={(field.modifiers ?? []).join(', ')}
            onInput={(e) =>
              set({
                modifiers: e.currentTarget.value
                  .split(',')
                  .map((part) => part.trim())
                  .filter(Boolean),
              })
            }
            placeholder="Point, 4326"
          />
        </Field>
      )}
      <Field
        label="Name"
        id={`${prefix}-name`}
        required
        hint="The column's name. Lower case and underscores read best in SQL."
      >
        <Input
          id={`${prefix}-name`}
          mono
          value={field.name}
          onInput={(e) => set({ name: e.currentTarget.value })}
          placeholder="published_at"
        />
      </Field>
      <Field
        label="Default"
        id={`${prefix}-default`}
        hint="Used when a record leaves the field out."
      >
        <Input
          id={`${prefix}-default`}
          mono
          value={field.default}
          onInput={(e) => set({ default: e.currentTarget.value })}
        />
      </Field>
      {field.type === 'relation' && (
        <>
          <Field
            label="Points at"
            id={`${prefix}-rel`}
            required
            hint="A collection in this workspace; the field holds one of its ids."
          >
            <Select
              id={`${prefix}-rel`}
              value={field.relation ?? ''}
              onChange={(e) => set({ relation: e.currentTarget.value })}
            >
              <option value="">Choose a collection</option>
              {collections.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="When that row is deleted" id={`${prefix}-ondelete`}>
            <Select
              id={`${prefix}-ondelete`}
              value={field.onDelete ?? 'restrict'}
              onChange={(e) => set({ onDelete: e.currentTarget.value as OnDelete })}
            >
              <option value="restrict">Refuse the delete (RESTRICT)</option>
              <option value="cascade">Delete this record too (CASCADE)</option>
              <option value="set_null">Empty this field (SET NULL)</option>
            </Select>
          </Field>
        </>
      )}
      {field.type === 'text' && (
        <>
          <Field
            label="Choices"
            id={`${prefix}-choices`}
            hint="Comma-separated. The database will accept only these values."
          >
            <Input
              id={`${prefix}-choices`}
              value={(field.choices ?? []).join(', ')}
              onInput={(e) => {
                const list = e.currentTarget.value
                  .split(',')
                  .map((v) => v.trim())
                  .filter(Boolean)
                set({ choices: list.length ? list : undefined })
              }}
              placeholder="draft, review, published"
            />
          </Field>
          <Field label="Maximum length" id={`${prefix}-max`}>
            <Input
              id={`${prefix}-max`}
              mono
              inputMode="numeric"
              value={field.maxLength?.toString() ?? ''}
              onInput={(e) =>
                set({
                  maxLength: e.currentTarget.value ? Number(e.currentTarget.value) : undefined,
                })
              }
            />
          </Field>
        </>
      )}
      {numeric && (
        <>
          <Field label="Minimum" id={`${prefix}-min`}>
            <Input
              id={`${prefix}-min`}
              mono
              inputMode="decimal"
              value={field.min?.toString() ?? ''}
              onInput={(e) =>
                set({
                  min: e.currentTarget.value === '' ? undefined : Number(e.currentTarget.value),
                })
              }
            />
          </Field>
          <Field label="Maximum" id={`${prefix}-maxv`}>
            <Input
              id={`${prefix}-maxv`}
              mono
              inputMode="decimal"
              value={field.max?.toString() ?? ''}
              onInput={(e) =>
                set({
                  max: e.currentTarget.value === '' ? undefined : Number(e.currentTarget.value),
                })
              }
            />
          </Field>
        </>
      )}
      <div class="field field-wide checks">
        <Checkbox
          checked={field.required}
          onChange={(required) => set({ required })}
          label="Required"
          hint="NOT NULL"
        />
        <Checkbox
          checked={field.unique}
          onChange={(unique) => set({ unique })}
          label="Unique"
          hint="UNIQUE"
        />
        <Checkbox
          checked={field.indexed}
          disabled={field.unique}
          onChange={(indexed) => set({ indexed })}
          label="Indexed"
          hint="CREATE INDEX"
        />
      </div>
      <Field
        label="Note"
        id={`${prefix}-note`}
        wide
        hint="Saved as the column's comment: psql and every client show it."
      >
        <Input
          id={`${prefix}-note`}
          value={field.note}
          onInput={(e) => set({ note: e.currentTarget.value })}
        />
      </Field>
    </div>
  )
}

/** Statements for a draft, or the reason they cannot be written yet. */
function usePreview(
  make: () => Promise<string[]>,
  deps: unknown[]
): { statements: string[]; error: string | null } {
  const [state, setState] = useState<{ statements: string[]; error: string | null }>({
    statements: [],
    error: null,
  })
  useEffect(() => {
    let live = true
    make()
      .then((statements) => live && setState({ statements, error: null }))
      .catch(
        (error) =>
          live &&
          setState({
            statements: [],
            error: error instanceof Error ? error.message : String(error),
          })
      )
    return () => {
      live = false
    }
  }, deps)
  return state
}

export function ModelHome() {
  const { catalog, presentations } = useSession()
  const ws = useWorkspace()
  const schema = catalog.schemas.find((s) => s.name === ws)
  const shown = presentationOf(presentations, ws)
  const tables = tablesIn(catalog, ws)
  return (
    <Page
      title="Data model"
      icon={<ModelIcon size={22} />}
      crumbs={[{ label: shown.displayName ?? ws }]}
      subtitle={schema ? `Collections are tables in ${ws}; fields are their columns.` : undefined}
      actions={
        schema?.can_create ? (
          <Action
            label="New collection"
            icon={<PlusIcon size={22} />}
            href={href('/model/new', { ws })}
          />
        ) : undefined
      }
    >
      {tables.length ? (
        <div class="grid-wrap">
          <table class="grid">
            <thead>
              <tr>
                <th>Collection</th>
                <th>Fields</th>
                <th>Relations</th>
                <th>Owner</th>
                <th>Row security</th>
                <th>Your rights</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {tables.map((t) => {
                const columns = columnsOf(catalog, ws, t.name)
                const relations = catalog.relations.filter(
                  (r) => r.schema === ws && r.table === t.name
                )
                return (
                  <tr key={t.name}>
                    <td>
                      <a
                        class="grid-open strong"
                        href={href('/model/collection', { ws, c: t.name })}
                      >
                        <CollectionIcon size={16} aria-hidden="true" /> {t.name}
                      </a>
                    </td>
                    <td class="is-number mono">
                      {columns.filter((c) => !systemColumns.includes(c.name)).length}
                    </td>
                    <td class="cell-muted">
                      {relations.map((r) => r.target_table).join(', ') || '—'}
                    </td>
                    <td class="mono">{t.owner}</td>
                    <td>{t.rls ? <Badge tone="primary">On</Badge> : <Badge>Off</Badge>}</td>
                    <td>
                      <Rights table={t} columns={columns} compact />
                    </td>
                    <td class="cell-muted">
                      <span class="clip clip-narrow" title={t.comment ?? undefined}>
                        {t.comment}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty icon={<CollectionIcon size={28} />} title="No collection here yet">
          {schema?.can_create
            ? 'Start the model with a first collection.'
            : 'You may not create collections in this workspace.'}
        </Empty>
      )}
    </Page>
  )
}

export function CollectionModel() {
  const { catalog, presentations } = useSession()
  const location = useLocation()
  const ws = useWorkspace()
  const table = location.query.c ?? ''
  const tab = location.query.tab ?? 'fields'
  const info = tableOf(catalog, ws, table)
  const shown = presentationOf(presentations, ws, table)
  const workspace = presentationOf(presentations, ws)
  const CollectionGlyph = iconFor(shown.icon) ?? CollectionIcon
  const runner = useRunner()
  const [adding, setAdding] = useState<FieldDraft | null>(null)
  const [dropping, setDropping] = useState<string | null>(null)
  const [described, setDescribed] = useState<string | null>(null)
  const [accessOf, setAccessOf] = useState<string | null>(null)
  // What each field says of itself: its name, where it appears and how it is drawn. It is
  // read again whenever the catalog is, since a statement that ran may have changed it.
  const about = useLoad(info ? (db) => fieldMetadata(db, ws, table) : null, [ws, table, catalog])
  const fields = useMemo(
    () => resolveFields(catalog, ws, table, about.data),
    [catalog, ws, table, about.data]
  )
  // The fields that say nothing yet: every field carries its own views, and these do not.
  const missing = about.data ? fields.filter((field) => !field.hasViews) : []
  const [deleting, setDeleting] = useState(false)
  const [confirmName, setConfirmName] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const owner = Boolean(info?.can_alter)
  const others = tablesIn(catalog, ws).map((t) => t.name)
  const addPreview = usePreview(
    async () => (adding ? fieldStatements(ws, table, adding) : []),
    [JSON.stringify(adding)]
  )
  if (!info)
    return (
      <Page title={table || 'Collection'} icon={<CollectionIcon size={22} />}>
        <Notice tone="warning" title={`The database shows you no collection named ${ws}.${table}`} />
      </Page>
    )
  const constraintsOf = (column: string) =>
    catalog.constraints.filter(
      (c) => c.schema === ws && c.table === table && c.type !== 'p' && c.columns.includes(column)
    )
  /** A constraint as a person reads it; the definition stays in the tooltip. */
  const describeConstraint = (column: string, k: { type: string; definition: string }) => {
    if (k.type === 'u') return 'unique'
    if (k.type === 'f') return 'relation'
    const choices = choicesOf(catalog, ws, table, column)
    if (choices && k.definition.includes('ANY')) return `one of ${choices.join(', ')}`
    const length = k.definition.match(/char_length\(.*\) <= (\d+)/)
    if (length) return `at most ${length[1]} characters`
    const bound = k.definition.match(/ (>=|<=|>|<) \(?'?(-?[\d.]+)/)
    if (bound) {
      const words = { '>=': 'at least', '<=': 'at most', '>': 'more than', '<': 'less than' }
      return `${words[bound[1] as keyof typeof words]} ${bound[2]}`
    }
    return k.definition.replace(/^CHECK /, '')
  }
  const tabLink = (id: string, label: string) => (
    <a
      href={href('/model/collection', { ws, c: table, tab: id === 'fields' ? undefined : id })}
      class={clsx('tab', tab === id && 'is-active')}
      aria-current={tab === id ? 'page' : undefined}
    >
      {label}
    </a>
  )
  return (
    <Page
      title={shown.displayName ?? table}
      icon={<CollectionGlyph size={22} />}
      presentation={shown}
      crumbs={[
        { label: 'Data model', href: href('/model', { ws }) },
        { label: workspace.displayName ?? ws },
      ]}
      subtitle={
        owner
          ? `You own ${ws}.${table}: its model and its access are yours.`
          : `Owned by ${info.owner}. You may read its model; the database gives changes to the owner.`
      }
      actions={
        <>
          {owner && info.kind !== 'v' && (
            <Action
              tone="danger"
              label="Delete collection"
              icon={<TrashIcon size={20} />}
              onClick={() => setDeleting(true)}
            />
          )}
          {owner && info.kind !== 'v' && tab === 'fields' && (
            <Action
              label="Add field"
              icon={<PlusIcon size={22} />}
              onClick={() => setAdding(emptyField())}
            />
          )}
        </>
      }
      toolbar={
        <nav class="tabs" aria-label="Collection settings">
          {tabLink('fields', 'Fields')}
          {tabLink('about', 'About')}
          {tabLink('access', 'Access')}
          <a href={href('/content/records', { ws, c: table })} class="tab tab-end">
            Open records <ChevronRightIcon size={16} aria-hidden="true" />
          </a>
        </nav>
      }
    >
      {runner.problem && (
        <Notice tone="danger" title={runner.problem.title}>
          {runner.problem.detail}
        </Notice>
      )}
      {tab === 'about' ? (
        <>
          <section class="panel">
            <header class="panel-head">
              <div>
                <h2>Note</h2>
                <p>
                  The table's comment: psql and every client show it, to every connected user. Who
                  reaches the collection, its fields and its rows is under{' '}
                  <a href={href('/model/collection', { ws, c: table, tab: 'access' })}>Access</a>.
                </p>
              </div>
            </header>
            <div class="form">
              <Field label="Note" id="table-note" wide>
                <TextArea
                  id="table-note"
                  rows={2}
                  disabled={!owner}
                  value={note ?? info.comment ?? ''}
                  onInput={(e) => setNote(e.currentTarget.value)}
                />
              </Field>
              {owner && note !== null && note !== (info.comment ?? '') && (
                <div class="field field-wide">
                  <Statement sql={commentStatement(ws, table, note)} />
                  <div class="row-actions">
                    <Button
                      tone="primary"
                      busy={runner.busy}
                      onClick={async () => {
                        if (
                          await runner.runStatements(
                            [commentStatement(ws, table, note)],
                            'Note saved'
                          )
                        )
                          setNote(null)
                      }}
                    >
                      Save note
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </section>
          <KeyEditorPanels target={collectionTarget(ws, table)} owner={owner} />
          <MetadataPanel target={collectionTarget(ws, table)} owner={owner} />
        </>
      ) : tab === 'access' ? (
        <CollectionAccess table={info} />
      ) : (
        <>
          {owner && about.data && missing.length > 0 && (
            <div class="row-actions row-start">
              <Button
                icon={<TagIcon size={16} />}
                busy={runner.busy}
                onClick={() =>
                  runner.runStatements(
                    [fieldsViewsStatement(missing.map((c) => fieldTarget(ws, table, c.name)))],
                    'Every field carries its own views'
                  )
                }
              >
                Give every field its own views
              </Button>
            </div>
          )}
          <div class="grid-wrap">
            <table class="grid">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Type</th>
                  <th>Views</th>
                  <th>Drawn as</th>
                  <th>Required</th>
                  <th>Default</th>
                  <th>Constraints</th>
                  <th>You lack</th>
                  <th>Note</th>
                  <th class="grid-actions">
                    <span class="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {fields.map((field) => {
                  const { column: c, relation, system, views } = field
                  return (
                    <tr key={c.name} class={clsx(system && 'is-system')}>
                      <td>
                        <span class="mono strong">{c.name}</span>
                        {field.named && <span class="field-alias">{field.label}</span>}
                        {system && <Badge tone="outline">system</Badge>}
                      </td>
                      <td class="mono">
                        {relation ? (
                          <span>
                            <RelationIcon size={13} aria-hidden="true" /> {relation.target_table}
                          </span>
                        ) : (
                          <span>
                            {shortType(c.type)}
                            {c.generated && <Badge tone="outline">generated</Badge>}
                            {c.identity && <Badge tone="outline">identity</Badge>}
                          </span>
                        )}
                      </td>
                      <td>
                        <span class="field-views">
                          {situations.map((situation) => (
                            <span
                              key={situation}
                              class={clsx('view-mark', views[situation] === 'hide' && 'is-off')}
                              title={
                                views[situation] === 'hide'
                                  ? `Hidden from ${situationLabels[situation]}`
                                  : `Shown in ${situationLabels[situation]}`
                              }
                            >
                              {situation}
                            </span>
                          ))}
                          {Object.entries(customViews(views)).map(([name, mode]) => (
                            <span
                              key={name}
                              class={clsx('view-mark', mode === 'hide' && 'is-off')}
                              title={mode === 'hide' ? `Hidden from ${name}` : `Shown in ${name}`}
                            >
                              {name}
                            </span>
                          ))}
                        </span>
                      </td>
                      <td>
                        {(() => {
                          const drawn = situations
                            .map((situation) => {
                              const choice = field.renderers[situation]
                              if (!choice) return null
                              const renderer = rendererNamed(choice.renderer)
                              return (
                                <span key={situation} class="view-mark" title={renderer?.label}>
                                  {situation}: {choice.renderer}
                                </span>
                              )
                            })
                            .filter(Boolean)
                          if (!drawn.length)
                            return <span class="cell-muted">as the platform draws it</span>
                          return <span class="field-views">{drawn}</span>
                        })()}
                      </td>
                      <td>{c.required ? 'yes' : ''}</td>
                      <td class="mono cell-muted">
                        <span class="clip clip-narrow" title={c.default ?? undefined}>
                          {c.default}
                        </span>
                      </td>
                      <td>
                        {constraintsOf(c.name).map((k) => (
                          <code key={k.name} class="constraint" title={k.definition}>
                            {describeConstraint(c.name, k)}
                          </code>
                        ))}
                      </td>
                      <td>
                        {(() => {
                          // Only what the reader lacks on this field is worth a word.
                          const missing = [
                            !c.can_select && 'SELECT',
                            !c.can_insert && 'INSERT',
                            !c.can_update && 'UPDATE',
                          ].filter(Boolean)
                          return missing.length ? (
                            <span class="col-missing mono">no {missing.join(', ')}</span>
                          ) : (
                            <span class="cell-muted">nothing</span>
                          )
                        })()}
                      </td>
                      <td class="cell-muted">
                        <span class="clip clip-narrow" title={c.comment ?? undefined}>
                          {c.comment}
                        </span>
                      </td>
                      <td class="grid-actions">
                        <button
                          type="button"
                          class="icon-button"
                          aria-label={`Metadata of ${c.name}`}
                          title="Metadata"
                          onClick={() => setDescribed(c.name)}
                        >
                          <TagIcon size={16} />
                        </button>
                        <button
                          type="button"
                          class="icon-button"
                          aria-label={`Access to ${c.name}`}
                          title="Who holds this field"
                          onClick={() => setAccessOf(c.name)}
                        >
                          <KeyIcon size={16} />
                        </button>
                        {owner && !system && info.kind !== 'v' && (
                          <button
                            type="button"
                            class="icon-button"
                            aria-label={`Drop ${c.name}`}
                            title="Drop field"
                            onClick={() => setDropping(c.name)}
                          >
                            <TrashIcon size={16} />
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {!owner && (
              <p class="grid-note">
                <LockIcon size={14} aria-hidden="true" /> The database gives ALTER TABLE to the owner,{' '}
                {info.owner}, and its members.
              </p>
            )}
          </div>
        </>
      )}
      <FieldMetadataDrawer
        schema={ws}
        table={table}
        column={described ?? ''}
        owner={owner}
        open={described !== null}
        onClose={() => setDescribed(null)}
      />
      <FieldAccess schema={ws} table={table} column={accessOf} onClose={() => setAccessOf(null)} />
      <Drawer
        open={adding !== null}
        onClose={() => setAdding(null)}
        title={`Add a field to ${table}`}
        subtitle="The field is a new column, with the constraints you choose."
        wide
        footer={
          <>
            <Button onClick={() => setAdding(null)}>Cancel</Button>
            <Button
              tone="primary"
              busy={runner.busy}
              disabled={!adding?.name || !!addPreview.error}
              onClick={async () => {
                if (await runner.runStatements(addPreview.statements, `Added ${adding?.name}`))
                  setAdding(null)
              }}
            >
              Add field
            </Button>
          </>
        }
      >
        {runner.problem && (
          <Notice tone="danger" title={runner.problem.title}>
            {runner.problem.detail}
          </Notice>
        )}
        {adding && (
          <FieldEditor field={adding} onChange={setAdding} collections={others} prefix="add" />
        )}
        {adding?.name &&
          (addPreview.error ? (
            <Notice tone="warning" title={addPreview.error} />
          ) : (
            <Statement
              sql={addPreview.statements.join('\n')}
              label="Runs as you, in one transaction"
            />
          ))}
      </Drawer>
      <Confirm
        open={dropping !== null}
        title={`Drop ${dropping}?`}
        confirm="Drop field"
        busy={runner.busy}
        onClose={() => setDropping(null)}
        onConfirm={async () => {
          if (
            dropping &&
            (await runner.runStatements(
              [dropFieldStatement(ws, table, dropping)],
              `Dropped ${dropping}`
            ))
          )
            setDropping(null)
        }}
      >
        <p>Every value it holds goes with it. Revisions already recorded keep their copy.</p>
        {dropping && <Statement sql={dropFieldStatement(ws, table, dropping)} />}
      </Confirm>
      <Confirm
        open={deleting}
        title={`Delete ${table}?`}
        confirm="Delete collection"
        busy={runner.busy}
        onClose={() => {
          setDeleting(false)
          setConfirmName('')
        }}
        onConfirm={async () => {
          if (confirmName !== table) return
          if (await runner.runStatements([dropCollectionStatement(ws, table)], `Deleted ${table}`))
            location.route(href('/model', { ws }))
        }}
      >
        <p>Every record goes with it. Type the collection's name to confirm.</p>
        <Input
          value={confirmName}
          onInput={(e) => setConfirmName(e.currentTarget.value)}
          mono
          aria-label="Collection name"
        />
        <Statement sql={dropCollectionStatement(ws, table)} />
      </Confirm>
    </Page>
  )
}

export function NewCollection() {
  const { catalog, presentations } = useSession()
  const location = useLocation()
  const ws = useWorkspace()
  const schema = catalog.schemas.find((s) => s.name === ws)
  const shown = presentationOf(presentations, ws)
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [fields, setFields] = useState<FieldDraft[]>([
    { ...emptyField(), name: 'title', required: true },
  ])
  const runner = useRunner()
  const preview = usePreview(
    async () =>
      name
        ? collectionStatements(
            ws,
            name,
            note,
            fields.filter((f) => f.name)
          )
        : [],
    [ws, name, note, JSON.stringify(fields)]
  )
  const others = [...tablesIn(catalog, ws).map((t) => t.name), ...(name ? [name] : [])]
  return (
    <Page
      title="New collection"
      icon={<CollectionIcon size={22} />}
      crumbs={[
        { label: 'Data model', href: href('/model', { ws }) },
        { label: shown.displayName ?? ws },
      ]}
      subtitle="A table made by platform.create_collection: id, timestamps, who changed it, a version, revisions and row security on."
      actions={
        <Action
          label="Create collection"
          icon={<PlusIcon size={22} />}
          busy={runner.busy}
          disabled={!name || !!preview.error || !schema?.can_create}
          onClick={async () => {
            if (await runner.runStatements(preview.statements, `Created ${name}`))
              location.route(href('/model/collection', { ws, c: name }))
          }}
        />
      }
    >
      {!schema?.can_create && (
        <Notice tone="warning" title={`The database gives you no CREATE on ${ws}`}>
          Ask its owner, {schema?.owner}, for it.
        </Notice>
      )}
      {runner.problem && (
        <Notice tone="danger" title={runner.problem.title}>
          {runner.problem.detail}
        </Notice>
      )}
      <section class="panel">
        <div class="form">
          <Field label="Name" id="new-name" required hint="The table's name in this workspace.">
            <Input
              id="new-name"
              mono
              value={name}
              onInput={(e) => setName(e.currentTarget.value)}
              placeholder="articles"
            />
          </Field>
          <Field label="Note" id="new-note">
            <Input
              id="new-note"
              value={note}
              onInput={(e) => setNote(e.currentTarget.value)}
              placeholder="What a record of it is"
            />
          </Field>
        </div>
      </section>
      {fields.map((field, index) => (
        <section key={index} class="panel">
          <header class="panel-head">
            <div>
              <h2>{field.name || `Field ${index + 1}`}</h2>
              <p>{typeLabel(field.type)}</p>
            </div>
            <Button
              tone="ghost"
              icon={<TrashIcon size={16} />}
              onClick={() => setFields(fields.filter((_, i) => i !== index))}
            >
              Remove
            </Button>
          </header>
          <FieldEditor
            field={field}
            prefix={`f${index}`}
            collections={others}
            onChange={(next) => setFields(fields.map((f, i) => (i === index ? next : f)))}
          />
        </section>
      ))}
      <div class="row-actions row-start">
        <Button icon={<PlusIcon size={16} />} onClick={() => setFields([...fields, emptyField()])}>
          Add another field
        </Button>
      </div>
      {name &&
        (preview.error ? (
          <Notice tone="warning" title={preview.error} />
        ) : (
          <Statement
            sql={preview.statements.join('\n')}
            label="Creating runs these as you, in one transaction"
          />
        ))}
    </Page>
  )
}
