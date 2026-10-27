import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  parseCompatibilityManifest,
  readCompatibilityManifest,
  selectBaseline,
} from '../tooling/compatibility/manifest'
import {
  cloneAt,
  revisionOf,
  sourceForCommit,
  trackedChanges,
  useWorkspace,
} from '../tooling/compatibility/reference'

/**
 * The baseline of the compatibility of the platform.
 *
 * Before the merge the baseline named two repositories and two commits:
 * the gateway and the access service were repositories of their own. They
 * are workspaces of this repository now, and the baseline is the revision
 * of the repository that the platform was released at — the revision the
 * manifest pins, and the revision the candidates are tested against.
 *
 * These tests exercise the manifest and the acquisition of the references
 * with small repositories of their own: they need no network, and they
 * prove that the suite tests the revision of the workspace, that it
 * refuses a workspace that carries changes, and that it can still test a
 * published revision of a service.
 */

const workspaces: string[] = []

afterEach(async () => {
  for (const workspace of workspaces.splice(0)) {
    await rm(workspace, { recursive: true, force: true })
  }
})

/** Creates a directory that is removed at the end of the test. */
async function directory(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix))
  workspaces.push(path)
  return path
}

/** Runs a git command in a directory. */
function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.toString()}`)
  }
  return result.stdout.toString().trim()
}

/** Creates a repository with two commits. */
async function repository(): Promise<{ path: string; first: string; second: string }> {
  const path = await directory('platform-compatibility-repository-')
  git(path, 'init', '--quiet', '--initial-branch=main')
  git(path, 'config', 'user.email', 'compatibility@platform.test')
  git(path, 'config', 'user.name', 'the compatibility of the tests')
  await writeFile(join(path, 'a.txt'), 'a\n')
  git(path, 'add', '.')
  git(path, 'commit', '--quiet', '-m', 'the first commit')
  const first = git(path, 'rev-parse', 'HEAD')
  await writeFile(join(path, 'b.txt'), 'b\n')
  git(path, 'add', '.')
  git(path, 'commit', '--quiet', '-m', 'the second commit')
  const second = git(path, 'rev-parse', 'HEAD')
  return { path, first, second }
}

describe('the manifest of the baseline', () => {
  test('the manifest of the repository is a valid baseline', async () => {
    const manifest = await readCompatibilityManifest(
      join(resolve(import.meta.dir, '..'), 'compatibility.json')
    )
    expect(manifest.version).toBe(2)
    expect(manifest.workspaces.gateway.path).toBe('packages/gateway')
    expect(manifest.workspaces.access.path).toBe('packages/access')
    expect(manifest.workspaces.data.path).toBe('packages/data')
  })

  test('the gateway and the access service are pinned to a revision', async () => {
    const manifest = await readCompatibilityManifest(
      join(resolve(import.meta.dir, '..'), 'compatibility.json')
    )
    // The references are pinned: a suite that compares the tree with
    // itself proves that the tree agrees with the tree.
    expect(manifest.workspaces.gateway.source?.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(manifest.workspaces.access.source?.commit).toMatch(/^[0-9a-f]{40}$/)
    // The data service is the candidate: it is the service under test.
    expect(manifest.workspaces.data.source).toBeUndefined()
  })

  test('a workspace that names a source is a reference', () => {
    const commit = 'b'.repeat(40)
    const manifest = parseCompatibilityManifest(
      JSON.stringify({
        version: 2,
        repository: 'https://example.test/platform.git',
        workspaces: {
          gateway: {
            path: 'packages/gateway',
            source: { repository: 'https://example.test/gateway.git', commit },
          },
          access: 'packages/access',
          data: 'packages/data',
        },
      })
    )
    expect(manifest.workspaces.gateway.path).toBe('packages/gateway')
    expect(manifest.workspaces.gateway.source?.repository).toBe('https://example.test/gateway.git')
    expect(manifest.workspaces.gateway.source?.commit).toBe(commit)
    expect(manifest.workspaces.access.source).toBeUndefined()
  })

  test('a source that is not a revision is refused', () => {
    expect(() =>
      parseCompatibilityManifest(
        JSON.stringify({
          version: 2,
          repository: 'https://example.test/platform.git',
          workspaces: {
            gateway: {
              path: 'packages/gateway',
              source: { repository: 'https://example.test/gateway.git', commit: 'main' },
            },
            access: 'packages/access',
            data: 'packages/data',
          },
        })
      )
    ).toThrow('must name a full revision of forty hexadecimal characters')
  })

  test('a workspace of an unknown shape is refused', () => {
    expect(() =>
      parseCompatibilityManifest(
        '{"version":2,"repository":"https://example.test","workspaces":{"gateway":42,"access":"a","data":"d"}}'
      )
    ).toThrow('the workspace "gateway" of the baseline must name a path')
  })

  test('a manifest of another version is refused', () => {
    expect(() => parseCompatibilityManifest('{"version":1,"repositories":{}}')).toThrow(
      'the manifest of the baseline must have the version 2'
    )
  })

  test('a manifest without a workspace is refused', () => {
    expect(() =>
      parseCompatibilityManifest(
        '{"version":2,"repository":"https://example.test","workspaces":{}}'
      )
    ).toThrow('the manifest of the baseline must hold the workspaces of the platform')
  })

  test('a manifest that names an unknown workspace is refused', () => {
    expect(() =>
      parseCompatibilityManifest(
        '{"version":2,"repository":"https://example.test","workspaces":{"gateway":"packages/gateway","other":"other"}}'
      )
    ).toThrow('the manifest of the baseline has unknown workspaces: other')
  })

  test('the baseline is the revision of the repository when nothing overrides it', async () => {
    const manifest = await readCompatibilityManifest(
      join(resolve(import.meta.dir, '..'), 'compatibility.json')
    )
    const baseline = selectBaseline(manifest, {})
    expect(baseline.isBaseline).toBe(true)
    expect(baseline.overrides).toEqual([])
    expect(baseline.workspaces.gateway?.path).toBe('packages/gateway')
  })

  test('an override is a candidate and not the baseline', async () => {
    const manifest = await readCompatibilityManifest(
      join(resolve(import.meta.dir, '..'), 'compatibility.json')
    )
    const commit = 'a'.repeat(40)
    const baseline = selectBaseline(manifest, {
      GATEWAY_REPOSITORY: 'https://example.test/gateway.git',
      GATEWAY_COMMIT: commit,
    })
    expect(baseline.isBaseline).toBe(false)
    expect(baseline.overrides).toEqual(['GATEWAY_REPOSITORY', 'GATEWAY_COMMIT'])
    expect(baseline.workspaces.gateway?.commit).toBe(commit)
  })

  test('an override that is not a revision is refused', async () => {
    const manifest = await readCompatibilityManifest(
      join(resolve(import.meta.dir, '..'), 'compatibility.json')
    )
    expect(() => selectBaseline(manifest, { GATEWAY_COMMIT: 'main' })).toThrow(
      'GATEWAY_COMMIT must name a full revision of forty hexadecimal characters'
    )
  })

  test('the pin of the manifest is the baseline and not an override', async () => {
    const manifest = await readCompatibilityManifest(
      join(resolve(import.meta.dir, '..'), 'compatibility.json')
    )
    const baseline = selectBaseline(manifest, {})
    expect(baseline.isBaseline).toBe(true)
    expect(baseline.overrides).toEqual([])
    // The reference of the gateway is the pinned revision, and the
    // candidate of the data service is the tree of the working directory.
    expect(baseline.workspaces.gateway?.commit).toBe(manifest.workspaces.gateway.source?.commit)
    expect(baseline.workspaces.data?.commit).toBeUndefined()
  })

  test('the environment wins over the pin of the manifest', async () => {
    const manifest = await readCompatibilityManifest(
      join(resolve(import.meta.dir, '..'), 'compatibility.json')
    )
    const commit = 'c'.repeat(40)
    const baseline = selectBaseline(manifest, { GATEWAY_COMMIT: commit })
    expect(baseline.isBaseline).toBe(false)
    expect(baseline.workspaces.gateway?.commit).toBe(commit)
    expect(baseline.workspaces.access?.commit).toBe(manifest.workspaces.access.source?.commit)
  })
})

describe('the reference of the suite', () => {
  test('a workspace is used as it is and its revision is the head of the repository', async () => {
    const { path, second } = await repository()
    const reference = useWorkspace(path)
    expect(reference.path).toBe(path)
    expect(reference.revision).toBe(second)
    expect(reference.workspace).toBe(true)
  })

  test('a workspace that carries changes is refused', async () => {
    const { path } = await repository()
    await writeFile(join(path, 'a.txt'), 'changed\n')
    expect(() => useWorkspace(path)).toThrow('carries changes to its tracked files')
  })

  test('the tracked changes of a directory are read from the repository', async () => {
    const { path } = await repository()
    expect(trackedChanges(path, path)).toBe('')
    await writeFile(join(path, 'a.txt'), 'changed\n')
    expect(trackedChanges(path, path)).not.toBe('')
  })

  test('a published revision is cloned at the revision it names', async () => {
    const { path, first } = await repository()
    const workspace = await directory('platform-compatibility-checkout-')
    const checkout = join(workspace, 'reference')
    cloneAt(path, first, checkout)
    expect(revisionOf(checkout)).toBe(first)
    // The clone is at the first commit: the file of the second one is
    // not there, and a clone at the head of the source is not a pin.
    expect(await readFile(join(checkout, 'a.txt'), 'utf8')).toBe('a\n')
  })

  test('a source that does not hold the revision is an error', async () => {
    const { path } = await repository()
    const workspace = await directory('platform-compatibility-checkout-')
    const checkout = join(workspace, 'reference')
    expect(() => cloneAt(path, 'b'.repeat(40), checkout)).toThrow('does not hold the pinned commit')
  })

  test('the local repository is the source of a clone when it holds the revision', async () => {
    const { path, first } = await repository()
    // The url of the manifest is a url that cannot be cloned: the
    // repository that holds the revision is the local one.
    const source = sourceForCommit('https://example.test/not-published', first, '', path)
    expect(source).toBe(path)
  })

  test('the url is the source when no repository holds the revision', async () => {
    const { path } = await repository()
    const source = sourceForCommit('https://example.test/not-published', 'd'.repeat(40), '', path)
    expect(source).toBe('https://example.test/not-published')
  })
})
