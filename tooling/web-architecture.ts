/**
 * The import boundaries of a package of the web pages.
 *
 * A package of the web pages of the platform holds a part of the
 * interface: the pieces every page is made of, or a page of its own.
 * The organization of the source is part of the implementation contract
 * of the package, and this module is the engine of the check that holds
 * it.
 *
 * The rules are the ones of every package of the platform:
 *
 * 1. There is no cycle between the modules, not even a cycle of types.
 * 2. There is no catch-all directory: a directory that collects
 *    unrelated behaviour is a directory that nobody owns.
 * 3. The core of a package holds the facts and the policy, and it does
 *    not import the interface: a fact that draws itself is a fact that
 *    is hard to reuse.
 * 4. The interface draws what the core gives it, and it imports the
 *    core through its public entry point.
 *
 * The rules themselves are the engine of `tooling/architecture.ts`, and
 * the matrix below is what makes them the rules of a package.
 */

/** A problem of the architecture of a package. */
export interface WebProblem {
  /** The file the problem was found in. */
  readonly file: string
  /** What is wrong with it. */
  readonly message: string
}

/** The rules of a package of the web pages. */
export interface WebRules {
  /** The directories that collect unrelated behaviour, and that may not exist. */
  readonly forbiddenDirectories: readonly string[]
  /**
   * The directories that hold the core of the package.
   *
   * The core may not import the interface: the facts of a package are
   * drawn by the interface, and not by the facts themselves.
   */
  readonly coreDirectories: readonly string[]
  /** The packages the core of the package may not import. */
  readonly forbiddenCorePackages: readonly string[]
}

/** One import of a file. */
interface Import {
  /** The module that is imported. */
  readonly specifier: string
}

/** The files of a directory, recursively. */
async function sources(directory: string): Promise<string[]> {
  const { readdir } = await import('node:fs/promises')
  const entries = await readdir(directory, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const path = `${directory}/${entry.name}`
    if (entry.isDirectory()) {
      files.push(...(await sources(path)))
      continue
    }
    if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) files.push(path)
  }
  return files
}

/** Reads the imports of a file. */
function importsOf(source: string): Import[] {
  const found: Import[] = []
  const pattern = /(?:import|export)\s+(type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g
  let match = pattern.exec(source)
  while (match) {
    found.push({ specifier: match[2] ?? '' })
    match = pattern.exec(source)
  }
  return found
}

/** The directory of a file. */
function dirnameOf(file: string): string {
  return file.slice(0, file.lastIndexOf('/'))
}

/** Resolves a specifier to a file of the source. */
async function resolve(base: string): Promise<string | null> {
  const { access } = await import('node:fs/promises')
  for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    try {
      await access(candidate)
      return candidate
    } catch {
      // The candidate does not exist.
    }
  }
  return null
}

/** The cycles of a graph of files. */
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
 * Checks the import boundaries of a package of the web pages.
 *
 * The root is the root of the package, and the source is the `src` of
 * the package.
 */
export async function checkWebArchitecture(root: string, rules: WebRules): Promise<WebProblem[]> {
  const problems: WebProblem[] = []
  const { readdir, readFile } = await import('node:fs/promises')
  const source = `${root}/src`

  // The catch-all directories.
  for (const name of rules.forbiddenDirectories) {
    for (const forbidden of [`${source}/${name}`, `${source}/domains/${name}`]) {
      try {
        await readdir(forbidden)
        problems.push({
          file: forbidden,
          message: 'a catch-all directory of shared code is not allowed',
        })
      } catch {
        // The directory does not exist: nothing to refuse.
      }
    }
  }

  // The graph of the modules and the rules of the imports.
  const graph = new Map<string, string[]>()
  const files = await sources(source)
  for (const file of files) {
    const content = await readFile(file, 'utf8')
    const local: string[] = []
    const core = rules.coreDirectories.some((directory) => file.includes(`/${directory}/`))
    for (const entry of importsOf(content)) {
      const specifier = entry.specifier
      if (!specifier.startsWith('.')) {
        if (core && rules.forbiddenCorePackages.includes(specifier)) {
          problems.push({
            file: file.slice(root.length + 1),
            message: `the core of the package may not import "${specifier}"`,
          })
        }
        continue
      }
      const target = await resolve(`${dirnameOf(file)}/${specifier}`)
      if (!target) continue
      local.push(target)
      if (!core) continue
      const targetIsInterface = rules.coreDirectories.every(
        (directory) => !target.includes(`/${directory}/`)
      )
      if (targetIsInterface) {
        problems.push({
          file: file.slice(root.length + 1),
          message: 'the core of the package may not import the interface',
        })
      }
    }
    graph.set(file, local)
  }

  // The cycles.
  for (const cycle of cycles(graph)) {
    problems.push({ file: cycle.join(' -> '), message: 'the modules have a cycle' })
  }

  return problems
}
