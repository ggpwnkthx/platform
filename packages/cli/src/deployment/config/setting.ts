import type { Choice } from '../../terminal.ts'

/** One setting of a deployment: what it is called, what it says, and what it must look like. */
export type Setting = {
  /** The name it has in the file and in the environment. */
  name: string
  /** What the setting is, in words: what the file says about it. */
  note: string
  /** What the operator is asked: the setting in a few words. The note, when there is none. */
  question?: string
  /** The value used when there is no answer. Without it the setting is required. */
  fallback?: string | ((answers: Record<string, string>) => string)
  /**
   * Whether the setting is asked for at all: the question holds when this says so. A
   * setting that is not asked for and is not known keeps no value, which is not the same
   * as a missing one: nothing is written for it and nothing is asked.
   */
  when?: (answers: Record<string, string>) => boolean
  /** A secret: never printed, and generated when there is no answer. */
  secret?: boolean
  /** How the value is checked. A problem is reported and nothing is written. */
  check?: (value: string) => string | undefined
  /**
   * The answers there are, when there are only a few: the operator picks one of them
   * instead of typing it.
   */
  choices?: () => Choice[]
  /**
   * The value that follows from the others: the issuer of a deployment is the identity
   * provider on its own sub-domain, the relay answers on the sub-domain of the API,
   * PostgreSQL on the sub-domain of the database. Nothing is asked about a setting that
   * follows from another.
   *
   * A value that follows is computed, not kept: it is never written to the file, and the
   * file's value for it is ignored, because the file holds the pieces it is made of. The
   * environment and the command line may still override it.
   */
  follows?: (answers: Record<string, string>) => string | undefined
}
