/** How the deploy commands reach the outside world: processes, files and time. */
import { randomBytes } from 'node:crypto'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import * as terminal from '../terminal.ts'
import { ensureHosts } from './hosts.ts'

// The repository's root: the deployments, the migrations and the packages live there.
export const ROOT = resolve(import.meta.dir, '../../../..')

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
export const runtime: DeployRuntime = {
  async run(argv, options = {}) {
    if (options.task && !options.quiet && terminal.drawn()) {
      const task = terminal.task(options.task.doing)
      const child = Bun.spawn(argv, {
        cwd: ROOT,
        env: options.env ?? process.env,
        stdin: options.input === undefined ? 'ignore' : new Blob([options.input]),
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const all: string[] = []
      const line = (text: string) => {
        const kept = said(text)
        if (!kept) return
        all.push(kept)
        task.line(kept)
      }
      await Promise.all([lines(child.stdout, line), lines(child.stderr, line)])
      const code = await child.exited
      const done = options.task.done
      if (code) task.fail(`${options.task.doing} failed`)
      else task.done(typeof done === 'function' ? done(all) : done)
      return code
    }
    if (options.report && terminal.drawn()) {
      const child = Bun.spawn(argv, {
        cwd: ROOT,
        env: options.env ?? process.env,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const kept: string[] = []
      const line = (text: string) => {
        // Compose names the service before each of its lines: the title has said it.
        if (!noise(text)) kept.push(text.trimEnd().replace(/^\[[\w.-]+\]\s*\|\s?/, ''))
      }
      await Promise.all([lines(child.stdout, line), lines(child.stderr, line)])
      terminal.report(options.report, kept)
      return child.exited
    }
    if (options.report) terminal.note(options.report)
    const child = Bun.spawn(argv, {
      cwd: ROOT,
      env: options.env ?? process.env,
      stdin: options.input === undefined ? 'inherit' : new Blob([options.input]),
      stdout: options.quiet ? 'ignore' : 'inherit',
      stderr: options.quiet ? 'ignore' : 'inherit',
    })
    return child.exited
  },
  async together(task, jobs, options = {}) {
    if (!terminal.drawn()) {
      for (const job of jobs) {
        const code = await runtime.run(job.argv, options)
        if (code) return code
      }
      return 0
    }
    const all = terminal.tasks(task.doing)
    const codes = await Promise.all(
      jobs.map(async (job) => {
        const part = all.part(job.name)
        const child = Bun.spawn(job.argv, {
          cwd: ROOT,
          env: options.env ?? process.env,
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
        })
        const line = (text: string) => {
          const kept = said(text)
          if (kept) part.line(kept)
        }
        await Promise.all([lines(child.stdout, line), lines(child.stderr, line)])
        const code = await child.exited
        if (code) part.fail(`${job.name} failed`)
        else part.done(job.done)
        return code
      })
    )
    const failed = codes.find((code) => code !== 0) ?? 0
    if (failed) all.fail(`${task.doing} failed`)
    else all.done(task.done)
    return failed
  },
  which: Bun.which,
  env: process.env,
  envFile: process.env.PLATFORM_ENV_FILE ?? join(ROOT, '.env'),
  print: console.log,
  sleep: async (ms) => {
    await Bun.sleep(ms)
  },
  healthy: async (url) =>
    fetch(url, { signal: AbortSignal.timeout(2000) }).then(
      (r) => r.ok,
      () => false
    ),
  hash: (password) => Bun.password.hash(password, { algorithm: 'bcrypt', cost: 10 }),
  interactive: Boolean(process.stdin.isTTY),
  hosts: async (names: string[]) => ensureHosts(names, runtime),
  note: terminal.note,
  // The questions are asked on stderr: a deployment's own output is for the deployment.
  ask: async (_name, question, fallback, check) => terminal.ask(question, fallback, check),
  choose: async (_name, question, choices, fallback) =>
    terminal.choose(question, choices, fallback),
  confirm: async (_name, question, fallback) => terminal.confirm(question, fallback),
  begin: terminal.begin,
  show: terminal.show,
  waiting: terminal.waiting,
  done: (message) => terminal.end(message),
  result(title, rows, next) {
    if (terminal.drawn()) return terminal.result(title, rows, next)
    const width = Math.max(...rows.map(([name]) => name.length))
    runtime.print(
      [title, ...rows.map(([name, value]) => `  ${name.padEnd(width)}  ${value}`), ...next].join(
        '\n'
      )
    )
  },
}
/**
 * What nobody reads in a build's output: the identifiers of the layers and of the images,
 * and the word Podman has about the Compose provider it runs.
 */
function noise(line: string): boolean {
  const text = line.trim()
  return (
    !text ||
    text.startsWith('-->') ||
    /^(sha256:)?[0-9a-f]{12,64}$/.test(text) ||
    text.startsWith('>>>> Executing external compose provider')
  )
}
/** A line of a build as it is shown: none for noise, and a step cut to the terminal's width. */
function said(line: string): string | undefined {
  if (noise(line)) return undefined
  const text = line.trim()
  // Only a step is cut: it repeats the Dockerfile. An error is shown whole.
  const step = /^(\[\d+\/\d+\] STEP \d+\/\d+:|#\d+ \[)/.test(text)
  const width = Math.max(40, (process.stderr.columns ?? 80) - 8)
  return step && text.length > width ? `${text.slice(0, width - 1)}…` : text
}
/** Hands what a process says to a reader, a line at a time. A carriage return ends a line too. */
async function lines(stream: ReadableStream<Uint8Array>, each: (line: string) => void) {
  const decoder = new TextDecoder()
  let rest = ''
  for await (const chunk of stream) {
    const parts = (rest + decoder.decode(chunk, { stream: true })).split(/\r?\n|\r/)
    rest = parts.pop() ?? ''
    for (const part of parts) if (part.trim()) each(part)
  }
  if (rest.trim()) each(rest)
}
export function option(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`
  const at = args.findIndex((a) => a === `--${name}` || a.startsWith(prefix))
  if (at < 0) return undefined
  const arg = args.splice(at, 1)[0]!
  const value = arg.startsWith(prefix) ? arg.slice(prefix.length) : args.splice(at, 1)[0]
  if (!value || value.startsWith('--')) throw new Error(`--${name} needs a value`)
  if (args.some((a) => a === `--${name}` || a.startsWith(prefix)))
    throw new Error(`Repeated --${name}`)
  return value
}
export function seconds(value: string | undefined): number {
  const n = Number(value ?? 120)
  if (!Number.isInteger(n) || n < 1 || n > 1800) throw new Error('--timeout must be 1–1800 seconds')
  return n
}
export function noExtra(args: string[]) {
  if (args.length) throw new Error(`Unexpected arguments: ${args.join(' ')}`)
}

/** The value a dotenv file gives a name; the last assignment wins, as it does for Compose. */
export function saved(file: string, name: string): string | undefined {
  if (!existsSync(file)) return undefined
  let value: string | undefined
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (m?.[1] === name) value = m[2]!.replace(/^(['"])(.*)\1$/, '$2')
  }
  return value || undefined
}
/** Appends a value to the saved file, which is private to its owner. */
function save(name: string, value: string, r: DeployRuntime) {
  const text = existsSync(r.envFile) ? readFileSync(r.envFile, 'utf8') : ''
  appendFileSync(r.envFile, `${text && !text.endsWith('\n') ? '\n' : ''}${name}=${value}\n`, {
    mode: 0o600,
  })
}
/** A required value nobody supplied is generated once and saved, never printed. */
export function generate(name: string, r: DeployRuntime): string {
  const value = randomBytes(24).toString('base64url')
  save(name, value, r)
  r.print(`Generated ${name} and saved it in ${r.envFile}.`)
  return value
}
