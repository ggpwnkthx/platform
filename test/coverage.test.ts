import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { coverageProblems, matrixPaths, testProblems, workspaceProblems } from '../tooling/coverage'
import { coveredTests, harnessCommandOf, harnessSuites, repositoryTestFiles } from '../tooling/ci'

/**
 * The coverage of the continuous integration.
 *
 * The check has one purpose: a test that no job runs is a test that
 * nobody executes, and a job that points at a workspace that is not
 * there is a job that fails on every push. These tests prove that the
 * check reads the workflows and that it reports the ones that are
 * broken — the check that never fails is not a check.
 */

const directories: string[] = []

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

/** Creates a directory that is removed at the end of the test. */
async function directory(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix))
  directories.push(path)
  return path
}

/** The root of the repository. */
const repository = resolve(import.meta.dir, '..')

/**
 * Builds a repository of one workflow and of the workspaces it names.
 */
async function platform(
  workflows: string[],
  workspaces: string[]
): Promise<{ root: string; workflows: string }> {
  const root = await directory('coverage-')
  const directoryOfWorkflows = join(root, '.github', 'workflows')
  await mkdir(directoryOfWorkflows, { recursive: true })
  await writeFile(join(directoryOfWorkflows, 'ci.yml'), workflows.join('\n'))
  for (const workspace of workspaces) {
    await mkdir(join(root, workspace, 'test'), { recursive: true })
    await writeFile(join(root, workspace, 'package.json'), '{}')
    await writeFile(join(root, workspace, 'test', 'a.test.ts'), '')
  }
  return { root, workflows: directoryOfWorkflows }
}

describe('the paths of a matrix', () => {
  test('the path of an entry of a matrix is read', async () => {
    const { root, workflows } = await platform(
      [
        'jobs:',
        '  checks:',
        '    strategy:',
        '      matrix:',
        '        include:',
        '          - workspace: gateway',
        '            path: packages/gateway',
        '          - workspace: access',
        '            path: packages/access',
        '',
      ],
      []
    )
    expect(matrixPaths(workflows)).toEqual([
      { workflow: 'ci.yml', job: 'checks', path: 'packages/gateway' },
      { workflow: 'ci.yml', job: 'checks', path: 'packages/access' },
    ])
    expect(root).toBeDefined()
  })

  test('a workflow without a matrix has no path', async () => {
    const { workflows } = await platform(
      ['jobs:', '  build:', '    steps:', '      - run: bun run lint', ''],
      []
    )
    expect(matrixPaths(workflows)).toEqual([])
  })
})

describe('the problems of the workspaces', () => {
  test('a matrix that points at a workspace that is not there is a problem', async () => {
    const { root, workflows } = await platform(
      [
        'jobs:',
        '  checks:',
        '    strategy:',
        '      matrix:',
        '        include:',
        '          - workspace: ghost',
        '            path: packages/ghost',
        '',
      ],
      []
    )
    const problems = workspaceProblems(root, workflows)
    expect(problems).toHaveLength(1)
    expect(problems[0]?.kind).toBe('workspace')
    expect(problems[0]?.path).toBe('packages/ghost')
  })

  test('a matrix that points at a directory that is not a workspace is a problem', async () => {
    const { root, workflows } = await platform(
      [
        'jobs:',
        '  checks:',
        '    strategy:',
        '      matrix:',
        '        include:',
        '          - path: packages/empty',
        '',
      ],
      []
    )
    await mkdir(join(root, 'packages', 'empty'), { recursive: true })
    const problems = workspaceProblems(root, workflows)
    expect(problems).toHaveLength(1)
    expect(problems[0]?.message).toContain('it is not a workspace')
  })

  test('a matrix that points at a workspace that is there is not a problem', async () => {
    const { root, workflows } = await platform(
      [
        'jobs:',
        '  checks:',
        '    strategy:',
        '      matrix:',
        '        include:',
        '          - path: packages/gateway',
        '',
      ],
      ['packages/gateway']
    )
    expect(workspaceProblems(root, workflows)).toEqual([])
  })
})

describe('the problems of the tests', () => {
  test('a test that no job runs is a problem', async () => {
    const { root, workflows } = await platform(
      ['jobs:', '  checks:', '    steps:', '      - run: bun test --cwd packages/gateway test', ''],
      ['packages/gateway', 'packages/access']
    )
    const problems = testProblems(root, workflows)
    expect(problems).toHaveLength(1)
    expect(problems[0]?.kind).toBe('test')
    expect(problems[0]?.path).toBe('packages/access/test/a.test.ts')
  })

  test('a test that a job runs is not a problem', async () => {
    const { root, workflows } = await platform(
      ['jobs:', '  checks:', '    steps:', '      - run: bun test --cwd packages/gateway test', ''],
      ['packages/gateway']
    )
    expect(testProblems(root, workflows)).toEqual([])
  })

  test('a test of the root of the repository is a test of the repository', async () => {
    const { root, workflows } = await platform(
      ['jobs:', '  checks:', '    steps:', '      - run: bun test --cwd . test', ''],
      []
    )
    await mkdir(join(root, 'test'), { recursive: true })
    await writeFile(join(root, 'test', 'platform.test.ts'), '')
    expect(testProblems(root, workflows)).toEqual([])
  })
})

describe('the command of a harness', () => {
  test('the command of a suite is read from the harness', () => {
    const content = [
      "export const DEFAULT_COMMAND = ['bun', 'test', 'test/compatibility']",
      '',
    ].join('\n')
    expect(harnessCommandOf(content)).toEqual(['bun', 'test', 'test/compatibility'])
  })

  test('a harness that declares no command runs no test', () => {
    expect(harnessCommandOf('export const nothing = 1')).toBeUndefined()
  })

  test('a harness whose command cannot be read is reported', () => {
    expect(harnessCommandOf('const DEFAULT_COMMAND = () => {}')).toBeUndefined()
  })

  test('the suite of the harness of the compatibility is the suite of the workspace', () => {
    const suites = harnessSuites(repository)
    const access = suites.find((suite) => suite.path.includes('packages/access'))
    expect(access?.paths).toEqual(['test/compatibility'])
    expect(access?.unreadable).toBe(false)
    // The harness of the acceptance runs a scenario of its own, and it
    // declares no suite: it is not a problem.
    const data = suites.find((suite) => suite.path.includes('packages/data'))
    expect(data?.paths).toEqual([])
    expect(data?.unreadable).toBe(false)
  })
})

describe('the test files of the repository', () => {
  test('the tests of the repository are found, and the dependencies are not', () => {
    const files = repositoryTestFiles(repository)
    expect(files).toContain('test/evidence.test.ts')
    expect(files).toContain('packages/gateway/src/app/limits.test.ts')
    expect(files).toContain('packages/gateway/examples/upstream-identity/verify.test.ts')
    expect(files.some((file) => file.includes('node_modules'))).toBe(false)
  })
})

describe('the coverage of the platform', () => {
  test('every job of the continuous integration runs a workspace that is there', () => {
    const problems = coverageProblems(repository, join(repository, '.github', 'workflows'))
    expect(problems).toEqual([])
  })

  test('every test of the repository runs in a job of the continuous integration', () => {
    const covered = coveredTests(repository, join(repository, '.github', 'workflows'))
    const files = repositoryTestFiles(repository)
    expect(files.length).toBeGreaterThan(200)
    // Every test file of the repository is run by a job, and the suite of
    // the harness of the compatibility is one of them: no job names it,
    // and the harness is the only place it is written down.
    const orphans = files.filter((file) => !covered.has(file))
    expect(orphans).toEqual([])
  })
})
