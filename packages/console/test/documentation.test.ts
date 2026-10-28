import { describe, expect, test } from 'bun:test'
import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  groupsOf,
  resolveOf,
  textOf,
  titleOfContent,
  titleOf,
  type Tree,
} from '../src/domains/documentation'
import { headingLinesOf, namesOf } from '../../../tooling/documentation'
import { parseMarkdown } from '../../../tooling/markdown'

/**
 * The documentation of the platform, in the console.
 *
 * The console shows the documents of the documentation, and it shows
 * them as they are written. The tests below hold three promises: the
 * parser reads the markdown of the documentation, the names of the
 * headings are the names the check of the documentation resolves, and
 * every document of the repository is written in the markdown the
 * parser reads.
 *
 * The last one is the promise that matters: a document that the parser
 * refuses is a document that the console cannot show, and it is found
 * here before a reader finds it.
 */

/** The root of the repository. */
const root = resolve(import.meta.dir, '../../..')

/** The directory of the documentation. */
const documentation = join(root, 'docs')

/** Every markdown file of a directory, recursively. */
async function filesOf(directory: string): Promise<string[]> {
  const found: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      found.push(...(await filesOf(path)))
      continue
    }
    if (entry.name.endsWith('.md')) found.push(path)
  }
  return found
}

describe('the markdown of the documentation', () => {
  test('a heading carries the name of its text', () => {
    const blocks = parseMarkdown('# The console\n\n### 6.2 The places\n')
    expect(blocks[0]).toMatchObject({ kind: 'heading', level: 1, id: 'the-console' })
    expect(blocks[1]).toMatchObject({ kind: 'heading', level: 3, id: '62-the-places' })
  })

  test('two headings of the same name carry two names', () => {
    const blocks = parseMarkdown('## The probes\n\n## The probes\n')
    expect(blocks[0]).toMatchObject({ kind: 'heading', id: 'the-probes' })
    expect(blocks[1]).toMatchObject({ kind: 'heading', id: 'the-probes-1' })
  })

  test('a table holds its head and its rows', () => {
    const blocks = parseMarkdown('| A | B |\n| --- | --- |\n| 1 | 2 |\n')
    expect(blocks[0]?.kind).toBe('table')
    const table = blocks[0]
    if (table?.kind !== 'table') throw new Error('the block is not a table')
    expect(table.head).toHaveLength(2)
    expect(table.rows).toHaveLength(1)
  })

  test('a pipe of a code is not the pipe of a row', () => {
    const blocks = parseMarkdown('| A | B |\n| --- | --- |\n| `a | b` | 2 |\n')
    const table = blocks[0]
    if (table?.kind !== 'table') throw new Error('the block is not a table')
    expect(table.rows[0]).toHaveLength(2)
  })

  test('a list holds its items, and a task says whether it is done', () => {
    const blocks = parseMarkdown('- one\n- [ ] a task\n- [x] a task that is done\n')
    const list = blocks[0]
    if (list?.kind !== 'list') throw new Error('the block is not a list')
    expect(list.ordered).toBe(false)
    expect(list.items).toHaveLength(3)
    expect(list.items[1]?.task).toBe(false)
    expect(list.items[2]?.task).toBe(true)
  })

  test('a block of code holds its text and its language', () => {
    const blocks = parseMarkdown('```bash\nbun run dev\n```\n')
    expect(blocks[0]).toMatchObject({ kind: 'code', language: 'bash', text: 'bun run dev' })
  })

  test('a heading in a block of code is not a heading', () => {
    const blocks = parseMarkdown('```bash\n# the access service\n```\n\n## The heading\n')
    expect(blocks[0]?.kind).toBe('code')
    expect(blocks[1]).toMatchObject({ kind: 'heading', id: 'the-heading' })
  })

  test('the parser refuses what the documentation does not write', () => {
    expect(() => parseMarkdown('![an image](a.png)\n')).toThrow()
    expect(() => parseMarkdown('a text in <b>html</b>\n')).toThrow()
    expect(() => parseMarkdown('- one\n  - two\n')).toThrow()
  })
})

describe('the documentation of the platform', () => {
  test('every document of the repository is written in the markdown of the console', async () => {
    // The promise that matters: a document that the parser refuses is
    // a document that the console cannot show.
    const files = await filesOf(documentation)
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const content = await readFile(file, 'utf8')
      expect(() => parseMarkdown(content)).not.toThrow()
    }
  })

  test('the names of the headings of a document are the names of the documentation', async () => {
    // The console names a heading the way the check of the
    // documentation names it: a link that names a heading reaches it
    // in the console as it does in a rendered document.
    for (const file of await filesOf(documentation)) {
      const content = await readFile(file, 'utf8')
      const names = namesOf(headingLinesOf(content))
      const parsed = parseMarkdown(content)
        .filter((block) => block.kind === 'heading')
        .map((block) => (block.kind === 'heading' ? block.id : ''))
      expect(parsed).toEqual(names)
    }
  })
})

describe('the urls of the documentation', () => {
  const tree: Tree = {
    documents: [
      {
        path: 'console/spec',
        source: 'docs/console/spec.md',
        directory: 'console',
        content: '# The console\n',
      },
      {
        path: 'platform/architecture',
        source: 'docs/platform/architecture.md',
        directory: 'platform',
        content: '# The architecture\n',
      },
    ],
    assets: [{ path: 'platform/atlas.html', source: 'docs/platform/atlas.html', content: '' }],
  }

  test('a link that names a document of the documentation is a url of the console', () => {
    expect(resolveOf(tree, 'docs/console/spec.md', '../platform/architecture.md')).toBe(
      '/docs/platform/architecture'
    )
  })

  test('a link that names a place keeps the place', () => {
    expect(
      resolveOf(tree, 'docs/console/spec.md', '../platform/architecture.md#the-workspaces')
    ).toBe('/docs/platform/architecture#the-workspaces')
    expect(resolveOf(tree, 'docs/console/spec.md', '#62-the-places')).toBe(
      '/docs/console/spec#62-the-places'
    )
  })

  test('a link that names a file of the documentation is a url of the console', () => {
    expect(resolveOf(tree, 'docs/console/spec.md', '../platform/atlas.html')).toBe(
      '/docs/platform/atlas.html'
    )
  })

  test('a link that leaves the documentation is a link to the repository', () => {
    expect(resolveOf(tree, 'docs/console/spec.md', '../../packages/console/README.md')).toBe(
      'https://github.com/ggpwnkthx/platform/blob/v1.0.0/packages/console/README.md'
    )
  })

  test('a link that names a url is a link of the web', () => {
    expect(resolveOf(tree, 'docs/console/spec.md', 'https://honojs.dev')).toBe('https://honojs.dev')
  })
})

describe('the tree of the documentation', () => {
  test('the groups are the directories of the documentation, and the platform comes first', () => {
    const tree: Tree = {
      documents: [
        {
          path: 'console/spec',
          source: 'docs/console/spec.md',
          directory: 'console',
          content: '# c\n',
        },
        { path: 'README', source: 'docs/README.md', directory: '', content: '# r\n' },
        {
          path: 'gateway/spec',
          source: 'docs/gateway/spec.md',
          directory: 'gateway',
          content: '# g\n',
        },
      ],
      assets: [],
    }
    expect(groupsOf(tree).map((group) => group.name)).toEqual(['', 'gateway', 'console'])
  })

  test('the access service is not named by its directory', () => {
    expect(titleOf('access')).toBe('The access service')
    expect(titleOf('data')).toBe('The data service')
    expect(titleOf('')).toBe('The documentation')
  })

  test('the text of a text is the text without its marks', () => {
    expect(
      textOf([
        { kind: 'text', text: 'The ' },
        { kind: 'strong', children: [{ kind: 'text', text: 'console' }] },
        { kind: 'text', text: ' and the ' },
        { kind: 'code', text: 'docs' },
      ])
    ).toBe('The console and the docs')
  })

  test('the title of a document is its first heading', () => {
    expect(titleOfContent('# The console\n\n## The places\n', 'the name')).toBe('The console')
    expect(titleOfContent('a document without a heading\n', 'the name')).toBe('the name')
  })
})
