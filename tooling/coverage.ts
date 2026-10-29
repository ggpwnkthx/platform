/**
 * The coverage of the continuous integration.
 *
 * The continuous integration is the set of the tests it runs. Two things
 * can go wrong with it, and both of them are silent.
 *
 * The first is a job that points at a workspace that is not there. The
 * matrix that carries the job is read by nobody else, and the job fails
 * when the runner picks it up: the failure is loud, but it is a failure
 * of the platform's own gate and not a finding about the platform.
 *
 * The second is a test file that no job runs. The test is green on the
 * machine of its author and it is never executed again, and the proof
 * that it is green is a proof that was made once. The evidence of the
 * decisions already proves this for the tests a decision cites: a
 * decision that cites a test that no job runs is a decision that is
 * checked nowhere. This module proves it for every test file of the
 * repository, whether a decision cites it or not.
 *
 * The check of the coverage is therefore a check of the continuous
 * integration itself, and the continuous integration is the only gate of
 * the platform that is worth nothing when it is wrong.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { coveredTests, harnessSuites, repositoryTestFiles } from './ci'

/**
 * The kind of a problem of the coverage.
 *
 * - `workspace`: a job of the continuous integration points at a
 *   workspace that is not there.
 * - `test`: a test file of the repository that no job runs.
 * - `harness`: a harness whose suite cannot be read, and whose coverage
 *   cannot be proved.
 */
export type CoverageKind = 'workspace' | 'test' | 'harness'

/** A problem of the coverage. */
export interface CoverageProblem {
  /** The kind of the problem. */
  readonly kind: CoverageKind
  /** The path the problem is about, relative to the root of the repository. */
  readonly path: string
  /** The message of the problem. */
  readonly message: string
}

/**
 * A path of a matrix of a job.
 */
export interface MatrixPath {
  /** The workflow that holds the job. */
  readonly workflow: string
  /** The job that holds the matrix. */
  readonly job: string
  /** The path of the workspace of the entry. */
  readonly path: string
}

/**
 * The paths of the matrices of the jobs of the workflows.
 *
 * A job of a matrix names the workspaces it runs: the entry of the
 * matrix carries a `path`, and the path is the workspace the job runs
 * its commands in.
 */
export function matrixPaths(directory: string): MatrixPath[] {
  const found: MatrixPath[] = []
  if (!existsSync(directory)) return found
  for (const name of readdirSync(directory)) {
    if (!name.endsWith('.yml') && !name.endsWith('.yaml')) continue
    const workflow = parse(readFileSync(join(directory, name), 'utf8')) as {
      jobs?: Record<string, unknown>
    }
    for (const [jobName, job] of Object.entries(workflow.jobs ?? {})) {
      const include = (job as { strategy?: { matrix?: { include?: unknown } } }).strategy?.matrix
        ?.include
      if (!Array.isArray(include)) continue
      for (const entry of include) {
        const path = (entry as { path?: unknown } | null)?.path
        if (typeof path !== 'string') continue
        found.push({ workflow: name, job: jobName, path })
      }
    }
  }
  return found
}

/**
 * The problems of the workspaces of the matrices.
 *
 * The path of an entry of a matrix is a directory of the repository, and
 * a directory of the repository that holds a manifest is a workspace.
 */
export function workspaceProblems(repository: string, workflows: string): CoverageProblem[] {
  const problems: CoverageProblem[] = []
  for (const entry of matrixPaths(workflows)) {
    const directory = join(repository, entry.path)
    if (!existsSync(directory)) {
      problems.push({
        kind: 'workspace',
        path: entry.path,
        message: `the job ${entry.job} of ${entry.workflow} runs the workspace ${entry.path}, and it is not there`,
      })
      continue
    }
    if (!existsSync(join(directory, 'package.json'))) {
      problems.push({
        kind: 'workspace',
        path: entry.path,
        message: `the job ${entry.job} of ${entry.workflow} runs the workspace ${entry.path}, and it is not a workspace`,
      })
    }
  }
  return problems
}

/**
 * The problems of the tests of the repository.
 *
 * Every test file of the repository has to be run by a job of the
 * continuous integration. A test that no job runs is a test that nobody
 * executes, and the harness of the compatibility is a job: the suite it
 * runs is read from the harness itself.
 */
export function testProblems(repository: string, workflows: string): CoverageProblem[] {
  const problems: CoverageProblem[] = []
  const covered = coveredTests(repository, workflows)
  for (const path of repositoryTestFiles(repository)) {
    if (covered.has(path)) continue
    problems.push({
      kind: 'test',
      path,
      message: 'the test is not run by any job of the continuous integration',
    })
  }
  for (const suite of harnessSuites(repository)) {
    if (!suite.unreadable) continue
    problems.push({
      kind: 'harness',
      path: suite.path,
      message:
        'the command of the harness cannot be read, and the suite it runs cannot be proved to run',
    })
  }
  return problems
}

/**
 * The problems of the coverage of the continuous integration.
 */
export function coverageProblems(repository: string, workflows: string): CoverageProblem[] {
  return [...workspaceProblems(repository, workflows), ...testProblems(repository, workflows)]
}
