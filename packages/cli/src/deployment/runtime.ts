import { join, resolve } from 'node:path'
import * as terminal from '../terminal.ts'
import { ensureHosts } from './hosts.ts'
import { lines, noise, said } from './runtime/output.ts'
import type { DeployRuntime } from './runtime/types.ts'

// The repository's root: the deployments, the migrations and the packages live there.
export const ROOT = resolve(import.meta.dir, '../../../..')

export { generate, saved } from './runtime/saved.ts'
export { noExtra, option, seconds } from './runtime/options.ts'
export type { DeployRuntime, RunOptions } from './runtime/types.ts'

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
    // fallow-ignore-next-line security-sink -- the address is the deployment's own, from its configuration
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
