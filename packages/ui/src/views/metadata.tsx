import { useId, useState } from 'preact/hooks'
import clsx from 'clsx'
import { metadata, metadataStatements, removeMetadata, setMetadata } from '../db/metadata.ts'
import type { MetadataChange } from '../db/metadata.ts'
import type { MetadataEntry } from '../db/types.ts'
import { ago, display } from '../format.ts'
import { describe, useLoad, useSession } from '../session.tsx'
import { familyOf, palette, parseColor, reservedFamilies, studioFamilies } from '../state/color.ts'
import type { Family } from '../state/color.ts'
import {
  colorKey,
  displayNameKey,
  displayNameLimit,
  iconKey,
  presentationKeys,
  presentationOf,
} from '../state/presentation.ts'
import { Empty, Loading, Notice, Statement } from '../ui/bits.tsx'
import { Avatar } from '../ui/avatar.tsx'
import { Button } from '../ui/button.tsx'
import { Field, Input, TextArea } from '../ui/form.tsx'
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
import { useRunner } from './runner.tsx'

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
 * decides who reads them and who changes them, as it does for every other key.
 */
export function PresentationPanel({
  schema,
  table,
  owner,
}: {
  schema: string
  table: string | null
  owner: boolean
}) {
  const { presentations } = useSession()
  const stored = presentationOf(presentations, schema, table)
  const [name, setName] = useState(stored.displayName ?? '')
  const [icon, setIcon] = useState(stored.icon ?? '')
  const [colour, setColour] = useState(stored.color ?? '')
  const [seen, setSeen] = useState(stored)
  const runner = useRunner()
  const group = useId()
  const iconName = `${group}-icon`
  const colourName = `${group}-colour`
  const item = table ? 'collection' : 'workspace'
  const Fallback = table ? CollectionIcon : WorkspaceIcon

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
  if ((icon || null) !== stored.icon) changes.push({ key: iconKey, value: icon || null })
  if ((colour || null) !== stored.color) changes.push({ key: colorKey, value: colour || null })
  const statements = metadataStatements(schema, table, changes)
  const chosen = familyOf(colour)
  const invalid = colour.trim() !== '' && !chosen && !parseColor(colour)

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
      {runner.problem && (
        <Notice tone="danger" title={runner.problem.title}>
          {runner.problem.detail}
        </Notice>
      )}
      <div class="presentation">
        <div class="presentation-preview">
          <Avatar
            presentation={{ displayName: name.trim() || null, icon: icon || null, color: colour }}
            fallback={Fallback}
            class="avatar-preview"
            size={24}
          />
          <div>
            <strong>{name.trim() || (table ?? schema)}</strong>
            <small class="mono note">
              {table ? `${schema}.${table}` : schema}
              {name.trim() ? '' : ' · the name in SQL'}
            </small>
          </div>
        </div>
        <div class="form">
          <Field
            label="Display name"
            id={`${group}-name`}
            hint={`The name people read. The ${item} keeps its own name in SQL.`}
            error={
              name.length > displayNameLimit ? `${displayNameLimit} characters at most.` : null
            }
          >
            <Input
              id={`${group}-name`}
              value={name}
              disabled={!owner}
              maxLength={displayNameLimit + 20}
              onInput={(e) => setName(e.currentTarget.value)}
              placeholder={table ? 'Articles' : 'Newsroom'}
            />
          </Field>
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
                A colour is a family of the palette &mdash; steel, cyan, bronze &mdash; or a colour
                of your own, written as #rrggbb.
              </p>
            ) : (
              <p class="field-hint">
                The colour of the mark. The studio draws its own palette: a colour of your own is
                drawn as the family nearest to it, with the ink that reads on it.
              </p>
            )}
          </fieldset>
        </div>
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
    </section>
  )
}

/**
 * The metadata of a workspace or a collection: what it is, as opposed to what it holds.
 * Row security decides who reads it and who changes it: the owner of the item.
 */
export function MetadataPanel({
  schema,
  table,
  owner,
}: {
  schema: string
  table: string | null
  owner: boolean
}) {
  const { withDb, notify } = useSession()
  const found = useLoad((db) => metadata(db, schema, table), [schema, table])
  const [editing, setEditing] = useState<{
    key: string
    text: string
    version?: number
    isNew: boolean
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const save = async () => {
    if (!editing) return
    setBusy(true)
    setProblem(null)
    try {
      const affected = await withDb((db) =>
        setMetadata(db, schema, table, editing.key.trim(), parse(editing.text), editing.version)
      )
      if (!affected) {
        setProblem('Someone changed this key since you opened it. Close and open it again.')
        return
      }
      notify({ tone: 'success', title: `Saved ${editing.key}` })
      setEditing(null)
      found.reload()
    } catch (error) {
      setProblem(describe(error).title)
    } finally {
      setBusy(false)
    }
  }
  const remove = async (entry: MetadataEntry) => {
    try {
      const affected = await withDb((db) => removeMetadata(db, schema, table, entry.key))
      notify(
        affected
          ? { tone: 'success', title: `Removed ${entry.key}` }
          : {
              tone: 'error',
              title: 'PostgreSQL removed nothing',
              detail: 'Only the owner may change this metadata.',
            }
      )
      found.reload()
    } catch (error) {
      notify({ tone: 'error', ...describe(error) })
    }
  }
  // The presentation has a panel of its own; the rest of the metadata is listed here.
  const others = (found.data ?? []).filter(
    (entry) => !(presentationKeys as readonly string[]).includes(entry.key)
  )
  return (
    <section class="panel">
      <header class="panel-head">
        <div>
          <h2>Metadata</h2>
          <p>
            What this {table ? 'collection' : 'workspace'} is, kept beside it in{' '}
            <span class="mono">platform.item_metadata</span>.{' '}
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
      {found.error ? (
        <Notice tone="danger" title={describe(found.error).title} />
      ) : !found.data ? (
        <Loading />
      ) : others.length ? (
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
                <td class={typeof entry.value === 'string' ? '' : 'mono'}>
                  {display(entry.value)}
                </td>
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
                        setEditing({
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
      ) : (
        <Empty icon={<InfoIcon size={24} />} title="No other metadata yet">
          Keys such as <span class="mono">purpose</span>, <span class="mono">contact</span> or{' '}
          <span class="mono">display_field</span> describe it for everyone who may reach it.
        </Empty>
      )}
      <Drawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.isNew ? 'Add a metadata key' : `Edit ${editing?.key}`}
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button tone="primary" busy={busy} disabled={!editing?.key.trim()} onClick={save}>
              Save
            </Button>
          </>
        }
      >
        {problem && <Notice tone="danger" title={problem} />}
        {editing && (
          <div class="form">
            <Field label="Key" id="meta-key" wide required hint="1 to 128 characters.">
              <Input
                id="meta-key"
                mono
                value={editing.key}
                disabled={!editing.isNew}
                onInput={(e) => setEditing({ ...editing, key: e.currentTarget.value })}
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
                value={editing.text}
                onInput={(e) => setEditing({ ...editing, text: e.currentTarget.value })}
              />
            </Field>
          </div>
        )}
      </Drawer>
    </section>
  )
}
