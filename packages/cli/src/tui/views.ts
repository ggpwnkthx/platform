/**
 * The pages of the interface.
 *
 * A page is a function of the state and of the size of the terminal:
 * the same state is drawn the same way twice, and the frame fills the
 * screen of the reader.
 *
 * Every frame has the same four parts, and every part is where the
 * reader left it: the header, the page, the status and the bar of the
 * keys. A message that comes and goes moves nothing: the status keeps
 * its line whether it says something or not.
 */

import { paint } from '../app/color'
import {
  besideOf,
  frameOf,
  keybarOf,
  pad,
  panelOf,
  tableOf,
  truncate,
  visibleLength,
  windowOf,
  wrapOf,
} from './draw'
import {
  cursorOf,
  suggestionOf,
  visibleRows,
  type Field,
  type Form,
  type Page,
  type State,
} from './model'
import type { Size } from './screen'

/** The number of the columns from which the interface draws two panels. */
const WIDE = 110

/** The pages that hold a list. */
const LISTS: readonly Page[] = ['deployments', 'tenants', 'principals', 'grants']

/** A key and what it does. */
type Hint = readonly [string, string]

/**
 * The keys the reader presses, and what they do.
 *
 * The hints are in the order of their weight: a bar that has no room
 * for all of them leaves the last ones out, and keeps the one that
 * opens the page of the keys.
 *
 * @param state the state of the interface.
 */
export function hintsOf(state: State): readonly Hint[] {
  if (state.confirm !== undefined) {
    return [
      ['y', 'yes'],
      ['n', 'no'],
    ]
  }
  if (state.form) {
    if (state.busy) {
      return [
        [
          '',
          state.work
            ? `the interface is at work: ${state.work.what}`
            : 'the interface waits for the work to end',
        ],
        // The work of the interface takes a while, and the reader who
        // waits for it has to be able to leave.
        ['ctrl+c', 'quit'],
      ]
    }
    const field = state.form.fields[state.form.focus]
    const change: Hint[] =
      field?.kind === 'text'
        ? [
            field &&
            suggestionOf(field) !== undefined &&
            cursorOf(state.form) === field.value.length
              ? ['→', 'take the offer']
              : ['←→', 'move in the value'],
          ]
        : [
            ['space', 'change'],
            ['←→', 'change'],
          ]
    return [
      ['enter', state.form.action === 'deploy' ? 'deploy' : 'save'],
      ['tab', 'next field'],
      ...change,
      ['shift+tab', 'previous'],
      ['esc', 'cancel'],
    ]
  }
  if (state.filtering) {
    return [
      ['type', 'to filter'],
      ['↑↓', 'select'],
      ['enter', 'keep the filter'],
      ['esc', 'clear it'],
    ]
  }
  return [
    ...(state.filter === '' ? [] : [['esc', 'clear the filter'] as Hint]),
    ...pageHints(state),
  ]
}

/**
 * The keys of a page.
 *
 * @param state the state of the interface.
 */
function pageHints(state: State): readonly Hint[] {
  const back: readonly Hint[] = state.filter === '' ? [['esc', 'back']] : []
  switch (state.page) {
    case 'deployments':
      return [
        ['↑↓', 'select'],
        ['enter', 'open'],
        ['t', 'tenants'],
        ['p', 'principals'],
        ['g', 'grants'],
        ['n', 'new'],
        ['a', 'applies it again'],
        ['e', 'edit'],
        ['c', 'make current'],
        ['d', 'remove'],
        ['/', 'filter'],
        ['q', 'quit'],
        ['?', 'keys'],
      ]
    case 'overview':
      return [
        ['t', 'tenants'],
        ['p', 'principals'],
        ['g', 'grants'],
        ['r', 'refresh'],
        ...back,
        ['q', 'quit'],
        ['?', 'keys'],
      ]
    case 'tenants':
      return [
        ['↑↓', 'select'],
        ['p', 'its principals'],
        ['g', 'its grants'],
        ['n', 'new'],
        ['e', 'edit'],
        ['/', 'filter'],
        ...back,
        ['r', 'reload'],
        ['q', 'quit'],
        ['?', 'keys'],
      ]
    case 'principals':
      return [
        ['↑↓', 'select'],
        ['n', 'new'],
        ['g', 'its grants'],
        ['t', 'tenants'],
        ['/', 'filter'],
        ...back,
        ['r', 'reload'],
        ['q', 'quit'],
        ['?', 'keys'],
      ]
    case 'grants':
      return [
        ['↑↓', 'select'],
        ['n', 'new'],
        ['d', 'revoke'],
        ['t', 'tenants'],
        ['p', 'principals'],
        ['/', 'filter'],
        ...back,
        ['r', 'reload'],
        ['q', 'quit'],
        ['?', 'keys'],
      ]
    default:
      return [
        ['esc', 'back'],
        ['q', 'quit'],
      ]
  }
}

/**
 * The header of the interface.
 *
 * The header says where the reader is, and whether the interface is
 * at work: a page that waits for its service says so, and the reader
 * does not wonder whether the key was read.
 *
 * @param state the state of the interface.
 * @param width the number of the columns of the terminal.
 * @param color true when the header is painted.
 */
function headerOf(state: State, width: number, color: boolean): string {
  const right = state.busy
    ? 'at work… '
    : `${state.profiles.current ? `current: ${state.profiles.current}` : 'no current profile'} `
  const left = truncate(` platformctl · ${state.title}`, Math.max(1, width - right.length - 1))
  const room = Math.max(1, width - visibleLength(left) - right.length)
  return `${paint(left, 'bold', color)}${' '.repeat(room)}${paint(right, state.busy ? 'yellow' : 'dim', color)}`
}

/**
 * The lines of the status, above the bar of the keys.
 *
 * The status holds what the interface says to the reader — a question,
 * the text of the filter, a message — and, on the right, where the
 * reader is in the list. It is one line, and a message or a question
 * that is longer than the line takes the lines it needs: the reader
 * reads the end of a failure, which is where it says what to do.
 *
 * @param state the state of the interface.
 * @param width the number of the columns of the terminal.
 * @param color true when the lines are painted.
 */
function statusOf(state: State, width: number, color: boolean): string[] {
  const right = placeOf(state)
  let lines: string[] = ['']
  if (state.confirm !== undefined) {
    lines = wrapOf(`? ${state.confirm}`, width - 2, 3).map((line) =>
      paint(paint(` ${line}`, 'yellow', color), 'bold', color)
    )
  } else if (state.filtering) {
    const text = truncate(state.filter, Math.max(1, width - right.length - 12))
    lines = [
      `${paint(' filter:', 'bold', color)} ${text}${color ? paint(' ', 'inverse', color) : '▌'}`,
    ]
  } else if (state.message) {
    const kind = state.message.kind
    const mark = kind === 'error' ? '✗' : kind === 'ok' ? '✓' : '•'
    lines = wrapOf(`${mark} ${state.message.text}`, width - 2, 3).map((line) =>
      paint(` ${line}`, kind === 'error' ? 'red' : kind === 'ok' ? 'green' : 'dim', color)
    )
  } else if (state.work) {
    // The work of the interface takes a while, and the reader must see
    // that the interface is alive: the line says what the interface
    // waits for, and how long it has been waiting for it.
    lines = [paint(` ${state.work.what} · ${elapsedOf(state.work.since)}`, 'dim', color)]
  }
  // What the interface says comes before where the reader is: the
  // place in the list is drawn when the last line has the room for it.
  const last = lines[lines.length - 1] ?? ''
  const gap = width - visibleLength(last) - right.length
  if (right !== '' && gap >= 1) {
    lines[lines.length - 1] = `${last}${' '.repeat(gap)}${paint(right, 'dim', color)}`
  }
  return lines
}

/**
 * The time a work has been going on, as the reader reads it.
 *
 * The time is read in the words of the reader: seconds while the work
 * is short, and minutes when it is long. A work of two minutes and a
 * half is three minutes, and not a hundred and fifty seconds.
 *
 * @param since the moment the work began, in milliseconds.
 * @param now the moment the time is read, in milliseconds.
 */
export function elapsedOf(since: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - since) / 1000))
  if (seconds < 60) return `${seconds} ${seconds === 1 ? 'second' : 'seconds'}`
  const minutes = Math.round(seconds / 60)
  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`
}

/**
 * Where the reader is in the list, and what the list is filtered with.
 *
 * @param state the state of the interface.
 */
function placeOf(state: State): string {
  if (state.form || !LISTS.includes(state.page) || state.rows.length === 0) return ''
  const shown = visibleRows(state).length
  const place = shown === 0 ? '0' : `${Math.min(state.selection + 1, shown)}/${shown}`
  if (state.filter === '') return `${place} `
  if (state.filtering) return `${place} of ${state.rows.length} `
  return `filter “${state.filter}” · ${place} of ${state.rows.length} `
}

/**
 * The lines that describe the deployment the interface works on.
 *
 * @param state the state of the interface.
 */
export function factsOf(state: State): string[] {
  const context = state.context
  if (!context) return ['the interface works on no deployment yet']
  const lines: string[] = []
  for (const [name, value] of Object.entries({
    profile: context.name,
    gateway: context.gatewayUrl ?? '',
    control: context.controlUrl ?? '',
    access: context.accessUrl ?? '',
    workspace: context.workspaceId ?? '',
    tenant: context.tenantId ?? '',
    administrator: context.adminToken ? 'the credential is there' : 'no credential in the shell',
  })) {
    if (value === '') continue
    lines.push(`${name}: ${value}`)
  }
  return lines
}

/**
 * The lines of the probes of a deployment.
 *
 * @param state the state of the interface.
 * @param color true when the lines are painted.
 */
function probesOf(state: State, color: boolean): string[] {
  if (state.probes.length === 0) {
    return [state.busy ? 'the interface asks the deployment…' : 'the deployment did not answer yet']
  }
  return state.probes.map((probe) => {
    const status = probe.ok ? 'ok' : probe.error ? 'unreachable' : `status ${probe.status}`
    return `${probe.name.padEnd(18)} ${paint(status.padEnd(11), probe.ok ? 'green' : 'red', color)}  ${probe.url}`
  })
}

/**
 * What a list says when it has no row to show.
 *
 * A list that is empty says why, and what the reader does about it:
 * the page reads, the filter holds nothing, the page was not read, or
 * there is nothing yet and a key creates the first one.
 *
 * @param state the state of the interface.
 */
function emptyOf(state: State): string {
  if (state.rows.length > 0) return `nothing holds “${state.filter}”: esc clears the filter`
  if (!LISTS.includes(state.page)) return ''
  if (state.page === 'deployments') {
    return state.loaded ? 'this machine knows no deployment yet: n creates one' : ''
  }
  if (!state.loaded) {
    return state.busy
      ? `the interface reads ${state.title}…`
      : 'the page was not read: r reads it again'
  }
  switch (state.page) {
    case 'tenants':
      return 'the deployment has no tenant yet: n registers one'
    case 'principals':
      return 'there is no principal here yet: n registers one, and asks for its first grant'
    case 'grants':
      return 'there is no grant here yet: n gives one'
    default:
      return 'there is nothing here'
  }
}

/**
 * The value of a field of a form, as the form draws it.
 *
 * A secret is never drawn. The field the reader is in shows where the
 * reader writes, and a value that is longer than its room is drawn
 * around that place: the reader always sees the letters they type.
 *
 * @param field the field.
 * @param focused true when the reader is in the field.
 * @param cursor where the reader writes in the field.
 * @param room the number of the columns of the value.
 * @param color true when the value is painted.
 */
function shownOf(
  field: Field,
  focused: boolean,
  cursor: number,
  room: number,
  color: boolean
): string {
  if (field.kind === 'toggle') {
    const text = field.value === 'true' ? '[x] yes' : '[ ] no'
    return focused ? paint(text, 'bold', color) : text
  }
  if (field.kind === 'choice') {
    return focused ? paint(`‹ ${field.value || '—'} ›`, 'bold', color) : truncate(field.value, room)
  }
  const shown = field.secret ? '•'.repeat(field.value.length) : field.value
  if (!focused) return truncate(shown, room)
  // The value has one cell more than its letters: the cell of the
  // cursor, when the reader writes at the end.
  // What the field offers is drawn after what the reader typed, when
  // the reader writes at the end: one key takes it.
  const offer = cursor === field.value.length ? suggestionOf(field) : undefined
  const ghost = offer === undefined ? '' : offer.slice(field.value.length)
  if (ghost !== '' && color && cursor < room) {
    const rest = ghost.slice(1, Math.max(1, room - cursor))
    return `${shown}${paint(ghost.slice(0, 1), 'inverse', color)}${paint(rest, 'dim', color)}`
  }
  const cells = `${shown} `
  const start = cursor < room ? 0 : cursor - room + 1
  const before = cells.slice(start, cursor)
  const at = cells.slice(cursor, cursor + 1)
  const after = cells.slice(cursor + 1, start + room)
  if (color) return `${before}${paint(at, 'inverse', color)}${after}`
  return `${before}▌${at}${after}`.slice(0, room)
}

/**
 * The lines of a form.
 *
 * The form draws the fields around the one the reader is in, and it
 * says under them what that field is: its whole label, what the reader
 * should know about it and the values it takes.
 *
 * @param form the form.
 * @param inner the number of the columns of the lines.
 * @param height the number of the lines.
 * @param color true when the lines are painted.
 */
function formOf(form: Form, inner: number, height: number, color: boolean): string[] {
  const described = height >= 7 ? 3 : 0
  const window = windowOf(form.fields, form.focus, Math.max(1, height - described))
  const longest = Math.max(0, ...form.fields.map((field) => field.label.length))
  const labels = Math.min(longest, Math.max(12, Math.floor(inner * 0.45)))
  const room = Math.max(4, inner - labels - 4)
  const cursor = cursorOf(form)
  const lines = window.items.map((field, index) => {
    const focused = index + window.offset === form.focus
    const label = pad(truncate(field.label, labels), labels)
    const value = shownOf(field, focused, cursor, room, color)
    return `${focused ? paint('▸', 'bold', color) : ' '} ${focused ? paint(label, 'bold', color) : label}  ${value}`
  })
  if (described === 0) return lines
  while (lines.length < height - described) lines.push('')
  const field = form.fields[form.focus]
  const notes: string[] = []
  const offer = field ? suggestionOf(field) : undefined
  if (offer !== undefined) notes.push(`→ takes ${offer}`)
  if (field?.hint) notes.push(field.hint)
  if (field?.kind === 'choice' && field.choices) notes.push(`one of ${field.choices.join(', ')}`)
  lines.push(paint('─'.repeat(inner), 'dim', color))
  lines.push(field?.label ?? '')
  lines.push(paint(notes.join(' · '), 'dim', color))
  return lines
}

/**
 * The title of the panel of a form.
 *
 * @param form the form.
 */
function formTitle(form: Form): string {
  return `${form.title} · ${form.focus + 1} of ${form.fields.length}`
}

/**
 * The lines of the log: the last ones, as many as the panel holds.
 *
 * A line of the log that is wider than the panel goes on under itself:
 * the end of a line is where a failure says what to do.
 *
 * @param state the state of the interface.
 * @param width the number of the columns the panel holds.
 * @param height the number of the lines the panel holds.
 */
function logOf(state: State, width: number, height: number): string[] {
  if (state.log.length === 0) return ['the log is empty']
  const room = Math.max(1, height)
  return state.log
    .slice(-room)
    .flatMap((line) => wrapOf(line, Math.max(1, width), room))
    .slice(-room)
}

/**
 * The lines of the page the reader is on.
 *
 * @param state the state of the interface.
 * @param width the number of the columns of the page.
 * @param height the number of the rows of the page.
 * @param color true when the page is painted.
 */
function pageOf(state: State, width: number, height: number, color: boolean): string[] {
  const wide = width >= WIDE
  const leftWidth = Math.floor(width * 0.6)
  const rightWidth = width - leftWidth - 1

  if (state.page === 'help') {
    return panelOf('the keys of the interface', helpLines(), width, height, color)
  }

  if (state.form) {
    const form = state.form
    const panel = (panelWidth: number, panelHeight: number): string[] =>
      panelOf(
        formTitle(form),
        formOf(form, panelWidth - 4, panelHeight - 2, color),
        panelWidth,
        panelHeight,
        color
      )
    // The log is the log of a deployment: a form that writes a tenant
    // or a profile has nothing to say in it, and keeps the room.
    if (state.page !== 'create') return panel(width, height)
    if (wide) {
      const log = panelOf(
        'the log',
        logOf(state, rightWidth - 4, height - 2),
        rightWidth,
        height,
        color
      )
      return besideOf(panel(leftWidth, height), log, leftWidth)
    }
    const logHeight = height >= 12 ? Math.max(4, Math.floor(height * 0.35)) : 0
    return [
      ...panel(width, height - logHeight),
      ...panelOf('the log', logOf(state, width - 4, logHeight - 2), width, logHeight, color),
    ]
  }

  if (state.page === 'overview') {
    const probes = probesOf(state, color)
    const facts = factsOf(state)
    if (wide) {
      return besideOf(
        panelOf('the services of the deployment', probes, leftWidth, height, color),
        panelOf('the deployment', facts, rightWidth, height, color),
        leftWidth
      )
    }
    const top = Math.min(Math.max(3, height - 3), probes.length + 2)
    return [
      ...panelOf('the services of the deployment', probes, width, top, color),
      ...panelOf('the deployment', facts, width, height - top, color),
    ]
  }

  const rows = visibleRows(state)
  const table = (tableWidth: number, tableHeight: number): string[] => {
    const window = windowOf(rows, state.selection, Math.max(1, tableHeight - 1))
    return tableOf(
      state.columns,
      window.items.map((row) => row.cells),
      state.selection - window.offset,
      tableWidth,
      color,
      emptyOf(state)
    )
  }
  if (state.detail.length === 0 || rows.length === 0) return table(width, height)
  // The deployments of a machine are few and their addresses are long:
  // the table keeps the whole width, and the selection is under it.
  if (wide && state.page !== 'deployments') {
    return besideOf(
      table(leftWidth, height),
      panelOf('the selection', state.detail, rightWidth, height, color),
      leftWidth
    )
  }
  if (height < 8) return table(width, height)
  const bottom = Math.min(state.detail.length + 2, Math.max(4, Math.floor(height * 0.45)))
  const top = table(width, height - bottom)
  while (top.length < height - bottom) top.push('')
  return [...top, ...panelOf('the selection', state.detail, width, bottom, color)]
}

/**
 * The frame of the interface.
 *
 * @param state the state of the interface.
 * @param size the size of the terminal.
 * @param color true when the frame is painted.
 */
export function viewOf(state: State, size: Size, color: boolean): string {
  const width = size.columns
  const rows = size.rows
  const status = statusOf(state, width, color)
  const height = Math.max(1, rows - 2 - status.length)
  const lines: string[] = [headerOf(state, width, color)]
  lines.push(...pageOf(state, width, height, color).slice(0, height))
  while (lines.length < rows - 1 - status.length) lines.push('')
  lines.push(...status)
  lines.push(keybarOf(hintsOf(state), width, color))
  return frameOf(lines, width, rows)
}

/**
 * The lines of the help of the interface.
 */
export function helpLines(): string[] {
  return [
    'the lists',
    '  ↑ ↓  j k     move the selection        pgup pgdn    move by a page',
    '  home end     the first and the last    /            filter the list',
    '  enter        open what is selected     esc          clear the filter, or go back',
    '  n            create                    e            edit',
    '  d            remove or revoke          c            make the profile current',
    '  t  p  g      tenants, and the          r            read the page again',
    '               principals and grants     a            apply the deployment',
    '               of what is selected                     that is selected again',
    '  q  ctrl+c    quit                     ?            this page',
    '',
    'the forms',
    '  tab  ↓       the next field            shift+tab ↑  the field before',
    '  ← →          move in the value, or     space        change a choice, or turn',
    '               change a choice                        a yes into a no',
    '               take what a field offers',
    '  home end     the ends of the value     ctrl+u       erase the value',
    '  enter        send the form             esc          leave the form',
    '',
    'the credentials of the administration, of the control plane and of the',
    'caller are read from the environment of the shell, and a profile never',
    'holds them.',
  ]
}
