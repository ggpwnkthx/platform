import { appendFileSync, chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import ignore from 'ignore'
import type { DeployRuntime } from '../runtime.ts'
import type { Setting } from './setting.ts'

/**
 * The file is completed, not rewritten: what it holds is left alone, and what the
 * deployment knows besides it is added.
 */
export function writeSettings(
  r: DeployRuntime,
  added: Setting[],
  answers: Record<string, string>
): void {
  const fresh = !existsSync(r.envFile)
  const existing = fresh ? '' : readFileSync(r.envFile, 'utf8')
  const lines: string[] = []
  if (fresh)
    lines.push(
      '# The settings of this deployment, written by `bun run cli deploy`.',
      '# It holds secrets: the password Dex asks the break-glass administrator for. It is',
      '# kept out of git and readable only by you.',
      ''
    )
  for (const setting of added) {
    const value = answers[setting.name]
    if (value === undefined) continue
    lines.push(`# ${setting.note}.`)
    lines.push(`${setting.name}=${written(value)}`)
    lines.push('')
  }
  try {
    appendFileSync(
      r.envFile,
      `${existing && !existing.endsWith('\n') ? '\n' : ''}${lines.join('\n')}`,
      { mode: 0o600 }
    )
    chmodSync(r.envFile, 0o600)
  } catch (error) {
    throw new Error(
      `The configuration could not be written to ${r.envFile}: ${(error as Error).message}`
    )
  }
  for (const [key, value] of Object.entries(answers)) r.env[key] = value
  r.note(`Configuration: wrote ${r.envFile}, for you alone.`, 'success')
}

/**
 * Checks a value as soon as it is known. A file with a wrong value in it is worse than no
 * file, because the next run would read it and trust it: so nothing is written when a value
 * is wrong, and the error names the setting that is.
 */
export function checked(setting: Setting, value: string) {
  const found = problem(setting, value)
  if (found) throw new Error(found)
}
/** What is wrong with a value, in the words the operator is told: nothing when it is right. */
export function problem(setting: Setting, value: string): string | undefined {
  const found = setting.check?.(value)
  return found ? `${setting.name} ${found}` : undefined
}

/** A value, written the way a dotenv file is read: quoted when it would not survive bare. */
function written(value: string): string {
  if (/^[\w./:@+-]+$/.test(value)) return value
  // One kind of quote is enough for a value to survive being read back as it is.
  if (!/['"\n\r]/.test(value)) return `'${value}'`
  if (!/["\n\r]/.test(value)) return `"${value}"`
  throw new Error('A value with both kinds of quote cannot be written to the configuration')
}

/** Whether git ignores a file: what git says, and what the ignore file says when git cannot. */
function ignoredByGit(file: string): boolean | null {
  const git = Bun.which('git')
  if (git) {
    const checked = Bun.spawnSync([
      git,
      '-C',
      dirname(file),
      'check-ignore',
      '-q',
      '--',
      basename(file),
    ])
    if (checked.exitCode === 0) return true
    if (checked.exitCode === 1) return false
  }
  // Git could not answer: the ignore file beside the file is what is read instead, and it
  // is read as git reads it.
  const ignoreFile = join(dirname(file), '.gitignore')
  if (!existsSync(ignoreFile)) return false
  const patterns = readFileSync(ignoreFile, 'utf8')
  return ignore().add(patterns).ignores(basename(file))
}

/** Keeps a file that holds secrets out of git, and says that it did. */
export function ignoreInGit(file: string, r: DeployRuntime): boolean {
  if (ignoredByGit(file) !== false) return true
  const ignoreFile = join(dirname(file), '.gitignore')
  const text = existsSync(ignoreFile) ? readFileSync(ignoreFile, 'utf8') : ''
  const addition = `${text && !text.endsWith('\n') ? '\n' : ''}${basename(file)}\n`
  appendFileSync(ignoreFile, addition)
  r.note(`Configuration: added ${basename(file)} to ${basename(ignoreFile)}: it holds secrets.`)
  return true
}

/**
 * The values a file may hold that are computed now. They are made of the pieces the file
 * holds, so they are taken out of it: the pieces stay, and the values come back from them.
 *
 * Only the entries that are the tool's own old output are removed: a value the operator set
 * by hand is left alone.
 */
export function removeComputed(
  file: string,
  names: string[],
  isOurs: (name: string, value: string) => boolean
): string[] {
  if (!existsSync(file)) return []
  const lines = readFileSync(file, 'utf8').split('\n')
  const removed: string[] = []
  const kept: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line)
    if (
      match &&
      names.includes(match[1]!) &&
      isOurs(match[1]!, match[2]!.replace(/^['"]|['"]$/g, ''))
    ) {
      removed.push(match[1]!)
      // The comment above the entry belongs to it, and so does the blank line below it.
      if (kept.length && kept[kept.length - 1]!.startsWith('#')) kept.pop()
      if (lines[i + 1] === '') i++
      continue
    }
    kept.push(line)
  }
  if (!removed.length) return []
  writeFileSync(file, kept.join('\n'), { mode: 0o600 })
  chmodSync(file, 0o600)
  return removed
}
