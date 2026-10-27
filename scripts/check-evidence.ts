#!/usr/bin/env bun
/**
 * The check of the evidence of the decisions.
 *
 * The decisions of the workspaces record, for each decision, the place
 * that proves it. A citation that points at nothing proves nothing, and
 * a citation that points at a test that the continuous integration does
 * not run proves nothing either.
 *
 * The check reads the decisions of the platform and it reports:
 *
 * - a cited path that is not there;
 * - a cited test that no job of the continuous integration runs.
 *
 * The command prints the problems and exits with a status of 1 when
 * there is one.
 *
 *   bun run evidence:check
 */

import { readdirSync, existsSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { citationsOf, problemsOf, workspaceOf, type Citation } from '../tooling/evidence'
import { coveredTests, repositoryOf } from '../tooling/ci'

/** The root of the repository. */
const root = repositoryOf(import.meta.dir)

/** The directory of the documentation. */
const documentation = join(root, 'docs')

/** The directory of the workflows. */
const workflows = join(root, '.github', 'workflows')

/**
 * The documents of the decisions.
 *
 * A workspace records its decisions in `decisions.md`, and the
 * specification of a workspace may hold them in a table of its own.
 */
export function decisionDocuments(directory: string): string[] {
  if (!existsSync(directory)) return []
  const found: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const path = join(directory, entry.name, 'decisions.md')
    if (existsSync(path)) found.push(path)
  }
  return found
}

/** The main of the check. */
async function main(): Promise<number> {
  const covered = coveredTests(root, workflows)
  const running = [...covered].map((path) => join(root, path))
  const problems: ReturnType<typeof problemsOf> = []
  let citations = 0
  for (const document of decisionDocuments(documentation)) {
    const found: Citation[] = citationsOf(document)
    citations += found.length
    problems.push(
      ...problemsOf(
        found,
        {
          repository: root,
          document: dirname(resolve(document)),
          ...(workspaceOf(document, root) ? { workspace: workspaceOf(document, root)! } : {}),
        },
        covered,
        running
      )
    )
  }
  for (const problem of problems) {
    console.error(
      JSON.stringify({
        level: 'error',
        file: relative(root, problem.document),
        decision: problem.decision,
        path: problem.path,
        msg: problem.message,
      })
    )
  }
  if (problems.length > 0) {
    console.error(
      JSON.stringify({
        level: 'error',
        msg: `${problems.length} problems of the evidence of the decisions`,
      })
    )
    return 1
  }
  console.log(
    JSON.stringify({
      level: 'info',
      msg: `the evidence of the decisions is real: ${citations} citations, ${covered.size} test files that the continuous integration runs`,
    })
  )
  return 0
}

if (import.meta.main) {
  process.exit(await main())
}
