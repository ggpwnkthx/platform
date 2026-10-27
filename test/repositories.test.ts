import { describe, expect, test } from 'bun:test'
import { readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import {
  PLATFORM_IMAGES,
  PLATFORM_OWNER,
  PLATFORM_REPOSITORY,
  isNameOfThePlatform,
  repositoryReferencesOf,
} from '../tooling/repositories'

/**
 * The one repository of the platform.
 *
 * The platform is one repository, and it names one: the one it lives
 * in, the three images it publishes, and the mirrors of the
 * compatibility suite. The three services were published from three
 * repositories of their own, and those repositories are gone: a clone
 * of one fails, an image published in one is not reachable, and a file
 * that names one sends a reader to a dead end.
 *
 * The check does not name the repositories that are gone: it refuses
 * every repository but the one of the platform.
 */
const root = join(import.meta.dir, '..')

/** The directories that hold no file of the platform. */
const SKIPPED = ['node_modules', '.git', '.pg', '.access', 'dist', 'coverage', '.tmp']

/** Every file of a directory, recursively. */
async function filesOf(directory: string): Promise<string[]> {
  const found: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (SKIPPED.includes(entry.name)) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      found.push(...(await filesOf(path)))
      continue
    }
    found.push(path)
  }
  return found
}

/**
 * The name of a repository that the platform does not have.
 *
 * The name is built here and not written: a file of the platform that
 * names a repository that is not there is a file the check refuses,
 * and this one is not exempt.
 */
function foreignName(): string {
  return 'gone'
}

/** The name of a mirror of a repository that the platform does not have. */
function foreignMirror(): string {
  return `${foreignName()}.git`
}

describe('the one repository of the platform', () => {
  test('no file of the platform names a repository that it does not have', async () => {
    const problems: string[] = []
    for (const file of await filesOf(root)) {
      const path = relative(root, file).split('\\').join('/')
      const content = await readFile(file, 'utf8')
      if (content.includes('\0')) continue
      for (const reference of repositoryReferencesOf(content)) {
        problems.push(`${path}:${reference.line} names ${reference.name}`)
      }
    }
    expect(problems).toEqual([])
  })

  test('a url of another repository is reported', () => {
    const references = repositoryReferencesOf(
      `git clone --bare https://github.com/${PLATFORM_OWNER}/${foreignName()}.git /srv/mirror/gateway.git\n`
    )
    expect(references).toEqual([{ line: 1, name: 'gone', kind: 'repository' }])
  })

  test('an image that is not one of the three is reported', () => {
    const references = repositoryReferencesOf(
      `image: ghcr.io/${PLATFORM_OWNER}/${foreignName()}:1.0.0\n`
    )
    expect(references).toEqual([{ line: 1, name: 'gone', kind: 'image' }])
  })

  test('a mirror of another repository is reported', () => {
    const references = repositoryReferencesOf(`the mirror is /srv/mirror/${foreignMirror()}\n`)
    expect(references).toEqual([{ line: 1, name: 'gone', kind: 'mirror' }])
  })

  test('the line of the reference is reported', () => {
    const references = repositoryReferencesOf(
      `one\ntwo\nthree ${PLATFORM_OWNER}/${foreignName()}\n`
    )
    expect(references).toEqual([{ line: 3, name: 'gone', kind: 'name' }])
  })

  test('the repository of the platform is not reported', () => {
    expect(
      repositoryReferencesOf(`https://github.com/${PLATFORM_OWNER}/${PLATFORM_REPOSITORY}.git\n`)
    ).toEqual([])
  })

  test('the images of the platform are not reported', () => {
    for (const image of PLATFORM_IMAGES) {
      expect(repositoryReferencesOf(`image: ghcr.io/${PLATFORM_OWNER}/${image}:1.0.0\n`)).toEqual(
        []
      )
    }
  })

  test('the mirrors of the platform are not reported', () => {
    for (const name of [PLATFORM_REPOSITORY, ...PLATFORM_IMAGES]) {
      expect(repositoryReferencesOf(`the mirror is /srv/mirror/${name}.git\n`)).toEqual([])
    }
  })

  test('the names of the platform are the ones it owns', () => {
    expect(isNameOfThePlatform(PLATFORM_REPOSITORY)).toBe(true)
    for (const image of PLATFORM_IMAGES) expect(isNameOfThePlatform(image)).toBe(true)
    expect(isNameOfThePlatform('gone')).toBe(false)
  })
})
