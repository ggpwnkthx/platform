import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathsOf, PUBLISHED_CLIENT, SHARED_CLIENT, unknownPaths } from '../tooling/client-paths'

/**
 * The paths of the clients of the data API.
 *
 * The published client of Data and the client of the console and of the
 * CLI are two copies of the same paths, and the check refuses the
 * published one when it names a path that the other does not know.
 */
const root = join(import.meta.dir, '..')

describe('the paths of the clients of the data', () => {
  test('the published client names no path the clients of the platform do not know', async () => {
    const published = pathsOf(
      PUBLISHED_CLIENT,
      await readFile(join(root, PUBLISHED_CLIENT), 'utf8')
    )
    const shared = pathsOf(SHARED_CLIENT, await readFile(join(root, SHARED_CLIENT), 'utf8'))
    expect(unknownPaths(published, shared)).toEqual([])
  })

  test('a path of a template keeps its placeholders', () => {
    const source = ['const path = `/items/', '$', '{key}', '/', '$', '{id}', '/versions`\n'].join(
      ''
    )
    const paths = pathsOf('client.ts', source)
    expect(paths.map((entry) => entry.path)).toEqual(['/items/{…}/{…}/versions'])
  })

  test('a query is not a path', () => {
    const source = ['const path = `/audit', '$', '{suffix}`\n'].join('')
    const paths = pathsOf('client.ts', source)
    expect(paths.map((entry) => entry.path)).toEqual(['/audit'])
  })

  test('a literal that is not a path is not read', () => {
    const paths = pathsOf('client.ts', "const note = 'the path of the request'\n")
    expect(paths).toEqual([])
  })

  test('a path the shared client does not know is reported', () => {
    const published = pathsOf('published.ts', "const path = '/gone'\n")
    const shared = pathsOf('shared.ts', "const path = '/me'\n")
    expect(unknownPaths(published, shared)).toEqual(['/gone'])
  })
})
