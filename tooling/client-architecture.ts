/**
 * The architecture of a client of the platform.
 *
 * A client of the platform is a library: it is imported by the console
 * and by the CLI, and it speaks to the services over HTTP. The rules it
 * obeys are the rules of every library of the platform:
 *
 * 1. A client has **no dependency**: it imports no package. A client
 *    that imports a package drags that package into the tree of every
 *    consumer, and a dependency that is not needed at runtime is a
 *    dependency that breaks.
 * 2. A client imports **nothing of another workspace**: the source of
 *    a service is not a dependency of a client, and a relative import
 *    that leaves the directory of the client is an import that a
 *    published package cannot resolve.
 * 3. The modules of a client have **no cycle**: a cycle is a pair of
 *    files that cannot be read on their own.
 * 4. A client has **no catch-all directory**: a directory that collects
 *    unrelated behaviour is a directory that nobody owns.
 *
 * The engine is here, at the root of the repository, and the clients of
 * the platform use it: the published client of Data
 * (`packages/data/packages/client`) and the client of the console and
 * of the CLI (`packages/client`).
 */

import { access, readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'

/** The problem of the architecture of a client. */
export interface ClientArchitectureProblem {
  /** The file the problem was found in. */
  readonly file: string
  /** The message of the problem. */
  readonly message: string
}

/** The rules of the architecture of a client. */
export interface ClientArchitectureRules {
  /** The directories that collect unrelated behaviour, and that may not exist. */
  readonly forbiddenDirectories: readonly string[]
  /** The packages the client may import. */
  readonly allowedPackages: readonly string[]
  /** The message of an import that leaves the client. */
  readonly outsideMessage: string
}

/** The rules of a client that has no dependency at all. */
export const STANDALONE_RULES: ClientArchitectureRules = {
  forbiddenDirectories: ['shared', 'common', 'utils', 'util', 'lib', 'helpers', 'misc'],
  allowedPackages: [],
  outsideMessage: 'the client may not import the source of the service',
}

/** One import of a file. */
interface Import {
  /** The module that is imported. */
  readonly specifier: string
  /** True when the import is a type only import. */
  readonly typeOnly: boolean
}

/** The files of the source of a client. */
async function sources(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await sources(path)))
      continue
    }
    if (entry.name.endsWith('.ts')) files.push(path)
  }
  return files
}

/** Reads the imports of a file. */
export function importsOf(source: string): Import[] {
  const found: Import[] = []
  const pattern = /(?:import|export)\s+(type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g
  let match = pattern.exec(source)
  while (match) {
    found.push({ specifier: match[2] ?? '', typeOnly: Boolean(match[1]) })
    match = pattern.exec(source)
  }
  return found
}

/**
 * Resolves a specifier to a file of the source.
 *
 * A file is a file of the source when it is there: the extension is
 * optional in an import, and a directory is a module of its own.
 */
async function resolveModule(base: string): Promise<string | null> {
  for (const candidate of [`${base}.ts`, `${base}/index.ts`]) {
    try {
      await access(candidate)
      return candidate
    } catch {
      // The candidate is not there.
    }
  }
  return null
}

/** The cycles of the graph of the modules. */
function cycles(graph: Map<string, string[]>): string[][] {
  const found: string[][] = []
  const state = new Map<string, 'visiting' | 'done'>()
  const stack: string[] = []

  const visit = (node: string): void => {
    const current = state.get(node)
    if (current === 'done') return
    if (current === 'visiting') {
      const index = stack.indexOf(node)
      if (index >= 0) found.push([...stack.slice(index), node])
      return
    }
    state.set(node, 'visiting')
    stack.push(node)
    for (const next of graph.get(node) ?? []) {
      if (graph.has(next)) visit(next)
    }
    stack.pop()
    state.set(node, 'done')
  }

  for (const node of graph.keys()) visit(node)
  return found
}

/**
 * Runs the check over the source of a client.
 *
 * The function returns the problems it found: an empty list means that
 * the client holds its boundaries.
 */
export async function checkClientArchitecture(
  root: string,
  rules: ClientArchitectureRules = STANDALONE_RULES
): Promise<ClientArchitectureProblem[]> {
  const problems: ClientArchitectureProblem[] = []
  const files = await sources(root)
  const graph = new Map<string, string[]>()

  for (const name of rules.forbiddenDirectories) {
    const directory = join(root, name)
    try {
      await readdir(directory)
      problems.push({
        file: relative(root, directory),
        message: 'a catch-all directory of shared code is not allowed',
      })
    } catch {
      // The directory does not exist: nothing to refuse.
    }
  }

  for (const file of files) {
    const source = await readFile(file, 'utf8')
    const local: string[] = []
    for (const entry of importsOf(source)) {
      const specifier = entry.specifier
      if (!specifier.startsWith('.')) {
        // A package, or a builtin of the runtime: a type only import of
        // a builtin is a type and it does not reach the consumer.
        if (specifier.startsWith('node:')) continue
        if (rules.allowedPackages.includes(specifier)) continue
        problems.push({
          file: relative(root, file),
          message: `the client has no dependency and it may not import "${specifier}"`,
        })
        continue
      }
      // A relative import: it has to stay in the source of the client.
      const target = resolve(dirname(file), specifier)
      if (!target.startsWith(root)) {
        problems.push({
          file: relative(root, file),
          message: rules.outsideMessage,
        })
        continue
      }
      const resolved = await resolveModule(target)
      if (!resolved) continue
      local.push(resolved)
    }
    graph.set(file, local)
  }

  for (const cycle of cycles(graph)) {
    problems.push({
      file: cycle.map((file) => relative(root, file)).join(' -> '),
      message: 'the modules of the client have a cycle',
    })
  }

  return problems
}
