import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { headingsOf, linkProblemsOf, linksOf, slugOf } from '../tooling/documentation'
import { repetitionProblemsOf, sentencesOfDocument } from '../tooling/repetition'

/**
 * The documentation of the platform.
 *
 * The documentation of the three services is one tree, at `docs/`. A
 * link that points at nothing is a dead end for the reader, and the
 * documentation is the only thing a reader has: a link that broke when
 * the documentation moved is a link that broke for everybody.
 *
 * A link names two things: the document it points at, and the place
 * inside it, when it names one. Both are resolved: a link that names a
 * heading that is not there is a dead end too, and it is a dead end
 * that nobody notices, because the reader of a document sees a link
 * that goes nowhere.
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
const DIRECTORIES = ['platform', 'gateway', 'access', 'data', 'console', 'cli']

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
    const problems = await linkProblemsOf(root, files)
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
        const match = /^(?:\.\.\/)*docs\/(gateway|access|data)\//.exec(link.path)
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

describe('the names of the headings', () => {
  test('a name is the text of the heading, in lower case, without its punctuation', () => {
    expect(slugOf('6.2 The places')).toBe('62-the-places')
    expect(slugOf('Access — HTTP API')).toBe('access--http-api')
  })

  test('the markup of a heading is not part of its name', () => {
    expect(slugOf('`POST /v1/admin/tenants`')).toBe('post-v1admintenants')
    expect(slugOf('The **rollback** of a record')).toBe('the-rollback-of-a-record')
    expect(slugOf('The [access context](spec.md) of a caller')).toBe(
      'the-access-context-of-a-caller'
    )
  })

  test('two headings of the same name carry two names', () => {
    const names = headingsOf('# A\n\n## B\n\n## B\n\n## B\n')
    expect([...names]).toEqual(['a', 'b', 'b-1', 'b-2'])
  })

  test('a heading in a block of code is not a heading of the document', () => {
    // The comment of a shell is not a heading, and a link that names it
    // points at nothing.
    const names = headingsOf('# Real\n\n```bash\n# Access\n```\n\n## Also real\n')
    expect([...names]).toEqual(['real', 'also-real'])
  })
})

describe('the links of a document', () => {
  test('a link that names a url is not a path of the repository', () => {
    const links = linksOf('a.md', '[x](https://example.com/a#b) and [y](mailto:a@b.c)')
    expect(links).toEqual([])
  })

  test('a link that names a place of its own file carries no path', () => {
    const links = linksOf('a.md', '[x](#the-places)')
    expect(links).toEqual([{ file: 'a.md', line: 1, path: '', anchor: 'the-places' }])
  })

  test('a link that names a document and a place carries both', () => {
    const links = linksOf('a.md', '[x](spec.md#62-the-places)')
    expect(links).toEqual([{ file: 'a.md', line: 1, path: 'spec.md', anchor: '62-the-places' }])
  })
})

describe('the broken links of a documentation', () => {
  test('the check refuses a link that names a place that is not there', async () => {
    // The check that never fails is not a check: the fixture holds a
    // link that names a heading that is not there, and the check has to
    // report it.
    const directory = await mkdtemp(join(tmpdir(), 'platform-docs-'))
    try {
      await mkdir(join(directory, 'docs'), { recursive: true })
      await writeFile(
        join(directory, 'docs', 'spec.md'),
        '# The specification\n\n### 6.2 The places\n'
      )
      await writeFile(
        join(directory, 'docs', 'README.md'),
        [
          '# The documentation',
          '',
          'A link that is there: [the places](spec.md#62-the-places)',
          'A link that is not there: [the holes](spec.md#62-the-holes)',
          'A link to a place of this file: [here](#the-documentation)',
          'A link to a place of this file that is not there: [there](#nowhere)',
          '',
        ].join('\n')
      )
      const problems = await linkProblemsOf(directory, [
        join(directory, 'docs', 'README.md'),
        join(directory, 'docs', 'spec.md'),
      ])
      expect(problems).toEqual([
        'docs/README.md:4 points at 62-the-holes, and docs/spec.md has no heading of that name',
        'docs/README.md:6 points at nowhere, and docs/README.md has no heading of that name',
      ])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('the check refuses a link that names a document that is not there', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platform-docs-'))
    try {
      await writeFile(join(directory, 'README.md'), 'A link: [x](spec.md#62-the-places)\n')
      const problems = await linkProblemsOf(directory, [join(directory, 'README.md')])
      expect(problems).toEqual(['README.md:1 points at spec.md, which is not there'])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

describe('the sentences of a document', () => {
  test('a paragraph is split into its sentences', () => {
    const sentences = sentencesOfDocument('a.md', 'One. Two.\n')
    expect(sentences.map((sentence) => sentence.text)).toEqual(['One.', 'Two.'])
  })

  test('a list item is a sentence of its own', () => {
    const sentences = sentencesOfDocument('a.md', '- One.\n- Two.\n')
    expect(sentences.map((sentence) => sentence.text)).toEqual(['One.', 'Two.'])
  })

  test('a heading and a table are not prose', () => {
    const sentences = sentencesOfDocument(
      'a.md',
      '# A heading\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n'
    )
    expect(sentences).toEqual([])
  })

  test('a block of code is not prose', () => {
    const sentences = sentencesOfDocument('a.md', '```bash\n# not a sentence\n```\n')
    expect(sentences).toEqual([])
  })
})

describe('the repetition of a documentation', () => {
  test('the check refuses a sentence that two documents carry', async () => {
    // The check that never fails is not a check: the fixture holds two
    // documents that say the same thing, and the check has to report it.
    const directory = await mkdtemp(join(tmpdir(), 'platform-docs-'))
    try {
      await mkdir(join(directory, 'docs'), { recursive: true })
      await writeFile(
        join(directory, 'docs', 'a.md'),
        '# A\n\nThe rule of a decision that changes a contract is written down.\n'
      )
      await writeFile(
        join(directory, 'docs', 'b.md'),
        '# B\n\nThe rule of a decision that changes a contract is written down.\n'
      )
      const problems = await repetitionProblemsOf(directory, [
        join(directory, 'docs', 'a.md'),
        join(directory, 'docs', 'b.md'),
      ])
      expect(problems).toEqual([
        'the sentence "The rule of a decision that changes a contract is written down." is in docs/a.md:3, docs/b.md:3',
      ])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('the check refuses a sentence that one document carries twice', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platform-docs-'))
    try {
      await mkdir(join(directory, 'docs'), { recursive: true })
      await writeFile(
        join(directory, 'docs', 'a.md'),
        '# A\n\nThe rule of a decision that changes a contract is written down.\n\n' +
          'The rule of a decision that changes a contract is written down.\n'
      )
      const problems = await repetitionProblemsOf(directory, [join(directory, 'docs', 'a.md')])
      expect(problems).toEqual([
        'the sentence "The rule of a decision that changes a contract is written down." is in docs/a.md:3, docs/a.md:5',
      ])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('the check holds a pointer that two documents carry', async () => {
    // Two documents may point at the same place: the reader of the
    // second follows the pointer and reads the rule where it is said.
    const directory = await mkdtemp(join(tmpdir(), 'platform-docs-'))
    try {
      await mkdir(join(directory, 'docs'), { recursive: true })
      await writeFile(
        join(directory, 'docs', 'a.md'),
        '# A\n\nThe rule is in [the decisions of the platform](decisions.md).\n'
      )
      await writeFile(
        join(directory, 'docs', 'b.md'),
        '# B\n\nThe rule is in [the decisions of the platform](decisions.md).\n'
      )
      const problems = await repetitionProblemsOf(directory, [
        join(directory, 'docs', 'a.md'),
        join(directory, 'docs', 'b.md'),
      ])
      expect(problems).toEqual([])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('no sentence of the documentation is said twice', async () => {
    const files = await filesOf(docs)
    const problems = await repetitionProblemsOf(root, files)
    expect(problems).toEqual([])
  })
})
