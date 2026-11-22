/**
 * The configuration of a deployment: the settings it needs, in one file, kept out of git.
 *
 * There is no configuration file in a checkout — a deployment's settings are its own — so the
 * first run asks for what it does not know and writes the answers down. The file holds
 * secrets: the password the local stack's Dex asks the break-glass administrator for. It is
 * written
 * for its owner alone, and it is ignored by git, so it is never committed.
 */
import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import { Cancelled } from '../terminal.ts'
import { type DeployRuntime, saved } from './runtime.ts'
import { askFor, confirmWriting, follow, knownValue } from './config/ask.ts'
import { computed } from './config/computed.ts'
import { settingsKubernetes } from './config/settings-kubernetes.ts'
import { settingsLocal } from './config/settings-local.ts'
import { ignoreInGit, removeComputed, writeSettings } from './config/write.ts'

/**
 * The configuration of a deployment, written when it is missing something.
 *
 * A checkout has no configuration file: a deployment's settings are its own. The first run
 * asks for what it does not know — the ones already given on the command line, in the
 * environment or in the saved file are kept — and writes the answers down with the secrets
 * it generated. A file that is already there is not rewritten: the settings it lacks are
 * added to it, and the entries it holds are left alone.
 *
 * Nothing is written when a value is wrong, or when a setting that has no default could not
 * be answered: the deployment then fails with the error that names what is missing.
 */
export async function ensureConfig(
  target: 'local' | 'k8s',
  given: Record<string, string | undefined>,
  r: DeployRuntime
): Promise<void> {
  const settings = target === 'local' ? settingsLocal() : settingsKubernetes()
  const name = basename(r.envFile)
  const answers: Record<string, string> = {}
  const missing: string[] = []
  // Why the questions are asked is said before the first of them, and only if there is one.
  let asking = false
  const question = (setting: (typeof settings)[number]) => {
    if (!asking)
      r.begin(
        existsSync(r.envFile)
          ? `Configuration: ${name} lacks some of the settings of this deployment`
          : `Configuration: no ${name} was found, so one is written from your answers`
      )
    asking = true
    return setting.question ?? setting.note
  }
  try {
    // The values the tool computes now are taken out of the file first: they are made of
    // the pieces it holds, and the pieces are what may be changed. What the file holds is
    // read before they are taken out, so that the site's address is known.
    const pieces: Record<string, string> = {}
    for (const setting of settings) {
      if (setting.follows) continue
      const value =
        saved(r.envFile, setting.name) ??
        (typeof setting.fallback === 'string' ? setting.fallback : undefined)
      if (value) pieces[setting.name] = value
    }
    const computedNames = settings.filter((s) => s.follows).map((s) => s.name)
    const siteUrl = computed(settings, pieces).PLATFORM_SITE_URL
    const removed = removeComputed(
      r.envFile,
      [...computedNames, 'PLATFORM_PUBLIC_URL', 'PUBLIC_URL'],
      (name, value) => computedNames.includes(name) || (siteUrl !== undefined && value === siteUrl)
    )
    if (removed.length) {
      // The environment holds the file's own values, and they are not there any more.
      for (const name of removed) delete r.env[name]
      r.note(
        `Configuration: took ${removed.join(', ')} out of ${name}: ${removed.length === 1 ? 'it is' : 'they are'} computed from the domain and the names now.`
      )
    }
    // What is already known is kept: the values that follow are worked out from it.
    for (const setting of settings) {
      const value = knownValue(setting, given, r.envFile, r.env)
      if (value) answers[setting.name] = value
    }
    // The settings that are asked for first: what the operator decides.
    await askFor(settings, answers, missing, r, question)
    // The settings that follow from the ones above: they are worked out, never asked for,
    // and never written down: the file holds the pieces they are made of.
    follow(settings, answers, missing)
    computed(settings, answers)
    if (missing.length) {
      r.note(
        `Configuration: ${missing.join(', ')} ${missing.length === 1 ? 'was' : 'were'} not given, so no ${name} was written. Give ${missing.length === 1 ? 'it' : 'them'} on the command line.`
      )
      return
    }
    // What the deployment now knows that the file does not: the settings that are added.
    // A computed value is not one of them: it is not kept.
    const added = settings.filter(
      (setting) => !setting.follows && answers[setting.name] && !saved(r.envFile, setting.name)
    )
    if (!added.length) return
    if (asking) {
      // What was answered is shown with what follows from it, before any of it is kept: a
      // wrong domain is seen here, and not in a file the next run would trust.
      if (!(await confirmWriting(r, settings, added, answers, name))) {
        r.note('Configuration: nothing was written.', 'warn')
        throw new Cancelled()
      }
    } else
      r.note(
        existsSync(r.envFile)
          ? `Configuration: ${name} is missing ${added.length} of the settings of this deployment; they are added now.`
          : `Configuration: no ${name} was found, so one is written. It holds secrets: only you read it.`
      )
    ignoreInGit(r.envFile, r)
    writeSettings(r, added, answers)
  } finally {
    r.done()
  }
}

export { computedValues, settingValue } from './config/computed.ts'
export { examplesIn, siteFolder } from './config/site.ts'
