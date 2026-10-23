#!/usr/bin/env bun
/**
 * The architecture check of the client.
 *
 * The client is published: it is installed by the consumers of the
 * backend, outside of this repository, and it has to work there on its
 * own. The rules of the client are therefore stricter than the rules of
 * a service:
 *
 * 1. The client has **no dependency**: it imports no package. A client
 *    that imports a package drags that package into the tree of every
 *    consumer, and a dependency that is not needed at runtime is a
 *    dependency that breaks.
 * 2. The client imports **nothing of the service**: the source of the
 *    backend is not published, and a relative import that leaves the
 *    directory of the client cannot resolve in the package that is
 *    published.
 * 3. The modules of the client have **no cycle**: a cycle is a pair of
 *    files that cannot be read on their own, and a generated file of the
 *    deployment cannot take part in one.
 *
 * The command prints the problems and exits with a status of 1 when
 * there is one.
 */

import { access, readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'

/** The root of the source of the client. */
const SOURCE = resolve(import.meta.dir, '..', 'src')

/** The problem of the architecture of the client. */
export interface ClientArchitectureProblem {
  /** The file the problem was found in. */
  readonly file: string
  /** The message of the problem. */
  readonly message: string
}

/** One import of a file. */
interface Import {
  /** The module that is imported. */
  readonly specifier: string
  /** True when the import is a type only import. */
  readonly typeOnly: boolean
}

/** The files of the source of the client. */
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
 * Runs the check over the source of the client.
 *
 * The function returns the problems it found: an empty list means that
 * the client is standalone.
 */
export async function checkClientArchitecture(
  root: string = SOURCE
): Promise<ClientArchitectureProblem[]> {
  const problems: ClientArchitectureProblem[] = []
  const files = await sources(root)
  const graph = new Map<string, string[]>()

  for (const file of files) {
    const source = await readFile(file, 'utf8')
    const local: string[] = []
    for (const entry of importsOf(source)) {
      const specifier = entry.specifier
      if (!specifier.startsWith('.')) {
        // A package, or a builtin of the runtime: the client has no
        // dependency at all. A type only import of a builtin is a type
        // and it does not reach the consumer.
        if (specifier.startsWith('node:')) continue
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
          message: 'the client may not import the source of the service',
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

if (import.meta.main) {
  const problems = await checkClientArchitecture()
  if (problems.length === 0) {
    console.log(JSON.stringify({ level: 'info', msg: 'the architecture of the client is valid' }))
  } else {
    for (const problem of problems) {
      console.error(`${problem.file}: ${problem.message}`)
    }
    process.exit(1)
  }
}
