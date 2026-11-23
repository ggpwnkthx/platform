import * as say from '@clack/prompts'
import { ROOT } from '../site.ts'
import type { Answers } from './settings.ts'

export async function sh(
  argv: string[],
  options: { env?: Record<string, string | undefined>; quiet?: boolean; input?: string } = {}
): Promise<number> {
  const child = Bun.spawn(argv, {
    cwd: ROOT,
    env: options.env ?? process.env,
    stdin: options.input === undefined ? 'inherit' : new Blob([options.input]),
    stdout: options.quiet ? 'ignore' : 'inherit',
    stderr: options.quiet ? 'ignore' : 'inherit',
  })
  return child.exited
}
/** The `--name=value` arguments a command takes, and the rest it passes on. */
export const flags = (args: string[], known: string[]) => {
  const values: Answers = {}
  const rest: string[] = []
  for (const arg of args) {
    const [, key, value] = /^--([\w-]+)=(.*)$/.exec(arg) ?? []
    if (key && known.includes(key)) values[key] = value!
    else rest.push(arg)
  }
  return { values, rest }
}
/** Waits for a service to answer, and says plainly when it does not. */
export async function until(what: string, seconds: number, check: () => Promise<boolean>) {
  const waiting = say.spinner()
  waiting.start(`Waiting for ${what}`)
  for (const deadline = Date.now() + seconds * 1000; Date.now() < deadline; await Bun.sleep(1000))
    if (await check().catch(() => false)) return waiting.stop(`${what} is ready`)
  waiting.stop(`No answer from ${what} after ${seconds}s`)
  throw new Error(`${what} did not become ready. \`deploy local logs\` says what it said.`)
}
export const step = async (doing: string, code: Promise<number>) => {
  say.log.step(doing)
  if (await code) throw new Error(`${doing} failed`)
}
