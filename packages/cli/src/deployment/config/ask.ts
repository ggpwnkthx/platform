import { randomBytes } from 'node:crypto'
import type { DeployRuntime } from '../runtime.ts'
import { saved } from '../runtime.ts'
import type { Setting } from './setting.ts'
import { checked, problem } from './write.ts'

/** A secret nobody chose: generated once, and never printed. */
function aSecret(): string {
  return randomBytes(24).toString('base64url')
}

/**
 * What is already known of a setting: the command line, the environment, the saved file.
 *
 * Bun loads the file into the environment, so the same value in both is the file's own
 * and not an override: the environment only speaks when it says something else.
 *
 * A value that is computed is never read from the file: it is made of the pieces the file
 * holds, and the pieces are what may be changed.
 */
export function knownValue(
  setting: Setting,
  given: Record<string, string | undefined>,
  envFile: string,
  env: Record<string, string | undefined>
): string | undefined {
  const fromFile = saved(envFile, setting.name)
  const fromEnv = given[setting.name] ?? env[setting.name]
  if (fromEnv && fromEnv !== fromFile) return fromEnv
  if (setting.follows) return undefined
  return fromFile
}

/**
 * Asks for the settings that are the operator's to decide: what the deployment needs and
 * does not know yet. A setting that does not apply to this deployment is not asked for,
 * and keeps no value. A secret is made rather than asked for. A setting with no answer at
 * all is missing, and nothing is written.
 */
export async function askFor(
  settings: Setting[],
  answers: Record<string, string>,
  missing: string[],
  r: DeployRuntime,
  question: (setting: Setting) => string
): Promise<void> {
  for (const setting of settings.filter((s) => !s.follows)) {
    const already = answers[setting.name]
    if (already) {
      checked(setting, already)
      continue
    }
    // A setting that does not apply to this deployment is not asked for: it keeps no
    // value, and nothing is written for it.
    if (setting.when && !setting.when(answers)) continue
    if (setting.secret) {
      // Nobody is asked for a password: one is generated, and it is saved where it can be
      // read by the person who needs it.
      answers[setting.name] = aSecret()
      r.note(`Generated ${setting.name}.`)
      continue
    }
    // A fallback may be worked out from what has been answered already: the domain is
    // asked for first, and the site's address follows from it.
    const fallback =
      typeof setting.fallback === 'function' ? setting.fallback(answers) : setting.fallback
    if (fallback === undefined) {
      // No default at all: the answer is required.
      if (!r.interactive) {
        missing.push(setting.name)
        continue
      }
      // An answer the check refuses is asked for again; none at all is asked for again too.
      const answer = await r.ask(setting.name, question(setting), '', (value) =>
        value ? problem(setting, value) : `${setting.name} is required: it has no default`
      )
      if (!answer) {
        missing.push(setting.name)
        continue
      }
      answers[setting.name] = answer
      checked(setting, answer)
      continue
    }
    if (fallback === '') {
      // An empty default is a question whose answer may be empty: what is not answered
      // is worked out from the other settings afterwards.
      if (!r.interactive) answers[setting.name] = ''
      else if (setting.choices)
        answers[setting.name] = await r.choose(
          setting.name,
          question(setting),
          setting.choices(),
          ''
        )
      else
        answers[setting.name] = await r.ask(setting.name, question(setting), '', (value) =>
          value ? problem(setting, value) : undefined
        )
      continue
    }
    answers[setting.name] = r.interactive
      ? await r.ask(setting.name, question(setting), fallback, (value) => problem(setting, value))
      : fallback
    checked(setting, answers[setting.name]!)
  }
}

/**
 * The settings that follow from the others: they are worked out, never asked for, and
 * never written down. The file holds the pieces they are made of.
 */
export function follow(
  settings: Setting[],
  answers: Record<string, string>,
  missing: string[]
): void {
  for (const setting of settings.filter((s) => s.follows)) {
    // A setting that does not apply to this deployment is not missing either.
    if (setting.when && !setting.when(answers)) continue
    const followed = answers[setting.name] ?? setting.follows!(answers)
    if (followed === undefined) {
      missing.push(setting.name)
      continue
    }
    // The value is kept as it is worked out, so that the ones that follow from it can.
    answers[setting.name] = followed
    checked(setting, followed)
  }
}

/**
 * What was answered is shown with what follows from it, before any of it is kept: a wrong
 * domain is seen here, and not in a file the next run would trust. False when the
 * operator does not want it written.
 */
export async function confirmWriting(
  r: DeployRuntime,
  settings: Setting[],
  added: Setting[],
  answers: Record<string, string>,
  name: string
): Promise<boolean> {
  const follows = settings.filter((setting) => setting.follows && answers[setting.name])
  const width = Math.max(...[...added, ...follows].map((setting) => setting.name.length))
  const line = (setting: Setting) =>
    `${setting.name.padEnd(width)}  ${setting.secret ? '(generated)' : answers[setting.name]}`
  r.show(
    `What is added to ${name}`,
    [
      ...added.map(line),
      ...(follows.length ? ['', 'What follows from it, and is not kept:'] : []),
      ...follows.map(line),
    ].join('\n')
  )
  return r.confirm('write', `Write ${r.envFile}?`, true)
}
