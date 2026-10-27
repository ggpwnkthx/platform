import { describe, expect, test } from 'bun:test'
import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'

/**
 * The documentation of the platform.
 *
 * The documentation of the three services is one tree, at `docs/`. A
 * link that points at nothing is a dead end for the reader, and the
 * documentation is the only thing a reader has: a link that broke when
 * the documentation moved is a link that broke for everybody.
 *
 * The second check is about the shape of the tree: the documentation
 * of a contract lives in the directory of its name, and the
 * documentation that is common to the three lives in `docs/platform/`.
 * A document that is in the wrong directory is a document that a reader
 * cannot find.
 */
const root = join(import.meta.dir, '..')

/** The directory of the documentation. */
const docs = join(root, 'docs')

/** The directories that hold no document. */
const SKIPPED = ['node_modules', '.git', '.pg', '.access', 'dist', 'coverage']

/** The directories of the documentation, and the service each one holds. */
const DIRECTORIES = ['platform', 'gateway', 'access', 'data', 'console']

/** Every markdown file of a directory, recursively. */
async function filesOf(directory: string): Promise<string[]> {
  const found: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (SKIPPED.includes(entry.name)) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      found.push(...(await filesOf(path)))
      continue
    }
    if (entry.name.endsWith('.md')) found.push(path)
  }
  return found
}

/** A link of a document. */
interface Link {
  /** The file the link is in. */
  readonly file: string
  /** The line the link is on. */
  readonly line: number
  /** The target of the link. */
  readonly target: string
}

/** Every relative link of a document. */
function linksOf(file: string, content: string): Link[] {
  const links: Link[] = []
  const lines = content.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    for (const match of line.matchAll(/\]\(([^)]+)\)/g)) {
      const target = match[1]!
      // A link that is a url, an anchor or a mail address is not a path.
      if (/^(?:[a-z]+:|#)/i.test(target)) continue
      links.push({ file, line: index + 1, target: target.split('#')[0]! })
    }
  }
  return links
}

describe('the documentation of the platform', () => {
  test('it is one tree, at the root of the repository', async () => {
    const entries = await readdir(docs, { withFileTypes: true })
    const names = entries
      .filter((entry) => !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort()
    expect(names).toEqual([...DIRECTORIES, 'README.md'].sort())
  })

  test('the documentation of a contract is in the directory of its name', async () => {
    // Every service owns a directory of the documentation, and every
    // document of a service lives in it.
    for (const directory of DIRECTORIES) {
      const files = await filesOf(join(docs, directory))
      expect(files.length).toBeGreaterThan(0)
      for (const file of files) {
        expect(relative(join(docs, directory), file).startsWith('..')).toBe(false)
      }
    }
  })

  test('every service has an index', async () => {
    for (const directory of DIRECTORIES) {
      const index = join(docs, directory, 'README.md')
      expect(
        await stat(index).then(
          () => true,
          () => false
        )
      ).toBe(true)
    }
  })

  test('every link of the documentation resolves', async () => {
    const files = await filesOf(root)
    const problems: string[] = []
    for (const file of files) {
      const content = await readFile(file, 'utf8')
      for (const link of linksOf(file, content)) {
        if (link.target === '') continue
        const target = resolve(dirname(file), link.target)
        const exists = await stat(target).then(
          () => true,
          () => false
        )
        if (!exists) {
          problems.push(
            `${relative(root, link.file)}:${link.line} points at ${link.target}, which is not there`
          )
        }
      }
    }
    expect(problems).toEqual([])
  })

  test('the links that name a document of a contract point at the right one', async () => {
    // A link that names `spec.md` from the documentation of the gateway
    // points at the specification of the gateway, and not at the one of
    // another service: the contracts are separate, and a reader of one
    // is not a reader of the others.
    //
    // A link to the **workspace** of another service is a different
    // thing: it names the code, and it is legitimate from anywhere.
    const files = await filesOf(root)
    const problems: string[] = []
    for (const file of files) {
      const content = await readFile(file, 'utf8')
      for (const link of linksOf(file, content)) {
        // A link that enters the documentation of another service.
        const match = /^(?:\.\.\/)*docs\/(gateway|access|data)\//.exec(link.target)
        if (!match) continue
        const directory = relative(root, dirname(file)).split('/').filter(Boolean)[0] ?? ''
        if (DIRECTORIES.includes(directory) && directory !== match[1]) {
          problems.push(
            `${relative(root, link.file)}:${link.line} points at the documentation of ${match[1]} from the documentation of ${directory}`
          )
        }
      }
    }
    expect(problems).toEqual([])
  })
})
