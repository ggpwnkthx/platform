import { describe, expect, test } from 'bun:test'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import ts from 'typescript'

/**
 * The coverage of the tree by the tools.
 *
 * The tools of the platform reach the files by a list of patterns: biome
 * lints and formats them, the compiler checks their types, and the check
 * of the architecture walks the source. A directory that is not in one of
 * those lists is a directory that is not checked: the code in it is
 * never linted, never type-checked, never reported as dead and never
 * looked at.
 *
 * The examples of the upstreams were such a directory for a long time:
 * they were in the list of the dead code but not in the list of the
 * formatter, and not in the list of the compiler either.
 *
 * The directories of the platform are named once, in the `tsconfig.json`
 * of each workspace: the compiler reads them, and the check of the dead
 * code follows the compiler with `--use-tsconfig-files`. Biome keeps its
 * own patterns, because it matches files and not directories.
 *
 * The top level of the repository is the other half of it: a directory
 * that no one decided on is a directory that no one owns.
 */
const root = join(import.meta.dir, '..')

/** The directories and the files of the top level of the repository. */
const KNOWN_TOP_LEVEL = [
  '.dockerignore',
  '.env.example',
  '.github',
  '.gitignore',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'LICENSE',
  'README.md',
  'SECURITY.md',
  'biome.json',
  'bun.lock',
  'compatibility.json',
  'deploy',
  'docs',
  'knip.json',
  'package.json',
  'packages',
  'scripts',
  'test',
  'tooling',
  'tsconfig.base.json',
  'tsconfig.json',
]

/**
 * The `tsconfig.json` of the repository: the one of the root and the one
 * of every workspace.
 */
const TSCONFIGS = [
  'tsconfig.json',
  'packages/gateway/tsconfig.json',
  'packages/access/tsconfig.json',
  'packages/data/tsconfig.json',
  'packages/data/packages/client/tsconfig.json',
  'packages/console/tsconfig.json',
  'packages/cli/tsconfig.json',
]

/** Turns a pattern of a tool into the expression that matches a path. */
function toRegExp(pattern: string): RegExp {
  let expression = ''
  let index = 0
  while (index < pattern.length) {
    const character = pattern[index]!
    if (character === '*') {
      if (pattern[index + 1] === '*') {
        // `**/` reaches any number of directories, `**` any number of
        // characters.
        expression += pattern[index + 2] === '/' ? '(?:.*/)?' : '.*'
        index += pattern[index + 2] === '/' ? 3 : 2
        continue
      }
      expression += '[^/]*'
      index += 1
      continue
    }
    expression += character.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    index += 1
  }
  return new RegExp(`^${expression}$`)
}

/** Reads the patterns of a setting of a tool. */
async function patternsOf(file: string, key: string): Promise<string[]> {
  const content = await readFile(join(root, file), 'utf8')
  // The settings of the tools are json with comments, and the compiler
  // reads them the way it reads its own.
  const parsed = ts.parseConfigFileTextToJson(file, content)
  const setting = parsed.config as Record<string, unknown>
  const found: string[] = []
  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      found.push(value)
      return
    }
    if (Array.isArray(value)) {
      for (const entry of value) walk(entry)
      return
    }
    if (typeof value === 'object' && value !== null) {
      for (const entry of Object.values(value)) walk(entry)
    }
  }
  walk(setting[key])
  return found
}

/** Every TypeScript file of the repository, except the ones of the tools. */
async function sourceFiles(directory = root): Promise<string[]> {
  const files: string[] = []
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(path)))
      continue
    }
    if (entry.name.endsWith('.ts')) files.push(path)
  }
  return files.map((path) => relative(root, path).split(sep).join('/'))
}

describe('the coverage of the tree by the tools', () => {
  test('every file of the platform is linted and formatted', async () => {
    const includes = await patternsOf('biome.json', 'files')
    const expressions = includes.map((pattern) => toRegExp(pattern))
    expect(expressions.length).toBeGreaterThan(0)
    const uncovered: string[] = []
    for (const file of await sourceFiles()) {
      if (!expressions.some((expression) => expression.test(file))) uncovered.push(file)
    }
    expect(uncovered).toEqual([])
  })

  test('every file of the platform is compiled', async () => {
    const directories: string[] = []
    for (const config of TSCONFIGS) {
      const includes = await patternsOf(config, 'include')
      const base = config === 'tsconfig.json' ? '' : `${config.split('/').slice(0, -1).join('/')}/`
      for (const include of includes) {
        directories.push(`${base}${include}`.replace(/\/$/, ''))
      }
    }
    expect(directories.length).toBeGreaterThan(0)
    const uncovered: string[] = []
    for (const file of await sourceFiles()) {
      const covered = directories.some(
        (directory) => file === directory || file.startsWith(`${directory}/`)
      )
      if (!covered) uncovered.push(file)
    }
    expect(uncovered).toEqual([])
  })

  test('the top level of the repository holds nothing that is not known', async () => {
    const entries = await readdir(root, { withFileTypes: true })
    const names = entries
      .filter((entry) => !entry.name.startsWith('.') && entry.name !== 'node_modules')
      .map((entry) => entry.name)
    const known = new Set(KNOWN_TOP_LEVEL)
    expect(names.filter((name) => !known.has(name)).sort()).toEqual([])
  })
})
