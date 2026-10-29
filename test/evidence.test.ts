import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  cellsOf,
  citationsOf,
  isPathLike,
  isReached,
  isTestPath,
  pathsOf,
  problemsOf,
  resolveCitation,
  workspaceOf,
} from '../tooling/evidence'
import { coveredTests, isTestFile, splitCommand, testCommandsOf } from '../tooling/ci'

/**
 * The evidence of the decisions.
 *
 * The check has one purpose: a decision that cites a test has to cite a
 * test that runs. These tests prove that the check reads the citations
 * and that it reports the ones that are broken — the check that never
 * fails is not a check.
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

describe('the cells of a table', () => {
  test('the cells of a row are the parts between the pipes', () => {
    expect(cellsOf('| 1 | The question | The decision | resolved | `a.ts` |')).toEqual([
      '1',
      'The question',
      'The decision',
      'resolved',
      '`a.ts`',
    ])
  })

  test('a line that is not a row has no cells', () => {
    expect(cellsOf('a line of prose')).toEqual([])
  })
})

describe('the paths of a cell', () => {
  test('a path is written in backquotes or in a link', () => {
    expect(pathsOf('`src/a.ts`, `test/b.test.ts`')).toEqual(['src/a.ts', 'test/b.test.ts'])
    expect(pathsOf('[the runtime](runtime.md) and `src/a.ts`')).toEqual(['runtime.md', 'src/a.ts'])
  })

  test('a name is not a path', () => {
    // The name of a package is not a path of the repository.
    expect(pathsOf('`@data-backend/client` is a package')).toEqual([])
    expect(pathsOf('`GATEWAY_SESSION_SECRET` is a secret')).toEqual([])
  })

  test('a token that names a file is a path', () => {
    expect(isPathLike('src/a.ts')).toBe(true)
    expect(isPathLike('docs/gateway/')).toBe(true)
    expect(isPathLike('@data-backend/client')).toBe(false)
  })
})

describe('the citations of a document', () => {
  test('the column of the evidence is the one the header names', async () => {
    const path = join(await directory('evidence-'), 'decisions.md')
    await writeFile(
      path,
      [
        '| # | Question | Decision | Status | Evidence |',
        '| --- | --- | --- | --- | --- |',
        '| 1 | The question | The decision | resolved | `src/a.ts`, `test/b.test.ts` |',
        '| 2 | Another | Another | resolved | [the runtime](runtime.md) |',
        '',
      ].join('\n')
    )
    const citations = citationsOf(path)
    expect(citations).toHaveLength(3)
    expect(citations[0]?.path).toBe('src/a.ts')
    expect(citations[0]?.decision).toBe('1 The question')
    expect(citations[1]?.path).toBe('test/b.test.ts')
    expect(citations[2]?.path).toBe('runtime.md')
  })

  test('a document without a column of the evidence has no citation', async () => {
    const path = join(await directory('evidence-'), 'decisions.md')
    await writeFile(
      path,
      [
        '| # | Question | Decision |',
        '| --- | --- | --- |',
        '| 1 | The question | `src/a.ts` |',
        '',
      ].join('\n')
    )
    expect(citationsOf(path)).toEqual([])
  })
})

describe('the resolution of a citation', () => {
  test('a path is resolved against the document, the workspace and the repository', async () => {
    const root = await directory('evidence-')
    const document = join(root, 'docs', 'gateway')
    const workspace = join(root, 'packages', 'gateway')
    await mkdir(document, { recursive: true })
    await mkdir(workspace, { recursive: true })
    await writeFile(join(document, 'runtime.md'), 'x')
    await writeFile(join(workspace, 'src.ts'), 'x')
    await writeFile(join(root, 'root.md'), 'x')
    const roots = { repository: root, document, workspace }
    expect(resolveCitation('runtime.md', roots)).toBe(join(document, 'runtime.md'))
    expect(resolveCitation('src.ts', roots)).toBe(join(workspace, 'src.ts'))
    expect(resolveCitation('root.md', roots)).toBe(join(root, 'root.md'))
    expect(resolveCitation('nowhere.ts', roots)).toBeUndefined()
  })

  test('the workspace of a document is the one that owns it', () => {
    expect(workspaceOf(join(repository, 'docs', 'gateway', 'decisions.md'), repository)).toBe(
      join(repository, 'packages', 'gateway')
    )
    expect(
      workspaceOf(join(repository, 'docs', 'platform', 'decisions.md'), repository)
    ).toBeUndefined()
  })
})

describe('the problems of the evidence', () => {
  test('a cited path that is not there is a problem', async () => {
    const root = await directory('evidence-')
    const problems = problemsOf(
      [{ document: 'd', decision: '1', path: 'nowhere.ts' }],
      { repository: root, document: root },
      new Set()
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]?.message).toBe('the cited path is not there')
  })

  test('a cited test that the continuous integration does not run is a problem', async () => {
    const root = await directory('evidence-')
    await mkdir(join(root, 'test'), { recursive: true })
    await writeFile(join(root, 'test', 'a.test.ts'), '')
    const problems = problemsOf(
      [{ document: 'd', decision: '1', path: 'test/a.test.ts' }],
      { repository: root, document: root },
      new Set()
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]?.message).toBe('the cited test is not run by the continuous integration')
  })

  test('a cited test that runs is not a problem', async () => {
    const root = await directory('evidence-')
    await mkdir(join(root, 'test'), { recursive: true })
    await writeFile(join(root, 'test', 'a.test.ts'), '')
    const problems = problemsOf(
      [{ document: 'd', decision: '1', path: 'test/a.test.ts' }],
      { repository: root, document: root },
      new Set(['test/a.test.ts'])
    )
    expect(problems).toEqual([])
  })

  test('a cited suite that nothing reaches is a problem', async () => {
    const root = await directory('evidence-')
    await mkdir(join(root, 'test', 'support'), { recursive: true })
    await writeFile(join(root, 'test', 'support', 'suite.ts'), '')
    await writeFile(join(root, 'test', 'a.test.ts'), 'import { x } from "./support/suite"')
    const problems = problemsOf(
      [{ document: 'd', decision: '1', path: 'test/support/suite.ts' }],
      { repository: root, document: root },
      new Set()
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]?.message).toBe(
      'the cited suite is not reached by a test that the continuous integration runs'
    )
  })

  test('a cited suite that a running test reaches is not a problem', async () => {
    const root = await directory('evidence-')
    await mkdir(join(root, 'test', 'support'), { recursive: true })
    await writeFile(join(root, 'test', 'support', 'suite.ts'), '')
    await writeFile(join(root, 'test', 'a.test.ts'), 'import { x } from "./support/suite"')
    const problems = problemsOf(
      [{ document: 'd', decision: '1', path: 'test/support/suite.ts' }],
      { repository: root, document: root },
      new Set(['test/a.test.ts']),
      [join(root, 'test', 'a.test.ts')]
    )
    expect(problems).toEqual([])
  })
})

describe('the coverage of the continuous integration', () => {
  test('a command is split into its words', () => {
    expect(splitCommand('bun test --cwd packages/gateway test/integration')).toEqual([
      'bun',
      'test',
      '--cwd',
      'packages/gateway',
      'test/integration',
    ])
    expect(splitCommand('bun run "a b"')).toEqual(['bun', 'run', 'a b'])
  })

  test('a test file is a file whose name carries the word of the test', () => {
    expect(isTestFile('/a/b.test.ts')).toBe(true)
    expect(isTestFile('/a/b.spec.ts')).toBe(true)
    expect(isTestFile('/a/b.ts')).toBe(false)
    expect(isTestPath('test/a.test.ts')).toBe(true)
    expect(isTestPath('src/a.ts')).toBe(false)
  })

  test('a script of a workspace names the tests it runs', () => {
    const found = testCommandsOf(
      [{ workflow: 'w', job: 'j', command: 'bun run --cwd packages/gateway test' }],
      repository
    )
    expect(found).toHaveLength(1)
    expect(found[0]?.directory).toBe(join(repository, 'packages', 'gateway'))
    expect(found[0]?.paths).toEqual([
      'src',
      'test/contract',
      'test/architecture',
      'examples',
      'services',
    ])
  })

  test('the continuous integration runs the suites of the network of the gateway', () => {
    const covered = coveredTests(repository, join(repository, '.github', 'workflows'))
    // The suite that holds the boundaries of the transport: it was the
    // evidence of a decision of the runtime, and no job of the
    // continuous integration ran it.
    expect(covered.has('packages/gateway/test/network/transport.test.ts')).toBe(true)
    expect(covered.has('packages/gateway/test/fuzz/parsers.test.ts')).toBe(true)
    expect(covered.has('packages/gateway/test/load/soak.test.ts')).toBe(true)
    expect(covered.has('packages/gateway/test/contract/endpoints.test.ts')).toBe(true)
    expect(covered.has('packages/access/test/integration/grants.test.ts')).toBe(true)
    // The tests of the root of the repository are run by the suite of
    // the platform: the command names them with a wildcard.
    expect(covered.has('test/evidence.test.ts')).toBe(true)
  })

  test('the continuous integration runs the suites of the workspace of the client', () => {
    const covered = coveredTests(repository, join(repository, '.github', 'workflows'))
    expect(covered.has('packages/data/packages/client/test/client.test.ts')).toBe(true)
  })
})

describe('the reach of a suite', () => {
  test('a file that is imported by a running test is reached', async () => {
    const root = await directory('evidence-')
    await mkdir(join(root, 'test', 'support'), { recursive: true })
    const suite = join(root, 'test', 'support', 'suite.ts')
    const test = join(root, 'test', 'a.test.ts')
    await writeFile(suite, '')
    await writeFile(test, 'import { x } from "./support/suite"')
    expect(isReached(suite, [test])).toBe(true)
    expect(isReached(suite, [])).toBe(false)
  })
})
