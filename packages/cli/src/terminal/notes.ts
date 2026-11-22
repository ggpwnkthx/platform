import { log, note as box, spinner } from '@clack/prompts'
import { styleText } from 'node:util'
import { common, drawn, insideRun } from './run.ts'
import type { NoteKind, Waiting } from './types.ts'

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
      if (!insideRun()) return turning.stop(message)
      turning.clear()
      // The spinner left its own space above: the line that replaces it adds none.
      log.success(`${message}${took()}`, { ...common(), spacing: 0 })
    },
    fail(message) {
      if (!insideRun()) return turning.error(message)
      turning.clear()
      log.error(`${message}${took()}`, { ...common(), spacing: 0 })
    },
  }
}
