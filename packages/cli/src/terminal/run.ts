import { cancel, intro, isCancel, log, outro } from '@clack/prompts'
import { Cancelled } from './types.ts'

export const output = process.stderr

/** Whether there is a terminal to draw on. */
export const drawn = () => Boolean(output.isTTY)

/**
 * How many runs are open, one inside the other: a command, and the questions it asks. While
 * one is, every line is joined to the next by a guide down the left.
 */
let depth = 0

export const common = () => ({ output, withGuide: depth > 0 })

/** Whether a run is open: what is drawn joins itself to it. */
export const insideRun = () => depth > 0

export function answered<T>(answer: T): Exclude<T, symbol> {
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
