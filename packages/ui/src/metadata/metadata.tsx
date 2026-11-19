import { useId, useState } from 'preact/hooks'
import clsx from 'clsx'
import { fieldTarget, metadata, metadataStatements, removeMetadata, setMetadata } from './query.ts'
import type { MetadataChange, MetadataTarget } from './query.ts'
import type { MetadataEntry } from './types.ts'
import { ago, display } from '../format.ts'
import { describe, useLoad, useSession } from '../session.tsx'
import { columnOf } from '../catalog/catalog.ts'
import { familyOf, palette, parseColor, reservedFamilies, studioFamilies } from './color.ts'
import type { Family } from './color.ts'
import {
  type FieldViews,
  type Mode,
  customModes,
  customViews,
  isCustomView,
  modeLabels,
  parseViews,
  validViewName,
  viewsEqual,
  viewsKey,
  viewsValue,
} from './views.ts'
import {
  colorKey,
  displayNameKey,
  displayNameLimit,
  iconKey,
  presentationKeys,
  presentationOf,
} from './presentation.ts'
import { Empty, Loading, Notice, Statement } from '../ui/bits.tsx'
import { Avatar } from '../ui/avatar.tsx'
import { Button } from '../ui/button.tsx'
import { Field, Input, Select, TextArea } from '../ui/form.tsx'
import {
  CollectionIcon,
  EditIcon,
  InfoIcon,
  itemIcons,
  PlusIcon,
  TrashIcon,
  WorkspaceIcon,
} from '../ui/icons.tsx'
import { Drawer } from '../ui/overlay.tsx'
import { useRunner } from '../access/runner.tsx'

/** A value as the editor shows it: a string as itself, anything else as JSON. */
const asText = (value: unknown) =>
  typeof value === 'string' ? value : JSON.stringify(value, null, 2)

function parse(text: string): unknown {
  const trimmed = text.trim()
  if (/^[[{"]|^(true|false|null|-?\d+(\.\d+)?)$/.test(trimmed)) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return text
    }
  }
  return text
}

/** The key being edited, and the value it holds. */
interface Editing {
  key: string
  text: string
  version?: number
  isNew: boolean
}

/** What an item is called in the interface's own words. */
const nameOf = (target: MetadataTarget): string =>
  target.scope === 'workspace'
    ? 'workspace'
    : target.scope === 'collection'
      ? 'collection'
      : 'field'

/** One colour of the palette, chosen by name: the family the mark is drawn as. */
function Swatch({
  family,
  name,
  chosen,
  owner,
  onChoose,
}: {
  family: Family
  name: string
  chosen: boolean
  owner: boolean
  onChoose: (value: string) => void
}) {
  return (
    <label
      class={clsx('swatch', `swatch-${family.name}`, chosen && 'is-chosen')}
      title={family.name}
    >
      <input
        type="radio"
        name={name}
        value={family.name}
        checked={chosen}
        disabled={!owner}
        onChange={() => onChoose(family.name)}
      />
    </label>
  )
}

/**
 * How an item presents itself: the name people read, the icon they recognise and the colour
 * that marks it. Three reserved keys of the item's own metadata, so PostgreSQL's row security
 * decides who reads them and who changes them, as it does for every other key. A field is
 * presented by its name alone: a column is a label, not a mark.
 */
export function PresentationEditor({ target, owner }: { target: MetadataTarget; owner: boolean }) {
  const { presentations } = useSession()
  const stored = presentationOf(presentations, target.schema, target.table, target.column)
  const [name, setName] = useState(stored.displayName ?? '')
  const [icon, setIcon] = useState(stored.icon ?? '')
  const [colour, setColour] = useState(stored.color ?? '')
  const [seen, setSeen] = useState(stored)
  const runner = useRunner()
  const group = useId()
  const iconName = `${group}-icon`
  const colourName = `${group}-colour`
  const item = nameOf(target)
  const Fallback = target.scope === 'workspace' ? WorkspaceIcon : CollectionIcon
  const marked = target.scope !== 'field'

  // What PostgreSQL holds is the truth: when it changes, the draft follows it.
  if (
    seen.displayName !== stored.displayName ||
    seen.icon !== stored.icon ||
    seen.color !== stored.color
  ) {
    setSeen(stored)
    setName(stored.displayName ?? '')
    setIcon(stored.icon ?? '')
    setColour(stored.color ?? '')
  }

  const changes: MetadataChange[] = []
  if (name.trim() !== (stored.displayName ?? ''))
    changes.push({ key: displayNameKey, value: name.trim() || null })
  if (marked && (icon || null) !== stored.icon) changes.push({ key: iconKey, value: icon || null })
  if (marked && (colour || null) !== stored.color)
    changes.push({ key: colorKey, value: colour || null })
  const statements = metadataStatements(target, changes)
  const chosen = familyOf(colour)
  const invalid = colour.trim() !== '' && !chosen && !parseColor(colour)

  return (
    <div class="presentation">
      <div class="presentation-preview">
        {marked && (
          <Avatar
            presentation={{ displayName: name.trim() || null, icon: icon || null, color: colour }}
            fallback={Fallback}
            class="avatar-preview"
            size={24}
          />
        )}
        <div>
          <strong>{name.trim() || (target.column ?? target.table ?? target.schema)}</strong>
          <small class="mono note">
            {target.column
              ? `${target.schema}.${target.table}.${target.column}`
              : target.table
                ? `${target.schema}.${target.table}`
                : target.schema}
            {name.trim() ? '' : ' · the name in SQL'}
          </small>
        </div>
      </div>
      <div class="form">
        <Field
          label="Display name"
          id={`${group}-name`}
          hint={`The name people read. The ${item} keeps its own name in SQL.`}
          error={name.length > displayNameLimit ? `${displayNameLimit} characters at most.` : null}
        >
          <Input
            id={`${group}-name`}
            value={name}
            disabled={!owner}
            maxLength={displayNameLimit + 20}
            onInput={(e) => setName(e.currentTarget.value)}
            placeholder={target.column ? 'Headline' : target.table ? 'Articles' : 'Newsroom'}
          />
        </Field>
        {marked && (
          <>
            <fieldset class="field field-wide types">
              <legend class="field-label">Icon</legend>
              <div class="icon-grid">
                <label
                  class={clsx('icon-choice', !icon && 'is-chosen')}
                  title="The platform's own icon"
                >
                  <input
                    type="radio"
                    name={iconName}
                    value=""
                    checked={!icon}
                    disabled={!owner}
                    onChange={() => setIcon('')}
                  />
                  <Fallback size={18} />
                </label>
                {Object.keys(itemIcons).map((choice) => {
                  const Icon = itemIcons[choice]!
                  return (
                    <label
                      key={choice}
                      class={clsx('icon-choice', icon === choice && 'is-chosen')}
                      title={choice}
                    >
                      <input
                        type="radio"
                        name={iconName}
                        value={choice}
                        checked={icon === choice}
                        disabled={!owner}
                        onChange={() => setIcon(choice)}
                      />
                      <Icon size={18} />
                    </label>
                  )
                })}
              </div>
              <p class="field-hint">
                The mark drawn beside the name. Without one, the platform's own.
              </p>
            </fieldset>
            <fieldset class="field field-wide types">
              <legend class="field-label">Primary colour</legend>
              <div class="colour-row">
                <div class="swatches">
                  <label
                    class={clsx('swatch', 'swatch-none', !chosen && 'is-chosen')}
                    title="No colour"
                  >
                    <input
                      type="radio"
                      name={colourName}
                      value=""
                      checked={!chosen}
                      disabled={!owner}
                      onChange={() => setColour('')}
                    />
                  </label>
                  {reservedFamilies.map((family) => (
                    <Swatch
                      key={family.name}
                      family={family}
                      name={colourName}
                      chosen={chosen?.name === family.name}
                      owner={owner}
                      onChoose={setColour}
                    />
                  ))}
                  <span class="swatch-gap" aria-hidden="true" />
                  {studioFamilies.map((name) => {
                    const family = palette.find((one) => one.name === name)!
                    return (
                      <Swatch
                        key={family.name}
                        family={family}
                        name={colourName}
                        chosen={chosen?.name === family.name}
                        owner={owner}
                        onChoose={setColour}
                      />
                    )
                  })}
                </div>
                <Input
                  class="mono colour-input"
                  value={colour}
                  disabled={!owner}
                  maxLength={7}
                  spellcheck={false}
                  aria-label="Colour"
                  onInput={(e) => setColour(e.currentTarget.value)}
                  placeholder="steel"
                />
              </div>
              {invalid ? (
                <p class="field-error">
                  A colour is a family of the palette &mdash; steel, cyan, bronze &mdash; or a
                  colour of your own, written as #rrggbb.
                </p>
              ) : (
                <p class="field-hint">
                  The colour of the mark. The studio draws its own palette: a colour of your own is
                  drawn as the family nearest to it, with the ink that reads on it.
                </p>
              )}
            </fieldset>
          </>
        )}
      </div>
      {owner && (
        <>
          {statements.length > 0 && (
            <Statement sql={statements.join('\n')} label="Runs as you, in one transaction" />
          )}
          <div class="row-actions">
            <Button
              tone="primary"
              busy={runner.busy}
              disabled={!statements.length || invalid}
              onClick={() => runner.runStatements(statements, 'Presentation saved')}
            >
              Save presentation
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

/** The presentation of a workspace or a collection, as a panel of its own. */
export function PresentationPanel({ target, owner }: { target: MetadataTarget; owner: boolean }) {
  const item = nameOf(target)
  return (
    <section class="panel">
      <header class="panel-head">
        <div>
          <h2>Presentation</h2>
          <p>
            How this {item} is named and marked. It is three keys of its metadata, so PostgreSQL
            keeps its rules: {owner ? 'you own it, so you may change it' : 'only its owner may'}.
          </p>
        </div>
      </header>
      <PresentationEditor target={target} owner={owner} />
    </section>
  )
}

/**
 * Where a field appears: in the records grid, in the record form, in the filter builder, and
 * in any view of the owner's own. A field may be shown, hidden, or — in the form — shown and
 * locked. The saying is the field's own metadata, under the reserved key `views`, so
 * PostgreSQL keeps its rules: whoever holds a right on the column reads it, and only the
 * owner of the collection changes it.
 *
 * Every field carries its own saying: the platform writes one when it makes a field, so
 * where a field appears is said of the field and not left to be inferred.
 *
 * The saying narrows the interface and grants nothing: a field that is hidden is still
 * PostgreSQL's to read and to write, and the reader may still reach it in psql.
 */
export function ViewsEditor({
  target,
  owner,
  entries,
}: {
  target: MetadataTarget
  owner: boolean
  /** The field's own metadata, as its owner and its readers may see it. */
  entries: MetadataEntry[]
}) {
  const { catalog } = useSession()
  const runner = useRunner()
  const group = useId()
  const stored = parseViews(entries.find((one) => one.key === viewsKey)?.value)
  const [views, setViews] = useState<FieldViews>(stored)
  const [seen, setSeen] = useState(stored)
  const [named, setNamed] = useState('')
  // What PostgreSQL holds is the truth: when it changes, the draft follows it.
  if (!viewsEqual(seen, stored)) {
    setSeen(stored)
    setViews(stored)
  }
  const column = columnOf(catalog, target.schema, target.table ?? '', target.column ?? '')
  const computed = Boolean(column?.generated || column?.identity)
  const changes: MetadataChange[] = []
  if (!viewsEqual(views, stored)) changes.push({ key: viewsKey, value: viewsValue(views) })
  const statements = metadataStatements(target, changes)
  const choice = (
    label: string,
    hint: string,
    situation: 'list' | 'record' | 'filter',
    modes: Mode[]
  ) => (
    <Field label={label} id={`${group}-${situation}`} hint={hint}>
      <Select
        id={`${group}-${situation}`}
        value={views[situation]}
        disabled={!owner}
        onChange={(e) => setViews({ ...views, [situation]: e.currentTarget.value as Mode })}
      >
        {modes.map((mode) => (
          <option key={mode} value={mode}>
            {modeLabels[mode]}
          </option>
        ))}
      </Select>
    </Field>
  )
  const custom = customViews(views)
  // A view of the owner's own may not take the name of one the interface draws.
  const addable = (name: string): boolean =>
    validViewName(name) && isCustomView(name) && !custom[name]
  const addCustom = () => {
    const name = named.trim()
    if (!addable(name)) return
    setViews({ ...views, [name]: 'show' })
    setNamed('')
  }
  return (
    <div class="views">
      {choice('In the list', 'The field’s column in the records grid.', 'list', ['show', 'hide'])}
      {choice(
        'In the record',
        'The field in the record form: an input, a locked value, or nothing.',
        'record',
        ['show', 'readonly', 'hide']
      )}
      {choice('In filters', 'The field in the filter builder.', 'filter', ['show', 'hide'])}
      {Object.keys(custom).length > 0 && (
        <fieldset class="field field-wide">
          <legend class="field-label">Other views</legend>
          {Object.entries(custom).map(([name, mode]) => (
            <Field
              key={name}
              label={name}
              id={`${group}-${name}`}
              hint="A view of your own."
              aside={
                owner ? (
                  <Button
                    tone="ghost"
                    icon={<TrashIcon size={16} />}
                    onClick={() => {
                      const { [name]: _gone, ...rest } = views
                      setViews(rest as FieldViews)
                    }}
                  >
                    Remove
                  </Button>
                ) : undefined
              }
            >
              <Select
                id={`${group}-${name}`}
                value={mode}
                disabled={!owner}
                onChange={(e) => setViews({ ...views, [name]: e.currentTarget.value as Mode })}
              >
                {customModes.map((one) => (
                  <option key={one} value={one}>
                    {modeLabels[one]}
                  </option>
                ))}
              </Select>
            </Field>
          ))}
        </fieldset>
      )}
      {owner && (
        <Field
          label="Name a view of your own"
          id={`${group}-custom`}
          hint="Letters, digits, underscores and dashes. The field's saying keeps it."
        >
          <Input
            id={`${group}-custom`}
            mono
            value={named}
            onInput={(e) => setNamed(e.currentTarget.value)}
            placeholder="export"
          />
          <div class="row-actions">
            <Button
              tone="ghost"
              icon={<PlusIcon size={16} />}
              disabled={!addable(named.trim())}
              onClick={addCustom}
            >
              Add
            </Button>
          </div>
        </Field>
      )}
      {computed && (
        <Notice tone="info" title="PostgreSQL computes this column">
          A generated or an identity column is written by the database itself, so the record shows
          it and never offers it as an input.
        </Notice>
      )}
      {column?.required && views.record === 'hide' && (
        <Notice tone="warning" title="A required field out of the record">
          PostgreSQL refuses a record that does not set {target.column}, and the form no longer
          offers it.
        </Notice>
      )}
      {owner && (
        <>
          {statements.length > 0 && (
            <Statement sql={statements.join('\n')} label="Runs as you, in one transaction" />
          )}
          <div class="row-actions">
            <Button
              tone="primary"
              busy={runner.busy}
              disabled={!statements.length}
              onClick={() => runner.runStatements(statements, 'Views saved')}
            >
              Save views
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * The metadata of an item: what it is, as opposed to what it holds. Row security decides who
 * reads it and who changes it: the owner of the item.
 */
export function MetadataPanel({ target, owner }: { target: MetadataTarget; owner: boolean }) {
  const item = nameOf(target)
  const [editing, setEditing] = useState<Editing | null>(null)
  return (
    <section class="panel">
      <header class="panel-head">
        <div>
          <h2>Metadata</h2>
          <p>
            What this {item} is, kept beside it in <span class="mono">platform.item_metadata</span>.{' '}
            {owner ? 'You own it, so you may change it.' : 'Only its owner may change it.'}
          </p>
        </div>
        {owner && (
          <Button
            icon={<PlusIcon size={16} />}
            onClick={() => setEditing({ key: '', text: '', isNew: true })}
          >
            Add key
          </Button>
        )}
      </header>
      <MetadataKeys target={target} owner={owner} onEdit={setEditing} />
      <KeyDrawer
        editing={editing}
        target={target}
        onClose={() => setEditing(null)}
        onSaved={() => setEditing(null)}
      />
    </section>
  )
}

/** The keys an item carries, and the buttons that change them. */
function MetadataKeys({
  target,
  owner,
  onEdit,
  entries,
  onChanged,
}: {
  target: MetadataTarget
  owner: boolean
  onEdit: (editing: Editing) => void
  /** The keys already read; without them the component reads them itself. */
  entries?: MetadataEntry[]
  /** Told when a key was removed, so the reader may read the keys again. */
  onChanged?: () => void
}) {
  const { withDb, notify } = useSession()
  const found = useLoad(entries ? null : (db) => metadata(db, target), [
    target.scope,
    target.schema,
    target.table,
    target.column,
  ])
  const rows = entries ?? found.data
  const remove = async (entry: MetadataEntry) => {
    try {
      const affected = await withDb((db) => removeMetadata(db, target, entry.key))
      notify(
        affected
          ? { tone: 'success', title: `Removed ${entry.key}` }
          : {
              tone: 'error',
              title: 'PostgreSQL removed nothing',
              detail: 'Only the owner may change this metadata.',
            }
      )
      if (onChanged) onChanged()
      else found.reload()
    } catch (error) {
      notify({ tone: 'error', ...describe(error) })
    }
  }
  // The presentation has a panel of its own, and a field's saying about where it appears has
  // an editor of its own; the rest of the metadata is listed here.
  const others = (rows ?? []).filter(
    (entry) =>
      !(presentationKeys as readonly string[]).includes(entry.key) &&
      !(target.scope === 'field' && entry.key === viewsKey)
  )
  if (found.error) return <Notice tone="danger" title={describe(found.error).title} />
  if (!rows) return <Loading />
  if (!others.length)
    return (
      <Empty icon={<InfoIcon size={24} />} title="No other metadata yet">
        Keys such as <span class="mono">purpose</span>, <span class="mono">contact</span> or{' '}
        <span class="mono">display_field</span> describe it for everyone who may reach it.
      </Empty>
    )
  return (
    <table class="grid grid-plain">
      <thead>
        <tr>
          <th>Key</th>
          <th>Value</th>
          <th>Changed</th>
          {owner && (
            <th class="grid-actions">
              <span class="sr-only">Actions</span>
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {others.map((entry) => (
          <tr key={entry.key}>
            <td class="mono">{entry.key}</td>
            <td class={typeof entry.value === 'string' ? '' : 'mono'}>{display(entry.value)}</td>
            <td class="cell-muted">
              {entry.updated_by}, {ago(entry.updated_at)} · v{entry.version}
            </td>
            {owner && (
              <td class="grid-actions">
                <button
                  type="button"
                  class="icon-button"
                  aria-label={`Edit ${entry.key}`}
                  onClick={() =>
                    onEdit({
                      key: entry.key,
                      text: asText(entry.value),
                      version: entry.version,
                      isNew: false,
                    })
                  }
                >
                  <EditIcon size={16} />
                </button>
                <button
                  type="button"
                  class="icon-button"
                  aria-label={`Remove ${entry.key}`}
                  onClick={() => remove(entry)}
                >
                  <TrashIcon size={16} />
                </button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** The form that changes one key of an item's metadata. */
function KeyForm({
  editing,
  target,
  onClose,
  onSaved,
}: {
  editing: Editing
  target: MetadataTarget
  onClose: () => void
  onSaved: () => void
}) {
  const { withDb, notify } = useSession()
  const [draft, setDraft] = useState(editing)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const save = async () => {
    setBusy(true)
    setProblem(null)
    try {
      const affected = await withDb((db) =>
        setMetadata(db, target, draft.key.trim(), parse(draft.text), draft.version)
      )
      if (!affected) {
        setProblem('Someone changed this key since you opened it. Close and open it again.')
        return
      }
      notify({ tone: 'success', title: `Saved ${draft.key}` })
      onSaved()
    } catch (error) {
      setProblem(describe(error).title)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div class="form">
      {problem && <Notice tone="danger" title={problem} />}
      <Field label="Key" id="meta-key" wide required hint="1 to 128 characters.">
        <Input
          id="meta-key"
          mono
          value={draft.key}
          disabled={!draft.isNew}
          onInput={(e) => setDraft({ ...draft, key: e.currentTarget.value })}
        />
      </Field>
      <Field
        label="Value"
        id="meta-value"
        wide
        hint="Plain text is stored as a string; JSON (an object, a list, a number, true) is stored as itself."
      >
        <TextArea
          id="meta-value"
          rows={6}
          value={draft.text}
          onInput={(e) => setDraft({ ...draft, text: e.currentTarget.value })}
        />
      </Field>
      <div class="row-actions field-wide">
        <Button onClick={onClose}>Cancel</Button>
        <Button tone="primary" busy={busy} disabled={!draft.key.trim()} onClick={save}>
          Save
        </Button>
      </div>
    </div>
  )
}

/** The drawer that changes one key of an item's metadata. */
function KeyDrawer({
  editing,
  target,
  onClose,
  onSaved,
}: {
  editing: Editing | null
  target: MetadataTarget
  onClose: () => void
  onSaved: () => void
}) {
  return (
    <Drawer
      open={editing !== null}
      onClose={onClose}
      title={editing?.isNew ? 'Add a metadata key' : `Edit ${editing?.key}`}
    >
      {editing && <KeyForm editing={editing} target={target} onClose={onClose} onSaved={onSaved} />}
    </Drawer>
  )
}

/**
 * A field's metadata, in a drawer: the name it is read by, and the keys it carries. A field's
 * metadata is as private as the field: PostgreSQL returns the rows of the fields the reader may
 * reach, and no others.
 */
export function FieldMetadataDrawer({
  schema,
  table,
  column,
  owner,
  open,
  onClose,
}: {
  schema: string
  table: string
  column: string
  owner: boolean
  open: boolean
  onClose: () => void
}) {
  const target = fieldTarget(schema, table, column)
  const [editing, setEditing] = useState<Editing | null>(null)
  // The field's own metadata, read once: the editor of where it appears and the list of the
  // keys it carries are two views of the same rows.
  const found = useLoad(
    (db) => metadata(db, target),
    [target.scope, target.schema, target.table, target.column]
  )
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`Metadata of ${column}`}
      subtitle="What this field is, kept beside it in platform.item_metadata."
    >
      {editing ? (
        <KeyForm
          editing={editing}
          target={target}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      ) : !found.data ? (
        <Loading />
      ) : (
        <>
          <PresentationEditor target={target} owner={owner} />
          <div class="drawer-section">
            <div>
              <h3 class="drawer-title">Where it appears</h3>
              <p class="drawer-note">
                The list, the record and the filters. A field may be shown in one and hidden in
                another; PostgreSQL still decides who may read it and who may write it.
              </p>
            </div>
            <ViewsEditor target={target} owner={owner} entries={found.data} />
          </div>
          <div class="drawer-section">
            <div class="row-actions row-start">
              {owner && (
                <Button
                  icon={<PlusIcon size={16} />}
                  onClick={() => setEditing({ key: '', text: '', isNew: true })}
                >
                  Add key
                </Button>
              )}
            </div>
            <MetadataKeys
              target={target}
              owner={owner}
              onEdit={setEditing}
              entries={found.data}
              onChanged={found.reload}
            />
          </div>
        </>
      )}
    </Drawer>
  )
}
