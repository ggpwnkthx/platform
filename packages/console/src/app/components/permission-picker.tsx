/**
 * A permission as every page shows it, and the list every form chooses
 * one from.
 *
 * The label says a permission the same way wherever it is read: its key,
 * where a right has to hold to open it, and what it opens in a sentence.
 * The picker is the list of the permissions of the tenant, family by
 * family, each one under its label: the form of a role ticks several,
 * the form of a right chooses one, and the reader sees them all without
 * knowing a key to search for.
 *
 * The picker is a list of boxes of the form, so the form sends what is
 * ticked without a script. The script filters the list, adds a key the
 * tenant does not name yet, and says what is not saved yet.
 */

import { useState } from 'hono/jsx'
import {
  type PermissionEntry,
  permissionEntryOf,
  permissionFamiliesOf,
} from '../../domains/operators'
import { useUnsavedWarning } from './picker'

/** Where a right has to hold to open a permission, in the words of the grant form. */
const REACH = { tenant: 'on the tenant itself', workspace: 'on a workspace' } as const

/** What the label says of a permission nobody describes. */
const NOT_DESCRIBED = 'Not described: the policies of the deployment decide what it allows.'

/** The roles that hold a permission, as a line: `In editor and reader`. */
function rolesLine(roles: readonly string[]): string {
  if (roles.length <= 2) return `In ${roles.join(' and ')}`
  return `In ${roles.length} roles`
}

/** A permission: its key, where it is read, and what it opens. */
export function PermissionLabel(props: {
  entry: PermissionEntry
  /** Whether the label names the roles that hold the permission. */
  roles?: boolean
  /** Whether the tenant does not name the permission yet. */
  fresh?: boolean
}) {
  const { entry } = props
  return (
    <span class="permission-label">
      <span class="permission-key">
        <code>{entry.key}</code>
        {entry.platform ? <span class="badge accent plain">the platform's</span> : null}
        {entry.reach ? <span class="badge plain">{REACH[entry.reach]}</span> : null}
        {props.fresh ? <span class="badge warn plain">new</span> : null}
      </span>
      <span class="small muted">
        {props.fresh ? 'Not used in this tenant yet.' : (entry.opens ?? NOT_DESCRIBED)}
      </span>
      {props.roles && entry.roles.length > 0 ? (
        <span class="small muted">{rolesLine(entry.roles)}</span>
      ) : null}
    </span>
  )
}

/** The properties of the picker of permissions. */
export interface PermissionPickerProps {
  /** The name of the field: one value per ticked permission. */
  name: string
  /** The permissions of the tenant. */
  entries: readonly PermissionEntry[]
  selected: readonly string[]
  /** The name of the list, for the readers of the screen. */
  label: string
  /** One permission at most: choosing another replaces it. */
  single?: boolean
  /** The permissions the operator may not give, and why. */
  locked?: Readonly<Record<string, string>>
  /** Whether a key the tenant does not name may be added, and the pattern it must follow. */
  allowNew?: boolean
  newPattern?: string
  /** Whether the picker says what is not saved yet. */
  trackChanges?: boolean
  /** The id of the filter box, so that a label can name it. */
  id?: string
}

/** The picker of permissions. The island of the same name hydrates it; another island renders it as it is. */
export function PermissionPicker(
  props: PermissionPickerProps & { onChange?: (values: string[]) => void }
) {
  const listed = new Set(props.entries.map((entry) => entry.key))
  const [values, setValues] = useState<string[]>([...props.selected])
  // The keys the tenant does not name yet: the ones a refused form
  // comes back with, and the ones the reader adds.
  const [added, setAdded] = useState<string[]>(props.selected.filter((key) => !listed.has(key)))
  const [query, setQuery] = useState('')
  const [fresh, setFresh] = useState('')
  const uid = props.id ?? `permissions-${props.name}`

  const entries = [
    ...props.entries,
    ...added.filter((key) => !listed.has(key)).map((key) => permissionEntryOf(key, { roles: [] })),
  ]
  const needle = query.trim().toLowerCase()
  const matches = (entry: PermissionEntry) =>
    needle === '' ||
    entry.key.toLowerCase().includes(needle) ||
    (entry.opens ?? '').toLowerCase().includes(needle) ||
    entry.roles.some((role) => role.toLowerCase().includes(needle))
  const families = permissionFamiliesOf(entries)
  const shown = entries.filter(matches).length

  const ticked = values.filter((value) => !props.selected.includes(value))
  const cleared = props.selected.filter((value) => !values.includes(value))
  const dirty = props.trackChanges === true && (ticked.length > 0 || cleared.length > 0)
  useUnsavedWarning(dirty)

  const change = (next: string[]) => {
    setValues(next)
    props.onChange?.(next)
  }
  const toggle = (key: string, on: boolean) => {
    if (props.single) change(on ? [key] : [])
    else
      change(
        on
          ? [...values.filter((value) => value !== key), key]
          : values.filter((value) => value !== key)
      )
  }
  const pattern = props.newPattern ? new RegExp(`^(?:${props.newPattern})$`) : null
  const typed = fresh.trim()
  const addable = typed !== '' && (pattern === null || pattern.test(typed))
  const add = () => {
    if (!addable) return
    if (!listed.has(typed) && !added.includes(typed)) setAdded([...added, typed])
    if (!values.includes(typed)) toggle(typed, true)
    setFresh('')
    setQuery('')
  }
  const count = (n: number) => `${n} ${n === 1 ? 'permission' : 'permissions'}`

  return (
    <div class="permission-picker">
      <input
        id={props.id}
        type="search"
        autocomplete="off"
        aria-label={`Filter ${props.label.toLowerCase()}`}
        aria-controls={`${uid}-list`}
        placeholder="Filter by key, by what it opens, or by role"
        value={query}
        onInput={(event: Event) => setQuery((event.target as HTMLInputElement).value)}
        onKeyDown={(event: KeyboardEvent) => {
          // The filter is not a field of the form: Enter does not send it.
          if (event.key === 'Enter') event.preventDefault()
        }}
      />
      <div class="permission-list" id={`${uid}-list`}>
        {entries.length === 0 ? (
          <p class="small muted permission-note">The tenant names no permission yet.</p>
        ) : null}
        {/* A row the filter hides stays in the form: what is ticked is sent. */}
        {families.map((family) => (
          <fieldset class="permission-family" hidden={!family.entries.some(matches)}>
            <legend class="permission-family-name">{family.family}</legend>
            {family.entries.map((entry) => {
              const checked = values.includes(entry.key)
              const lock = props.locked?.[entry.key] ?? null
              return (
                <label
                  class={`permission-option ${lock ? 'locked' : ''}`.trim()}
                  hidden={!matches(entry)}
                >
                  <input
                    type={props.single ? 'radio' : 'checkbox'}
                    class="permission-tick"
                    name={props.name}
                    value={entry.key}
                    checked={checked}
                    // What is not the operator's to give is not ticked; what
                    // is held already may still be taken away.
                    disabled={lock !== null && !checked}
                    onChange={(event: Event) =>
                      toggle(entry.key, (event.target as HTMLInputElement).checked)
                    }
                  />
                  <span class="permission-text">
                    <PermissionLabel entry={entry} roles fresh={!listed.has(entry.key)} />
                    {lock ? <span class="small problem">{lock}</span> : null}
                  </span>
                </label>
              )
            })}
          </fieldset>
        ))}
        {entries.length > 0 && shown === 0 ? (
          <p class="small muted permission-note">No permission matches the filter.</p>
        ) : null}
      </div>
      {props.allowNew ? (
        <div class="permission-new">
          <input
            class="mono permission-new-key"
            autocomplete="off"
            aria-label="The key of a permission the tenant does not name yet"
            placeholder="A key the tenant does not name yet: content.archive"
            title="Lower-case letters, digits, dots, dashes and underscores"
            value={fresh}
            onInput={(event: Event) => setFresh((event.target as HTMLInputElement).value)}
            onKeyDown={(event: KeyboardEvent) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              add()
            }}
          />
          <button type="button" class="button quiet" disabled={!addable} onClick={add}>
            Add
          </button>
        </div>
      ) : null}
      <p class="small muted permission-chosen" aria-live="polite">
        {values.length === 0
          ? props.single
            ? 'No permission chosen yet.'
            : 'No permission of its own.'
          : props.single
            ? `Chosen: ${values[0]}`
            : `${count(values.length)} chosen: ${values.join(', ')}`}
      </p>
      {dirty ? (
        <p class="small picker-changes" role="status">
          Not saved yet:{' '}
          {[
            ticked.length > 0 ? `${count(ticked.length)} added` : '',
            cleared.length > 0 ? `${count(cleared.length)} removed` : '',
          ]
            .filter(Boolean)
            .join(', ')}
          .{' '}
          <button type="button" class="link-button" onClick={() => change([...props.selected])}>
            Undo
          </button>
        </p>
      ) : null}
    </div>
  )
}
