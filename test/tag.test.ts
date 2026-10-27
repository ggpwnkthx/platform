import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { compareVersions, decideTag, outputsOf, readTags } from '../scripts/tag'

/**
 * The tag of a release of the platform.
 *
 * The tagger cuts the tag of a release when the version of the package
 * goes up. These tests exercise the decision — the part that decides —
 * and the reading of the tags, with small repositories of their own: they
 * need no network, and they prove that the tagger cuts a tag when the
 * version went up, that it does nothing when it did not, and that it
 * refuses a version that went down.
 *
 * There was one tagger per repository before the merge. There is one
 * now: the three services share the release line of the platform.
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
function git(cwd: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  }
}

/** Creates a repository with a tag. */
async function repository(tags: string[]): Promise<string> {
  const path = await directory('platform-tag-repository-')
  git(path, ['init', '--quiet', '--initial-branch=main'])
  git(path, ['config', 'user.email', 'tagger@platform.test'])
  git(path, ['config', 'user.name', 'the tagger of the tests'])
  spawnSync('git', ['commit', '--quiet', '--allow-empty', '-m', 'a commit'], { cwd: path })
  for (const tag of tags) {
    git(path, ['tag', tag])
  }
  return path
}

describe('the comparison of the versions of a release', () => {
  test('the versions are compared by number and not by text', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1)
    expect(compareVersions('1.9.0', '1.10.0')).toBe(-1)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('2.0.0', '1.99.99')).toBe(1)
  })
})

describe('the decision of the tagger', () => {
  test('the tag is cut when the version went up', () => {
    const decision = decideTag({
      version: '1.0.0',
      tagged: [{ tag: 'v0.9.0', version: '0.9.0' }],
    })
    expect(decision.action).toBe('create')
    expect(decision.tag).toBe('v1.0.0')
  })

  test('the tag is cut when the repository carries no tag', () => {
    const decision = decideTag({ version: '1.0.0', tagged: [] })
    expect(decision.action).toBe('create')
    expect(decision.tag).toBe('v1.0.0')
  })

  test('nothing is done when the version did not go up', () => {
    const decision = decideTag({
      version: '1.0.0',
      tagged: [{ tag: 'v1.0.0', version: '1.0.0' }],
    })
    expect(decision.action).toBe('keep')
    expect(decision.tag).toBeNull()
  })

  test('the tag of the version is never cut twice', () => {
    const decision = decideTag({
      version: '1.0.0',
      tagged: [{ tag: 'v1.0.0', version: '1.0.0' }],
    })
    expect(decision.action).toBe('keep')
  })

  test('a version that went down is refused', () => {
    const decision = decideTag({
      version: '0.9.0',
      tagged: [{ tag: 'v1.0.0', version: '1.0.0' }],
    })
    expect(decision.action).toBe('refuse')
    expect(decision.tag).toBeNull()
  })

  test('a version that is not the version of a release is refused', () => {
    const decision = decideTag({ version: '1.0', tagged: [] })
    expect(decision.action).toBe('refuse')
  })

  test('a pre-release is not the version of a release', () => {
    const decision = decideTag({ version: '1.0.0-rc.1', tagged: [] })
    expect(decision.action).toBe('refuse')
  })

  test('the highest tag is the one of the highest version', () => {
    const decision = decideTag({
      version: '1.1.0',
      tagged: [
        { tag: 'v0.9.0', version: '0.9.0' },
        { tag: 'v0.10.0', version: '0.10.0' },
      ],
    })
    expect(decision.action).toBe('create')
    expect(decision.tag).toBe('v1.1.0')
  })
})

describe('the tags of a repository', () => {
  test('the tags that name a version are read', async () => {
    const path = await repository(['v1.0.0', 'v0.9.0', 'someone'])
    const tags = readTags(path)
    expect(tags.map((tag) => tag.tag).sort()).toEqual(['v0.9.0', 'v1.0.0'])
  })

  test('a repository without a tag holds none', async () => {
    const path = await repository([])
    expect(readTags(path)).toEqual([])
  })
})

describe('the outputs of the tagger', () => {
  test('the outputs name the tag and say that it was cut', () => {
    const decision = decideTag({ version: '1.0.0', tagged: [] })
    expect(outputsOf(decision)).toEqual({ tag: 'v1.0.0', created: true })
  })

  test('the outputs of a tag that was not cut are empty', () => {
    const decision = decideTag({
      version: '1.0.0',
      tagged: [{ tag: 'v1.0.0', version: '1.0.0' }],
    })
    expect(outputsOf(decision)).toEqual({ tag: '', created: false })
  })
})
