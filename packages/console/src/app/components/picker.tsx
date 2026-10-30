/**
 * A picker: a list of values chosen by searching: the members of a group, the
 * permissions of a role, the holder of a right.
 *
 * The reader types a part of a name, moves through the matches with the
 * arrows and takes one with Enter or a click; a chip removes it again.
 * The picker writes one hidden field per value, so the form sends what
 * the chips show. A picker that tracks its changes says what is not
 * saved yet, and the browser asks before a page with unsaved changes is
 * left.
 */

import { useEffect, useState } from 'hono/jsx'

interface Candidate {
  readonly value: string
  readonly label: string
  /** A second line: an e-mail, the permissions of a role. */
  readonly hint?: string
}

/** Whether a form of the page is being sent: leaving the page is then intended. */
let sending = false
if (typeof document !== 'undefined') {
  document.addEventListener(
    'submit',
    () => {
      sending = true
    },
    true
  )
}

/** The properties of a picker. */
export interface PickerProps {
  name: string
  candidates: readonly Candidate[]
  selected: readonly string[]
  /** The label of the search box, for the readers of the screen. */
  label: string
  placeholder?: string
  /** What the picker says when nothing is chosen. */
  emptyText?: string
  /** One value at most: choosing another replaces it. */
  single?: boolean
  /** Whether a value that is not a candidate may be added, and the pattern it must follow. */
  allowNew?: boolean
  newPattern?: string
  /** Whether the picker says what is not saved yet. */
  trackChanges?: boolean
  /** The word for one value and for several, in the line of the changes. */
  noun?: readonly [string, string]
  /** The id of the search box, so that a label can name it. */
  id?: string
}

/** A picker. The island of the same name hydrates it; another island renders it as it is. */
export function Picker(props: PickerProps & { onChange?: (values: string[]) => void }) {
  const [values, setValues] = useState<string[]>([...props.selected])
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const uid = props.id ?? `picker-${props.name}`
  const listId = `${uid}-list`

  const byValue = new Map(props.candidates.map((candidate) => [candidate.value, candidate]))
  const labelOf = (value: string) => byValue.get(value)?.label ?? value
  const needle = query.trim().toLowerCase()
  const matches = props.candidates
    .filter((candidate) => !values.includes(candidate.value))
    .filter(
      (candidate) =>
        needle === '' ||
        candidate.label.toLowerCase().includes(needle) ||
        candidate.value.toLowerCase().includes(needle) ||
        (candidate.hint ?? '').toLowerCase().includes(needle)
    )
    .slice(0, 8)
  const pattern = props.newPattern ? new RegExp(`^(?:${props.newPattern})$`) : null
  const typed = query.trim()
  const offerNew =
    props.allowNew === true &&
    typed !== '' &&
    !values.includes(typed) &&
    !byValue.has(typed) &&
    (pattern === null || pattern.test(typed))
  const options: { value: string; label: string; hint?: string; fresh?: boolean }[] = [
    ...matches,
    ...(offerNew
      ? [{ value: typed, label: typed, hint: 'not used in this tenant yet', fresh: true }]
      : []),
  ]
  const shown = open && options.length > 0

  const added = values.filter((value) => !props.selected.includes(value))
  const removed = props.selected.filter((value) => !values.includes(value))
  const dirty = props.trackChanges === true && (added.length > 0 || removed.length > 0)

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      if (sending) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const change = (next: string[]) => {
    setValues(next)
    props.onChange?.(next)
  }
  const take = (value: string) => {
    change(props.single ? [value] : [...values, value])
    setQuery('')
    setActive(0)
    if (props.single) setOpen(false)
  }
  const drop = (value: string) => change(values.filter((entry) => entry !== value))
  const [one, many] = props.noun ?? ['value', 'values']
  const count = (n: number) => `${n} ${n === 1 ? one : many}`

  return (
    <div class="picker">
      {values.map((value) => (
        <input type="hidden" name={props.name} value={value} />
      ))}
      <div class="chips" aria-live="polite">
        {values.length === 0 ? (
          <span class="small muted">{props.emptyText ?? 'Nothing chosen.'}</span>
        ) : null}
        {values.map((value) => (
          <span
            class={`chip ${props.trackChanges && added.includes(value) ? 'chip-added' : ''}`.trim()}
            title={byValue.has(value) ? value : 'Not among the entries the console read'}
          >
            {labelOf(value)}
            <button
              type="button"
              aria-label={`Remove ${labelOf(value)}`}
              onClick={() => drop(value)}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div class="picker-box">
        <input
          id={props.id}
          type="search"
          role="combobox"
          autocomplete="off"
          aria-label={props.label}
          aria-autocomplete="list"
          aria-expanded={shown ? 'true' : 'false'}
          aria-controls={listId}
          aria-activedescendant={
            shown ? `${uid}-${Math.min(active, options.length - 1)}` : undefined
          }
          placeholder={props.placeholder ?? 'Type to search'}
          value={query}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onInput={(event: Event) => {
            setQuery((event.target as HTMLInputElement).value)
            setActive(0)
            setOpen(true)
          }}
          onKeyDown={(event: KeyboardEvent) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setOpen(true)
              setActive(Math.min(active + 1, Math.max(0, options.length - 1)))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setActive(Math.max(0, active - 1))
            } else if (event.key === 'Enter') {
              event.preventDefault()
              const chosen = options[Math.min(active, options.length - 1)]
              if (chosen) take(chosen.value)
            } else if (event.key === 'Escape') {
              setQuery('')
              setOpen(false)
            } else if (event.key === 'Backspace' && query === '' && values.length > 0) {
              drop(values[values.length - 1]!)
            }
          }}
        />
        {shown ? (
          <div class="picker-list" role="listbox" id={listId} aria-label={props.label}>
            {options.map((option, index) => (
              <div
                id={`${uid}-${index}`}
                role="option"
                tabIndex={-1}
                aria-selected={index === Math.min(active, options.length - 1) ? 'true' : 'false'}
                onMouseDown={(event: MouseEvent) => {
                  event.preventDefault()
                  take(option.value)
                }}
                onMouseEnter={() => setActive(index)}
              >
                <span>
                  {option.fresh ? 'Create ' : null}
                  <strong>{option.label}</strong>
                </span>
                {option.hint ? <span class="small muted">{option.hint}</span> : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
      {dirty ? (
        <p class="small picker-changes" role="status">
          Not saved yet:{' '}
          {[
            added.length > 0 ? `${count(added.length)} added` : '',
            removed.length > 0 ? `${count(removed.length)} removed` : '',
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
