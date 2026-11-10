/**
 * The state of the interface.
 *
 * The interface is a state and the keys the reader presses: every key
 * is an action, and every action is a new state. The state holds what
 * the reader sees: the page, the list, the form, the log and the
 * message.
 *
 * The state is a fact and not a drawing: the interface draws it, and
 * the tests of the interface read it without a terminal.
 */

import type { Profiles } from '../domains/contracts'
import type { ResolvedContext } from '../domains/context'
import type { Probe } from '../domains/status'

/** The pages of the interface. */
export type Page =
  /** The deployments of the machine. */
  | 'deployments'
  /** The state of one deployment. */
  | 'overview'
  /** The tenants of the deployment. */
  | 'tenants'
  /** The principals of the deployment. */
  | 'principals'
  /** The grants of the deployment. */
  | 'grants'
  /** The creation of a deployment. */
  | 'create'
  /** The keys of the interface. */
  | 'help'

/** A row of a list. */
export interface Row {
  /** The cells of the row. */
  readonly cells: readonly string[]
  /** What the row is, when the reader acts on it. */
  readonly id: string
}

/** The kinds of a field of a form. */
export type FieldKind = 'text' | 'choice' | 'toggle'

/** A field of a form. */
export interface Field {
  /** The name of the value the field holds. */
  readonly name: string
  /** What the field is, in one line. */
  readonly label: string
  /** The value of the field. */
  readonly value: string
  /** The kind of the field. */
  readonly kind: FieldKind
  /** The values the field takes, when it takes one of them. */
  readonly choices?: readonly string[]
  /** What the reader should know about the field. */
  readonly hint?: string
  /** True when the value is a secret, and the interface does not draw it. */
  readonly secret?: boolean
  /**
   * The values the interface knows for the field: the tenants of the
   * deployment, the principals of the tenant, the permissions it has
   * seen. The field takes any text, and it offers the first of these
   * that begins with what the reader typed.
   */
  readonly suggestions?: readonly string[]
}

/** A form. */
export interface Form {
  /** What the form is, in one line. */
  readonly title: string
  /** The fields of the form. */
  readonly fields: readonly Field[]
  /** The index of the field the reader is in. */
  readonly focus: number
  /** What the form does when it is sent. */
  readonly action: string
  /**
   * Where the reader writes in the field they are in, counted in
   * letters from the beginning of the value. A form that names no place
   * writes at the end of the value.
   */
  readonly cursor?: number
}

/**
 * The work the interface is at.
 *
 * A work that takes a while is named and timed: a reader who sees a
 * screen that does not move knows what the interface waits for, and
 * how long it has been waiting for it.
 */
export interface Work {
  /** What the interface is doing, in one line. */
  readonly what: string
  /** The moment the work began, in milliseconds since the epoch. */
  readonly since: number
}

/** A message the interface shows. */
export interface Message {
  /** The words of the message. */
  readonly text: string
  /** The kind of the message. */
  readonly kind: 'info' | 'ok' | 'error'
}

/** The state of the interface. */
export interface State {
  /** The page the reader is on. */
  readonly page: Page
  /** The pages the reader came from. */
  readonly stack: readonly Page[]
  /** The deployments of the machine. */
  readonly profiles: Profiles
  /** The deployment the interface works on. */
  readonly context?: ResolvedContext
  /** The names of the columns of the list. */
  readonly columns: readonly string[]
  /** The rows of the list. */
  readonly rows: readonly Row[]
  /** The index of the selected row. */
  readonly selection: number
  /** The lines that describe the selected row. */
  readonly detail: readonly string[]
  /** The form the reader is in, when the reader is in one. */
  readonly form?: Form
  /** The text the reader filters the list with. */
  readonly filter: string
  /** True while the reader types the text of the filter. */
  readonly filtering: boolean
  /** True when the list of the page was read from its service. */
  readonly loaded: boolean
  /** The question the reader is asked to confirm, when there is one. */
  readonly confirm?: string
  /** The probes of the deployment. */
  readonly probes: readonly Probe[]
  /** The lines of the log. */
  readonly log: readonly string[]
  /** The message the interface shows. */
  readonly message?: Message
  /** True while the interface is at work. */
  readonly busy: boolean
  /** The work the interface is at, when it is at one. */
  readonly work?: Work
  /** The title of the page. */
  readonly title: string
}

/** The state of an interface that has nothing in it yet. */
export const EMPTY: State = {
  page: 'deployments',
  stack: [],
  profiles: { profiles: {} },
  columns: [],
  rows: [],
  selection: 0,
  detail: [],
  filter: '',
  filtering: false,
  loaded: false,
  probes: [],
  log: [],
  busy: false,
  title: 'the deployments of the machine',
}

/** What the reader does to the interface. */
export type Action =
  /** The deployments of the machine. */
  | { readonly type: 'profiles'; readonly profiles: Profiles }
  /** The deployment the interface works on. */
  | { readonly type: 'context'; readonly context: ResolvedContext }
  /** The list of the page. */
  | { readonly type: 'rows'; readonly columns: readonly string[]; readonly rows: readonly Row[] }
  /** The lines that describe the selected row. */
  | { readonly type: 'detail'; readonly lines: readonly string[] }
  /** A form the reader is in. */
  | { readonly type: 'form'; readonly form?: Form }
  /** The value of a field. */
  | { readonly type: 'field'; readonly name: string; readonly value: string }
  /** The field the reader is in. */
  | { readonly type: 'focus'; readonly delta: number }
  /** The value of a field that takes one of several values, the list going round. */
  | { readonly type: 'choice'; readonly delta: number }
  /** The value of a field that takes one of several values, the list stopping at its ends. */
  | { readonly type: 'step'; readonly delta: number }
  /** The field the reader is put in. */
  | { readonly type: 'goto'; readonly index: number }
  /** The reader moved inside the value of a field. */
  | { readonly type: 'cursor'; readonly delta: number }
  /** The reader went to the beginning or to the end of the value of a field. */
  | { readonly type: 'edge'; readonly end: boolean }
  /** The reader erased a character. */
  | { readonly type: 'erase' }
  /** The reader erased the character after the cursor. */
  | { readonly type: 'delete' }
  /** The reader erased the value of the field. */
  | { readonly type: 'clear' }
  /** The reader took the value the field offers. */
  | { readonly type: 'accept' }
  /** The reader typed a character. */
  | { readonly type: 'type'; readonly char: string }
  /** The reader moved the selection. */
  | { readonly type: 'move'; readonly delta: number }
  /** The selection is on a row the reader has chosen. */
  | { readonly type: 'select'; readonly index: number }
  /** The reader went to another page. */
  | { readonly type: 'page'; readonly page: Page; readonly title?: string }
  /** The reader went back. */
  | { readonly type: 'back' }
  /** The text the reader filters the list with. */
  | { readonly type: 'filter'; readonly text: string }
  /** The reader types the text of the filter, or stopped typing it. */
  | { readonly type: 'filtering'; readonly on: boolean }
  /** The list of the page was read from its service. */
  | { readonly type: 'loaded' }
  /** The question the reader is asked to confirm. */
  | { readonly type: 'confirm'; readonly question?: string }
  /** The probes of the deployment. */
  | { readonly type: 'probes'; readonly probes: readonly Probe[] }
  /** The lines of the log. */
  | { readonly type: 'log'; readonly lines: readonly string[] }
  /** The message the interface shows. */
  | { readonly type: 'message'; readonly message?: Message }
  /** The interface is at work, or it is not. */
  | { readonly type: 'busy'; readonly busy: boolean }
  /** The work the interface is at, and the moment it began. */
  | { readonly type: 'work'; readonly work?: Work }
  /** The title of the page. */
  | { readonly type: 'title'; readonly title: string }

/**
 * The state of the interface, after the action.
 *
 * @param state the state the reader saw.
 * @param action what the reader did.
 */
export function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'profiles':
      return { ...state, profiles: action.profiles }
    case 'context':
      return { ...state, context: action.context }
    case 'rows':
      return { ...state, columns: action.columns, rows: action.rows, selection: 0 }
    case 'detail':
      return { ...state, detail: action.lines }
    case 'form':
      return { ...state, form: action.form }
    case 'field':
      return { ...state, form: withField(state.form, action.name, action.value) }
    case 'focus':
      return { ...state, form: withFocus(state.form, action.delta) }
    case 'choice':
      return { ...state, form: withChoice(state.form, action.delta, true) }
    case 'step':
      return { ...state, form: withChoice(state.form, action.delta, false) }
    case 'goto':
      return { ...state, form: withFocus(state.form, action.index - (state.form?.focus ?? 0)) }
    case 'cursor':
      return { ...state, form: withCursor(state.form, cursorOf(state.form) + action.delta) }
    case 'edge':
      return {
        ...state,
        form: withCursor(state.form, action.end ? Number.MAX_SAFE_INTEGER : 0),
      }
    case 'erase':
      return { ...state, form: withErased(state.form) }
    case 'delete':
      return { ...state, form: withDeleted(state.form) }
    case 'clear':
      return { ...state, form: withCleared(state.form) }
    case 'accept': {
      const field = state.form?.fields[state.form.focus]
      const offered = field ? suggestionOf(field) : undefined
      if (!state.form || !field || offered === undefined) return state
      return {
        ...state,
        form: { ...withField(state.form, field.name, offered)!, cursor: undefined },
      }
    }
    case 'type':
      return { ...state, form: withTyped(state.form, action.char) }
    case 'move':
      return {
        ...state,
        selection: moved(state.selection, action.delta, visibleRows(state).length),
      }
    case 'select':
      return {
        ...state,
        selection: Math.max(0, Math.min(action.index, visibleRows(state).length - 1)),
      }
    case 'page': {
      const title = action.title ?? titleOf(action.page, state.context?.name)
      if (action.page === state.page) return { ...state, title }
      // The reader goes down from the tenants to the principals of
      // one and to the grants of one of them, and goes back up the
      // same way. A page the reader has already been through is gone
      // back to, and not opened under itself: the way back never
      // turns in a circle.
      const before = state.stack.indexOf(action.page)
      return {
        ...state,
        ...CLEARED,
        page: action.page,
        stack: before >= 0 ? state.stack.slice(0, before) : [...state.stack, state.page],
        title,
      }
    }
    case 'back': {
      const previous = state.stack[state.stack.length - 1]
      if (previous === undefined) return state
      return {
        ...state,
        ...CLEARED,
        page: previous,
        stack: state.stack.slice(0, -1),
        title: titleOf(previous, state.context?.name),
      }
    }
    case 'filter':
      return { ...state, filter: action.text, selection: 0 }
    case 'filtering':
      return { ...state, filtering: action.on }
    case 'loaded':
      return { ...state, loaded: true }
    case 'confirm':
      return { ...state, confirm: action.question }
    case 'probes':
      return { ...state, probes: action.probes }
    case 'log':
      return { ...state, log: [...state.log, ...action.lines].slice(-500) }
    case 'message':
      return { ...state, message: action.message }
    case 'busy':
      return { ...state, busy: action.busy }
    case 'work':
      return { ...state, work: action.work }
    case 'title':
      return { ...state, title: action.title }
    default:
      return state
  }
}

/**
 * What a page that was just opened holds: nothing yet.
 *
 * The list of a page is the list of that page and of no other: a page
 * that is opened shows no row of the page the reader came from, and
 * it says that it reads until its service has answered.
 */
const CLEARED = {
  columns: [],
  rows: [],
  selection: 0,
  detail: [],
  filter: '',
  filtering: false,
  loaded: false,
} as const

/**
 * The title of a page.
 *
 * @param page the page.
 * @param deployment the name of the deployment the interface works on.
 */
export function titleOf(page: Page, deployment?: string): string {
  const name = deployment ?? 'the deployment'
  switch (page) {
    case 'deployments':
      return 'the deployments of the machine'
    case 'overview':
      return deployment ? `the deployment ${deployment}` : 'the deployment'
    case 'tenants':
      return `the tenants of ${name}`
    case 'principals':
      return `the principals of ${name}`
    case 'grants':
      return `the grants of ${name}`
    case 'create':
      return 'a new deployment'
    default:
      return 'the keys of the interface'
  }
}

/**
 * The rows of the list the reader sees.
 *
 * A list that is filtered shows the rows that hold the text of the
 * filter in one of their cells, whatever the case of the letters.
 *
 * @param state the state of the interface.
 */
export function visibleRows(state: State): readonly Row[] {
  const text = state.filter.trim().toLowerCase()
  if (text === '') return state.rows
  return state.rows.filter((row) => row.cells.some((cell) => cell.toLowerCase().includes(text)))
}

/**
 * The value a field offers the reader.
 *
 * The offer is the first value the interface knows that begins with
 * what the reader typed, whatever the case of the letters: the reader
 * takes it with one key, or goes on typing something else. A field
 * that already holds one of the values offers nothing.
 *
 * @param field the field.
 */
export function suggestionOf(field: Field): string | undefined {
  if (field.kind !== 'text' || !field.suggestions) return undefined
  const typed = field.value.toLowerCase()
  if (field.suggestions.some((one) => one.toLowerCase() === typed)) return undefined
  return field.suggestions.find((one) => one.toLowerCase().startsWith(typed))
}

/**
 * Where the reader writes in the field they are in.
 *
 * @param form the form.
 */
export function cursorOf(form: Form | undefined): number {
  const length = form?.fields[form.focus]?.value.length ?? 0
  const cursor = form?.cursor ?? length
  return Math.max(0, Math.min(cursor, length))
}

/**
 * The index of the selection, after it moved.
 *
 * The selection stays inside the list: a reader who moves past the
 * last row is at the last row, and not somewhere else.
 *
 * @param selection the index of the selection.
 * @param delta the number of the rows the reader moved.
 * @param length the number of the rows of the list.
 */
export function moved(selection: number, delta: number, length: number): number {
  if (length === 0) return 0
  const moved = selection + delta
  if (moved < 0) return 0
  if (moved > length - 1) return length - 1
  return moved
}

/**
 * The form with a field of another value.
 *
 * @param form the form.
 * @param name the name of the field.
 * @param value the value of the field.
 */
function withField(form: Form | undefined, name: string, value: string): Form | undefined {
  if (!form) return form
  return {
    ...form,
    fields: form.fields.map((field) => (field.name === name ? { ...field, value } : field)),
  }
}

/**
 * The form with another field in it.
 *
 * @param form the form.
 * @param delta the number of the fields the reader moved.
 */
function withFocus(form: Form | undefined, delta: number): Form | undefined {
  if (!form || form.fields.length === 0) return form
  const focus = form.focus + delta
  const length = form.fields.length
  return { ...form, focus: ((focus % length) + length) % length, cursor: undefined }
}

/**
 * The form with the cursor at another place of the field the reader is in.
 *
 * @param form the form.
 * @param cursor the place of the cursor.
 */
function withCursor(form: Form | undefined, cursor: number): Form | undefined {
  if (!form) return form
  const field = form.fields[form.focus]
  if (field?.kind !== 'text') return form
  return { ...form, cursor: Math.max(0, Math.min(cursor, field.value.length)) }
}

/**
 * The form with another value in the field the reader is in.
 *
 * A field that takes one of several values takes the next one, and a
 * field that is a yes or a no takes the other.
 *
 * @param form the form.
 * @param delta the number of the values the reader moved.
 * @param cycle true when the list goes round, false when it stops at its ends.
 */
function withChoice(form: Form | undefined, delta: number, cycle: boolean): Form | undefined {
  if (!form) return form
  const field = form.fields[form.focus]
  if (!field) return form
  if (field.kind === 'toggle') {
    return withField(form, field.name, field.value === 'true' ? 'false' : 'true')
  }
  if (field.kind === 'choice' && field.choices && field.choices.length > 0) {
    const index = field.choices.indexOf(field.value)
    const next = index + delta
    const length = field.choices.length
    // The space goes round the list, and the arrows stop at its ends:
    // a reader who walks the list finds the same end twice.
    const value = cycle
      ? field.choices[((next % length) + length) % length]!
      : field.choices[Math.max(0, Math.min(next, length - 1))]!
    return withField(form, field.name, value)
  }
  return form
}

/**
 * The form with one character less before the cursor of the field the
 * reader is in.
 *
 * @param form the form.
 */
function withErased(form: Form | undefined): Form | undefined {
  if (!form) return form
  const field = form.fields[form.focus]
  if (field?.kind !== 'text') return form
  const cursor = cursorOf(form)
  if (cursor === 0) return form
  const value = field.value.slice(0, cursor - 1) + field.value.slice(cursor)
  return { ...withField(form, field.name, value)!, cursor: cursor - 1 }
}

/**
 * The form with one character less after the cursor of the field the
 * reader is in.
 *
 * @param form the form.
 */
function withDeleted(form: Form | undefined): Form | undefined {
  if (!form) return form
  const field = form.fields[form.focus]
  if (field?.kind !== 'text') return form
  const cursor = cursorOf(form)
  const value = field.value.slice(0, cursor) + field.value.slice(cursor + 1)
  return { ...withField(form, field.name, value)!, cursor }
}

/**
 * The form with nothing in the field the reader is in.
 *
 * @param form the form.
 */
function withCleared(form: Form | undefined): Form | undefined {
  if (!form) return form
  const field = form.fields[form.focus]
  if (field?.kind !== 'text') return form
  return { ...withField(form, field.name, '')!, cursor: 0 }
}

/**
 * The form with one character more at the cursor of the field the
 * reader is in.
 *
 * @param form the form.
 * @param char the character the reader typed.
 */
function withTyped(form: Form | undefined, char: string): Form | undefined {
  if (!form) return form
  const field = form.fields[form.focus]
  if (field?.kind !== 'text') return form
  const cursor = cursorOf(form)
  const value = field.value.slice(0, cursor) + char + field.value.slice(cursor)
  return { ...withField(form, field.name, value)!, cursor: cursor + char.length }
}

/**
 * The value of a field of a form.
 *
 * @param form the form.
 * @param name the name of the field.
 */
export function fieldValue(form: Form | undefined, name: string): string {
  return form?.fields.find((field) => field.name === name)?.value ?? ''
}
