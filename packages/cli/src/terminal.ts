/**
 * The terminal the operator sits at: questions, notes and waits, drawn with @clack/prompts.
 *
 * Everything here is written to stderr: a command's own output — a manifest, a token — is
 * the only thing on stdout, so that it can be piped. When stderr is not a terminal nothing
 * is drawn at all: a note is a plain line, and a wait is silent.
 */
import { styleText } from 'node:util'
import {
  cancel,
  confirm as clackConfirm,
  intro,
  isCancel,
  log,
  note as box,
  outro,
  select,
  spinner,
  taskLog,
  text,
} from '@clack/prompts'

/** The operator left a question unanswered: Ctrl-C or Escape. Nothing is written after it. */
export class Cancelled extends Error {
  constructor() {
    super('Cancelled.')
    this.name = 'Cancelled'
  }
}

export type NoteKind = 'info' | 'success' | 'warn' | 'error' | 'step'
export type Choice = { value: string; label: string; hint?: string }
export type Waiting = { done(text: string): void; fail(text: string): void }
export type Task = { line(text: string): void; done(text: string): void; fail(text: string): void }
/** Several things that talk while they work, at once: each has its own lines. */
export type Tasks = { part(name: string): Task; done(text: string): void; fail(text: string): void }

const output = process.stderr
/** Whether there is a terminal to draw on. */
export const drawn = () => Boolean(output.isTTY)
/**
 * How many runs are open, one inside the other: a command, and the questions it asks. While
 * one is, every line is joined to the next by a guide down the left.
 */
let depth = 0
const common = () => ({ output, withGuide: depth > 0 })

function answered<T>(answer: T): Exclude<T, symbol> {
  if (isCancel(answer)) {
    cancel('Cancelled.', common())
    depth = 0
    throw new Cancelled()
  }
  return answer as Exclude<T, symbol>
}

/**
 * Opens a run under a title: a command, or the questions it asks. What follows belongs to
 * it. A run inside another is a step of it, and not a new beginning.
 */
export function begin(title: string) {
  if (!drawn()) return
  if (depth++ === 0) intro(title, { output })
  else log.step(title, common())
}

/** Closes the run that was opened last. The outermost one ends the guide, with a last word. */
export function end(message?: string) {
  if (depth === 0) return
  if (--depth === 0) outro(message, { output })
}

/** Closes every run that is open: what a command does when it fails. */
export function close() {
  if (depth === 0) return
  depth = 0
  outro(undefined, { output })
}

/**
 * Asks for a line of text. An empty answer is the fallback, which is shown in the question's
 * place; an answer the check refuses is asked for again, with the problem under it.
 */
export async function ask(
  question: string,
  fallback: string,
  check?: (value: string) => string | undefined
): Promise<string> {
  const answer = answered(
    await text({
      ...common(),
      message: question,
      placeholder: fallback || undefined,
      defaultValue: fallback,
      validate: (value) => check?.(value?.trim() || fallback),
    })
  )
  return answer.trim() || fallback
}

/** Asks for one of a few answers. */
export async function choose(
  question: string,
  choices: Choice[],
  fallback: string
): Promise<string> {
  return answered(
    await select({ ...common(), message: question, options: choices, initialValue: fallback })
  )
}

/** Asks a question whose answer is yes or no. The fallback is the answer Enter alone gives. */
export async function confirm(question: string, fallback = false): Promise<boolean> {
  return answered(await clackConfirm({ ...common(), message: question, initialValue: fallback }))
}

/** Shows a few lines under a title, set apart from the rest: what is about to be done. */
export function show(title: string, lines: string) {
  if (!drawn()) {
    console.error(`${title}\n${lines}`)
    return
  }
  // The lines are shown as they are: the names in them are not to be dimmed.
  box(lines, title, { ...common(), format: (line) => line })
}

/** A word about what is being done. */
export function note(message: string, kind: NoteKind = 'info') {
  if (!drawn()) {
    console.error(message)
    return
  }
  log[kind](message, common())
}

/** Something that takes a while: a spinner turns until it is done, or has failed. */
export function waiting(label: string): Waiting {
  if (!drawn()) return { done: () => undefined, fail: () => undefined }
  // The time it has taken is shown beside it: a wait is easier when it is counted.
  const turning = spinner({ ...common(), indicator: 'timer' })
  const started = Date.now()
  turning.start(label)
  // It ends as every other step does, with the same mark: only a wait worth counting says
  // how long it was.
  const took = () => {
    const seconds = Math.round((Date.now() - started) / 1000)
    if (seconds < 1) return ''
    const time = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
    return ` ${styleText('dim', time)}`
  }
  return {
    done(message) {
      // On its own, outside a run, the spinner's own last line is the one with a mark.
      if (depth === 0) return turning.stop(message)
      turning.clear()
      // The spinner left its own space above: the line that replaces it adds none.
      log.success(`${message}${took()}`, { ...common(), spacing: 0 })
    },
    fail(message) {
      if (depth === 0) return turning.error(message)
      turning.clear()
      log.error(`${message}${took()}`, { ...common(), spacing: 0 })
    },
  }
}

/**
 * What a command leaves behind: a few names and what they are, set apart, and what to do
 * next under them.
 */
export function result(title: string, rows: [string, string][], next: string[]) {
  const width = Math.max(...rows.map(([name]) => name.length))
  box(rows.map(([name, value]) => `${name.padEnd(width)}  ${value}`).join('\n'), title, {
    ...common(),
    format: (line) => line,
  })
  if (next.length)
    log.message(
      next.map((line) => `${styleText('dim', '•')} ${line}`),
      common()
    )
}

/**
 * Something that talks while it works, such as a build: its last lines are shown while it
 * runs, and are taken away when it is done. When it fails, everything it said stays.
 */
export function task(label: string): Task {
  const shown = taskLog({ ...common(), title: label, limit: 8, retainLog: true })
  return {
    line: (message) => shown.message(message),
    done: (message) => shown.success(message),
    fail: (message) => shown.error(message, { showLog: true }),
  }
}

/**
 * Several of them at once, such as the builds of a stack's images: each part keeps its own
 * last lines under its name, and is a single line once it is done. When one fails,
 * everything that was said stays, under the part that said it.
 */
export function tasks(label: string): Tasks {
  const shown = taskLog({ ...common(), title: label, limit: 3, retainLog: true })
  return {
    part(name) {
      const part = shown.group(name)
      return {
        line: (message) => part.message(message),
        done: (message) => part.success(message),
        fail: (message) => part.error(message),
      }
    },
    done: (message) => shown.success(message),
    fail: (message) => shown.error(message, { showLog: true }),
  }
}

/** What something said, shown under a title: the log of a service that did not start. */
export function report(title: string, lines: string[]) {
  if (!drawn()) {
    console.error([title, ...lines].join('\n'))
    return
  }
  // Always with its mark and its rule: it is read apart from what surrounds it.
  log.warn(title, { output, withGuide: true })
  log.message(lines.length ? lines.join('\n') : '(nothing)', { output, withGuide: true })
}
