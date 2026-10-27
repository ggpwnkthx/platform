/**
 * The evidence of the decisions.
 *
 * The decisions of a workspace record, for each decision, the place that
 * proves it: a test, a file of the source, a document. The citations are
 * prose, and prose drifts: a test that is renamed leaves a decision that
 * points at nothing, and a suite that is never run leaves a decision
 * that points at a test nobody executes.
 *
 * This module reads the citations and it answers two questions:
 *
 * 1. does every cited path exist?
 * 2. is every cited **test** run by the continuous integration?
 *
 * The second question is the one that matters. A decision that cites a
 * test is a decision that says "this is checked here", and a test that
 * the continuous integration does not run is a decision that is checked
 * nowhere. The gateway had a suite of the transport that no job of the
 * continuous integration ran, and a decision that cited it as the
 * evidence of the boundaries of the runtime.
 *
 * The module reads the tables of the decisions: the column of the
 * evidence is the one the header names, and the citations are the paths
 * of that column. The decisions that are prose have no column of the
 * evidence, and the module says so instead of guessing.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { isTestFile } from './ci'

/** A citation of the evidence of a decision. */
export interface Citation {
  /** The document that holds the decision. */
  readonly document: string
  /** The name of the decision: its number and its title. */
  readonly decision: string
  /** The path of the citation, as it is written in the document. */
  readonly path: string
}

/** A problem of the evidence. */
export interface EvidenceProblem {
  /** The document the problem was found in. */
  readonly document: string
  /** The decision the problem belongs to. */
  readonly decision: string
  /** The path of the citation. */
  readonly path: string
  /** The message of the problem. */
  readonly message: string
}

/** The roots a cited path is resolved against, in the order of the list. */
export interface ResolutionRoots {
  /** The root of the repository. */
  readonly repository: string
  /** The directory of the document that holds the decision. */
  readonly document: string
  /** The workspace that owns the document, when it has one. */
  readonly workspace?: string
}

/** The header of the column of the evidence. */
const EVIDENCE_HEADER = /evidence/i

/**
 * The cells of a row of a table.
 *
 * The row is a line that starts and ends with a pipe. The cells are the
 * parts between the pipes, and the empty cells at the ends are dropped.
 */
export function cellsOf(line: string): string[] {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|')) return []
  const parts = trimmed.slice(1, trimmed.endsWith('|') ? -1 : undefined).split('|')
  return parts.map((cell) => cell.trim())
}

/**
 * The paths of a cell of the evidence.
 *
 * A path is written in backquotes or in a link. The cell may hold
 * several of them, and it may hold prose around them.
 *
 * A token is a path when it names a file: it carries an extension, or
 * it ends with a slash. A token without an extension is a name — the
 * name of a package, of an environment variable or of a setting — and
 * the name of a package is not a path of the repository.
 */
export function pathsOf(cell: string): string[] {
  const found: string[] = []
  // A path is written in backquotes or in a link, and the citations keep
  // the order of the cell.
  const pattern = /`([^`]+)`|\]\(([^)]+)\)/g
  let match = pattern.exec(cell)
  while (match) {
    found.push((match[1] ?? match[2] ?? '').trim())
    match = pattern.exec(cell)
  }
  return found.filter((path) => isPathLike(path))
}

/**
 * Reports whether a token names a path of the repository.
 *
 * A path names a file: it carries an extension, or it ends with a
 * slash. A token without an extension is a name, and a name is not a
 * path.
 */
export function isPathLike(token: string): boolean {
  if (token.length === 0 || /\s/.test(token)) return false
  if (token.endsWith('/')) return true
  const name = token.split('/').pop() ?? ''
  return name.includes('.')
}

/**
 * Reports whether a citation names a file of a source tree.
 *
 * A path that names a directory, a script or a document is not a test.
 * A test is a file of a test directory, or a file whose name ends with
 * `.test.ts`.
 */
export function isTestPath(path: string): boolean {
  const normalized = path.split('\\').join('/')
  return (
    normalized.startsWith('test/') ||
    normalized.includes('/test/') ||
    normalized.endsWith('.test.ts') ||
    normalized.endsWith('.spec.ts')
  )
}

/**
 * The imports of a file, as the paths they resolve to.
 *
 * Only the relative imports are resolved: a package is not a file of the
 * repository. A specifier carries no extension, and the file it names
 * does: the import is resolved to the file that is there.
 */
export function importsOf(file: string): string[] {
  const source = readFileSync(file, 'utf8')
  const specifiers: string[] = []
  const pattern = /(?:import|export)\s+(type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g
  let match = pattern.exec(source)
  while (match) {
    const specifier = match[2] ?? ''
    if (specifier.startsWith('.')) {
      const target = resolve(dirname(file), specifier)
      const resolved = [target, `${target}.ts`, join(target, 'index.ts')].find((candidate) =>
        existsSync(candidate)
      )
      if (resolved) specifiers.push(resolved)
    }
    match = pattern.exec(source)
  }
  return specifiers
}

/**
 * Reports whether a file is reached by a test that runs.
 *
 * A cited file of a test directory that is not a test file itself is a
 * **support** file: the suite it holds is run by the test files that
 * import it. A support file that no test that runs imports is a file
 * that nothing executes.
 */
export function isReached(target: string, running: readonly string[]): boolean {
  const candidates = [target, `${target}.ts`, join(target, 'index.ts')]
  for (const file of running) {
    for (const imported of importsOf(file)) {
      if (candidates.includes(imported)) return true
    }
  }
  return false
}

/**
 * Reads the citations of the evidence of a document.
 *
 * The tables of the document are read: the header of a table names its
 * columns, and the column of the evidence is the one whose name carries
 * the word. A document without such a column has no citation, and the
 * result is empty.
 */
export function citationsOf(document: string): Citation[] {
  const text = readFileSync(document, 'utf8')
  const lines = text.split('\n')
  const citations: Citation[] = []
  let header: string[] | undefined
  for (const line of lines) {
    const cells = cellsOf(line)
    if (cells.length === 0) {
      header = undefined
      continue
    }
    // The header of a table is the row of the names of the columns, and
    // the row of the dashes that follows it is the separator.
    if (header === undefined) {
      if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) continue
      header = cells
      continue
    }
    const column = header.findIndex((cell) => EVIDENCE_HEADER.test(cell))
    if (column < 0) {
      header = undefined
      continue
    }
    const number = cells[0] ?? ''
    const title = cells[1] ?? ''
    const decision = `${number} ${title}`.trim()
    for (const path of pathsOf(cells[column] ?? '')) {
      citations.push({ document, decision, path })
    }
  }
  return citations
}

/**
 * Resolves a cited path against the roots of a document.
 *
 * The roots are tried in the order of the list: the directory of the
 * document, the workspace that owns it and the root of the repository.
 * The first root that holds the path is the one that owns it.
 */
export function resolveCitation(path: string, roots: ResolutionRoots): string | undefined {
  if (isAbsolute(path)) return existsSync(path) ? path : undefined
  const candidates = [roots.document, roots.workspace, roots.repository].filter(
    (root): root is string => typeof root === 'string'
  )
  for (const root of candidates) {
    const candidate = join(root, path)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

/**
 * The workspace that owns a document of the documentation.
 *
 * A document of `docs/<workspace>/` belongs to the workspace
 * `packages/<workspace>/`. A document of `docs/platform/` belongs to the
 * repository.
 */
export function workspaceOf(document: string, repository: string): string | undefined {
  const relativePath = relative(repository, document).split('\\').join('/')
  const match = /^docs\/([^/]+)\//.exec(relativePath)
  if (!match) return undefined
  const name = match[1]
  if (name === 'platform') return undefined
  const workspace = join(repository, 'packages', name)
  return existsSync(workspace) ? workspace : undefined
}

/**
 * The problems of the citations of a document.
 *
 * The problems are the ones of the paths that do not exist and the ones
 * of the tests that the continuous integration does not run.
 *
 * A cited test file has to be run by the continuous integration, and a
 * cited support file — a file of a test directory that holds a suite and
 * is not a test file itself — has to be reached by a test that runs.
 */
export function problemsOf(
  citations: readonly Citation[],
  roots: ResolutionRoots,
  covered: ReadonlySet<string>,
  running: readonly string[] = []
): EvidenceProblem[] {
  const problems: EvidenceProblem[] = []
  for (const citation of citations) {
    const resolved = resolveCitation(citation.path, roots)
    if (!resolved) {
      problems.push({
        document: citation.document,
        decision: citation.decision,
        path: citation.path,
        message: 'the cited path is not there',
      })
      continue
    }
    if (!isTestPath(citation.path)) continue
    const key = relative(roots.repository, resolved).split('\\').join('/')
    if (isTestFile(resolved)) {
      if (covered.has(key)) continue
      problems.push({
        document: citation.document,
        decision: citation.decision,
        path: citation.path,
        message: 'the cited test is not run by the continuous integration',
      })
      continue
    }
    if (isReached(resolved, running)) continue
    // A file that the runtime preloads runs with every test of its
    // workspace, and it is reached by no import.
    if (covered.has(key)) continue
    problems.push({
      document: citation.document,
      decision: citation.decision,
      path: citation.path,
      message: 'the cited suite is not reached by a test that the continuous integration runs',
    })
  }
  return problems
}
