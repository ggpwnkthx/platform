/**
 * The terminal the operator sits at: questions, notes and waits, drawn with @clack/prompts.
 *
 * Everything here is written to stderr: a command's own output — a manifest, a token — is
 * the only thing on stdout, so that it can be piped. When stderr is not a terminal nothing
 * is drawn at all: a note is a plain line, and a wait is silent.
 */
export { Cancelled, type Choice, type NoteKind, type Waiting } from './terminal/types.ts'
export { ask, choose, confirm } from './terminal/questions.ts'
export { note, show, waiting } from './terminal/notes.ts'
export { task, tasks } from './terminal/tasks.ts'
export { begin, close, drawn, end } from './terminal/run.ts'
export { report, result } from './terminal/result.ts'
