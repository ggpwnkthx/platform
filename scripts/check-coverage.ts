#!/usr/bin/env bun
/**
 * The check of the coverage of the continuous integration.
 *
 * The continuous integration is the set of the tests it runs, and a gate
 * that is wrong is a gate that is worth nothing. The check reads the
 * workflows of the platform and it reports:
 *
 * - a job of the continuous integration that points at a workspace that
 *   is not there;
 * - a test file of the repository that no job runs;
 * - a harness whose suite cannot be read.
 *
 * The command prints the problems and exits with a status of 1 when
 * there is one.
 *
 *   bun run coverage:check
 */

import { join } from 'node:path'
import { coverageProblems } from '../tooling/coverage'
import { repositoryOf } from '../tooling/ci'

/** The root of the repository. */
const root = repositoryOf(import.meta.dir)

/** The directory of the workflows. */
const workflows = join(root, '.github', 'workflows')

/** The main of the check. */
async function main(): Promise<number> {
  const problems = coverageProblems(root, workflows)
  for (const problem of problems) {
    console.error(
      JSON.stringify({
        level: 'error',
        kind: problem.kind,
        file: problem.path,
        msg: problem.message,
      })
    )
  }
  if (problems.length > 0) {
    console.error(
      JSON.stringify({
        level: 'error',
        msg: `${problems.length} problems of the coverage of the continuous integration`,
      })
    )
    return 1
  }
  console.log(
    JSON.stringify({
      level: 'info',
      msg: 'every job of the continuous integration runs a workspace that is there, and every test of the repository runs in one',
    })
  )
  return 0
}

if (import.meta.main) {
  process.exit(await main())
}
