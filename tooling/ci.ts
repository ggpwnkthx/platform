/**
 * The coverage of the continuous integration.
 *
 * The continuous integration of the platform is the set of the tests
 * that it runs. A test that no job runs is a test that nobody
 * executes, and a decision that cites it as its evidence is a decision
 * that is checked nowhere.
 *
 * This module reads the workflows and it answers the question: which
 * test files does the continuous integration run?
 *
 * The commands of the workflows are read:
 *
 * - `bun test [--cwd <dir>] <paths>` names the test files directly;
 * - `bun run --cwd <dir> <script>` names a script of a workspace, and
 *   the script is read in the manifest of the workspace: a script that
 *   runs `bun test` names the test files it runs.
 *
 * A path of a command is a directory or a file, and a directory is the
 * set of the test files it holds. The rule of the runtime is the one of
 * bun: a file is a test file when its name carries `.test.`, `_test.`,
 * `.spec.` or `_spec.`.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { parse } from 'yaml'

/**
 * The name of the pattern of the test files of the runtime.
 */
const TEST_FILE = /(\.|_)(test|spec)\.[cm]?[jt]sx?$/

/**
 * Reports whether a file is a test file of the runtime.
 *
 * The rule is the one of bun: the name of the file carries the word of
 * the test.
 */
export function isTestFile(path: string): boolean {
  return TEST_FILE.test(basename(path))
}

/** The commands of a workflow. */
export interface Command {
  /** The workflow the command is in. */
  readonly workflow: string
  /** The job the command is in. */
  readonly job: string
  /** The command itself. */
  readonly command: string
}

/**
 * Splits a command line into its words.
 *
 * A word may be quoted: a path of a script may carry a space.
 */
export function splitCommand(line: string): string[] {
  const words: string[] = []
  let current = ''
  let quote = ''
  for (const character of line) {
    if (quote) {
      if (character === quote) {
        quote = ''
        continue
      }
      current += character
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (/\s/.test(character)) {
      if (current.length > 0) words.push(current)
      current = ''
      continue
    }
    current += character
  }
  if (current.length > 0) words.push(current)
  return words
}

/**
 * Replaces the expressions of a matrix in a command.
 *
 * A job of a matrix runs the same command with another value of the
 * matrix, and the command of the job is the same for every value: the
 * values of the matrix are read from the job, and each of them is
 * substituted in turn.
 */
export function matrixValues(job: unknown): string[][] {
  const values: string[][] = []
  if (typeof job !== 'object' || job === null) return values
  const include = (job as { strategy?: { matrix?: { include?: unknown } } }).strategy?.matrix
    ?.include
  if (!Array.isArray(include)) return values
  for (const entry of include) {
    if (typeof entry !== 'object' || entry === null) continue
    const substitutions: string[] = []
    for (const [key, value] of Object.entries(entry as Record<string, unknown>)) {
      if (typeof value !== 'string') continue
      substitutions.push(`\${{ matrix.${key} }}`, value)
    }
    values.push(substitutions)
  }
  return values
}

/**
 * The commands of the workflows.
 *
 * Every `run` of every step of every job is a command, and the
 * expressions of a matrix are substituted: the job of the gateway runs
 * the command of the gateway, and the job of Access runs
 * the command of Access.
 */
export function commandsOf(directory: string): Command[] {
  const commands: Command[] = []
  for (const name of readdirSync(directory)) {
    if (!name.endsWith('.yml') && !name.endsWith('.yaml')) continue
    const workflow = parse(readFileSync(join(directory, name), 'utf8')) as {
      jobs?: Record<string, unknown>
    }
    for (const [jobName, job] of Object.entries(workflow.jobs ?? {})) {
      const steps = (job as { steps?: unknown[] }).steps ?? []
      const runs: string[] = []
      for (const step of steps) {
        const run = (step as { run?: unknown }).run
        if (typeof run !== 'string') continue
        for (const line of run.split('\n')) {
          const trimmed = line.trim()
          if (trimmed.length === 0 || trimmed.startsWith('#')) continue
          runs.push(trimmed)
        }
      }
      const substitutions = matrixValues(job)
      if (substitutions.length === 0) {
        for (const command of runs) commands.push({ workflow: name, job: jobName, command })
        continue
      }
      for (const substitution of substitutions) {
        for (const command of runs) {
          let resolved = command
          for (let index = 0; index < substitution.length; index += 2) {
            resolved = resolved.split(substitution[index]!).join(substitution[index + 1]!)
          }
          commands.push({ workflow: name, job: jobName, command: resolved })
        }
      }
    }
  }
  return commands
}

/** The tests a command runs, and the directory they are relative to. */
export interface TestCommand {
  /** The directory the paths of the command are relative to. */
  readonly directory: string
  /** The paths of the tests. */
  readonly paths: string[]
}

/**
 * The test commands of a list of commands.
 *
 * The scripts of a workspace are read: a script that runs `bun test`
 * names the tests it runs.
 */
export function testCommandsOf(commands: readonly Command[], repository: string): TestCommand[] {
  const found: TestCommand[] = []
  for (const { command } of commands) {
    const words = splitCommand(command)
    if (words.length === 0) continue
    if (words[0] === 'bun' && words[1] === 'test') {
      const { directory, paths } = testPaths(words.slice(2))
      if (paths.length > 0) found.push({ directory: resolve(repository, directory), paths })
      continue
    }
    if (words[0] === 'bun' && words[1] === 'run') {
      const rest = words.slice(2)
      const cwd = rest.indexOf('--cwd')
      let directory = '.'
      let script: string | undefined
      if (cwd >= 0) {
        directory = rest[cwd + 1] ?? '.'
        script = rest[cwd + 2]
      } else {
        script = rest[0]
      }
      if (!script) continue
      const manifest = join(repository, directory, 'package.json')
      if (!existsSync(manifest)) continue
      const scripts = (
        JSON.parse(readFileSync(manifest, 'utf8')) as { scripts?: Record<string, string> }
      ).scripts
      const body = scripts?.[script]
      if (!body) continue
      const scriptWords = splitCommand(body)
      if (scriptWords[0] !== 'bun' || scriptWords[1] !== 'test') continue
      const paths = scriptWords.slice(2).filter((word) => !word.startsWith('-'))
      if (paths.length === 0) continue
      found.push({ directory: resolve(repository, directory), paths })
    }
  }
  return found
}

/** The directory and the paths of a `bun test` command. */
function testPaths(words: readonly string[]): { directory: string; paths: string[] } {
  let directory = '.'
  const paths: string[] = []
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!
    if (word === '--cwd') {
      directory = words[index + 1] ?? '.'
      index += 1
      continue
    }
    if (word.startsWith('-')) continue
    paths.push(word)
  }
  return { directory, paths }
}

/**
 * The test files of a directory.
 *
 * The rule of the runtime is the one of bun: the name of the file
 * carries the word of the test.
 */
export function testFilesOf(directory: string): string[] {
  if (!existsSync(directory)) return []
  const stats = statSync(directory)
  if (stats.isFile()) return TEST_FILE.test(basename(directory)) ? [directory] : []
  const found: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      found.push(...testFilesOf(path))
      continue
    }
    if (TEST_FILE.test(entry.name)) found.push(path)
  }
  return found
}

/**
 * The files of a path that holds a wildcard.
 *
 * A path of a command may be a pattern: `test/*.test.ts` names the
 * tests of the root. The pattern is a path of the repository, and it is
 * matched against the files that are under its directory.
 */
export function filesOfPattern(directory: string, pattern: string): string[] {
  const segments = pattern.split('/')
  const wildcard = segments.findIndex((segment) => segment.includes('*'))
  if (wildcard < 0) return []
  const prefix = segments.slice(0, wildcard).join('/')
  const expression = new RegExp(
    `^${pattern
      .split('/')
      .map((segment) => segment.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*'))
      .join('/')}$`
  )
  const base = prefix ? resolve(directory, prefix) : resolve(directory)
  const found: string[] = []
  for (const file of testFilesOf(base)) {
    // The pattern is a path of the repository: it is matched against
    // the path of the file, and not against the path of the prefix.
    const relativePath = relative(directory, file).split('\\').join('/')
    if (expression.test(relativePath)) found.push(file)
  }
  return found
}

/**
 * The files that a configuration of the runtime preloads.
 *
 * A file of a `bunfig.toml` that is preloaded runs with every test of
 * the workspace: it is the deadline of the tests and their hooks. It is
 * not reached by an import, and it is run all the same.
 */
export function preloadedFiles(repository: string): string[] {
  const found: string[] = []
  const walk = (directory: string): void => {
    if (!existsSync(directory)) return
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        walk(path)
        continue
      }
      if (entry.name !== 'bunfig.toml') continue
      const text = readFileSync(path, 'utf8')
      const match = /preload\s*=\s*\[([^\]]*)\]/.exec(text)
      if (!match) continue
      for (const quoted of match[1]!.matchAll(/["']([^"']+)["']/g)) {
        const target = resolve(dirname(path), quoted[1] ?? '')
        if (existsSync(target)) found.push(target)
      }
    }
  }
  walk(repository)
  return found
}

/**
 * The test files that the continuous integration runs.
 *
 * The result is the set of the paths of the files, relative to the root
 * of the repository.
 */
export function coveredTests(repository: string, workflows: string): Set<string> {
  const covered = new Set<string>()
  const commands = commandsOf(workflows)
  for (const command of testCommandsOf(commands, repository)) {
    for (const path of command.paths) {
      const target = resolve(command.directory, path)
      const files = path.includes('*')
        ? filesOfPattern(command.directory, path)
        : testFilesOf(target)
      for (const file of files) {
        covered.add(relative(repository, file).split('\\').join('/'))
      }
    }
  }
  // The files that the runtime preloads run with every test of their
  // workspace.
  for (const file of preloadedFiles(repository)) {
    covered.add(relative(repository, file).split('\\').join('/'))
  }
  return covered
}

/** The root of the repository of a directory. */
export function repositoryOf(directory: string): string {
  let current = resolve(directory)
  while (true) {
    if (existsSync(join(current, 'package.json'))) return current
    const parent = dirname(current)
    if (parent === current) return resolve(directory)
    current = parent
  }
}
