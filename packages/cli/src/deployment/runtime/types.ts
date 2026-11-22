import type * as terminal from '../../terminal.ts'

export type RunOptions = {
  env?: Record<string, string | undefined>
  quiet?: boolean
  input?: string
  /**
   * What the command is doing, and what to say when it is done. At a terminal its output is
   * then kept to its last lines and taken away when it succeeds; it stays when it fails.
   */
  task?: { doing: string; done: string | ((said: string[]) => string) }
  /**
   * A title for what the command says: its output is then shown under it, apart from the
   * rest. For the log of a service that did not start.
   */
  report?: string
}
/** One of several commands that run together: what it is called, and what to say when done. */
export type Job = { name: string; argv: string[]; done: string }
export type DeployRuntime = {
  run(argv: string[], options?: RunOptions): Promise<number>
  /**
   * Runs several commands as one piece of work, and returns the first failure. At a terminal
   * they run at once, each with its own lines; elsewhere one after the other, as they are.
   */
  together(
    task: { doing: string; done: string },
    jobs: Job[],
    options?: RunOptions
  ): Promise<number>
  which(name: string): string | null
  env: Record<string, string | undefined>
  /** Where the settings of the deployment are kept, so that later runs find the same ones. */
  envFile: string
  print(text: string): void
  sleep(ms: number): Promise<void>
  healthy(url: string): Promise<boolean>
  /** A bcrypt hash, the form Dex keeps a local password in. */
  hash(password: string): Promise<string>
  /** Whether the operator can be asked: a terminal is there to answer. */
  interactive: boolean
  /** Makes the deployment's names answer on this machine. */
  hosts(names: string[]): Promise<void>
  /** A word about what is being done: not the deployment's own output, which stays clean. */
  note(text: string, kind?: terminal.NoteKind): void
  /**
   * Asks one question about a setting, and returns the answer: the fallback when there is
   * none. An answer the check finds a problem with is asked for again.
   */
  ask(
    name: string,
    question: string,
    fallback: string,
    check?: (value: string) => string | undefined
  ): Promise<string>
  /** Asks for one of a few answers about a setting. */
  choose(
    name: string,
    question: string,
    choices: terminal.Choice[],
    fallback: string
  ): Promise<string>
  /** Asks a question whose answer is yes or no: the fallback when Enter is all that is typed. */
  confirm(name: string, question: string, fallback?: boolean): Promise<boolean>
  /** Opens the questions of a run, under a title that says why they are asked. */
  begin(title: string): void
  /** Shows a few lines under a title: what is about to be done, before it is. */
  show(title: string, lines: string): void
  /** Says that something is being waited for, until it is done or has failed. */
  waiting(label: string): terminal.Waiting
  /** Ends the run that was begun last, with a last word when it is the command's own. */
  done(message?: string): void
  /**
   * What the command leaves behind: a few names and what they are, and what to do next. At a
   * terminal it is set apart; elsewhere it is the command's output, as plain lines.
   */
  result(title: string, rows: [string, string][], next: string[]): void
}
