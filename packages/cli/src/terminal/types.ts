/**
 * The terminal the operator sits at: questions, notes and waits, drawn with @clack/prompts.
 *
 * Everything here is written to stderr: a command's own output — a manifest, a token — is
 * the only thing on stdout, so that it can be piped. When stderr is not a terminal nothing
 * is drawn at all: a note is a plain line, and a wait is silent.
 */

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
