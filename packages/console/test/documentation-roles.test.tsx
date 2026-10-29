import { describe, expect, test } from 'bun:test'
import { DocsNav } from '../src/app/components/docs-shell'
import {
  type Document,
  roleChoiceUrlOf,
  roleNeighboursOf,
  roleOf,
  rolesFor,
  rolesOf,
  targetOf,
  type Tree,
} from '../src/domains/documentation'

/**
 * The roles of the documentation.
 *
 * The console reads the roles from the role pages and from nothing else:
 * a role is its page, its sections are the page's headings, and its pages
 * are the ones the sections link to. The navigation of a reader who chose
 * a role leads with that map; the rest of the documentation stays
 * reachable, folded under it.
 */

/** A document of a tree, with its content. */
function documentOf(path: string, content: string): Document {
  const directory = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
  const title = /^# (.*)$/m.exec(content)?.[1] ?? path
  return { path, source: `docs/${path}.md`, directory, content, title, summary: `About ${title}.` }
}

const tree: Tree = {
  documents: [
    documentOf(
      'roles/README',
      '# By role\n\n| Role | Start |\n| --- | --- |\n| Ops | [sysops](sysops.md) |\n| Dev | [developer](developer.md) |\n'
    ),
    documentOf(
      'roles/developer',
      '# Application developer\n\nYou write code.\n\n## Start here\n\n1. [Gateway](../gateway/README.md), first.\n'
    ),
    documentOf(
      'roles/sysops',
      [
        '# Platform operator',
        '',
        'You run the platform.',
        '',
        '## Start here',
        '',
        '1. [Gateway](../gateway/README.md) and the [atlas](../platform/atlas.html).',
        '2. [Operations](../gateway/operations.md).',
        '',
        '## Common tasks',
        '',
        '| Task | Guide |',
        '| --- | --- |',
        '| Rotate a secret | [Rotate](../gateway/operations.md#secrets) |',
        '| Read the probes | [Gateway](../gateway/spec.md), [Data](../data/spec.md) |',
        '',
        '## Not docs',
        '',
        'See [CONTRIBUTING.md](../../CONTRIBUTING.md), the [web](https://example.com) and the [developer](developer.md).',
      ].join('\n')
    ),
    ...['gateway/README', 'gateway/operations', 'gateway/spec', 'data/README', 'data/spec'].map(
      (path) => documentOf(path, `# ${path}\n`)
    ),
  ],
  assets: [{ path: 'platform/atlas.html', source: 'docs/platform/atlas.html', content: '' }],
}

const roles = rolesOf(tree)
const sysops = roleOf(roles, 'sysops')!

describe('the roles of the documentation', () => {
  test('the roles are the role pages, in the order the index of the roles names them', () => {
    expect(roles.map((role) => role.id)).toEqual(['sysops', 'developer'])
    expect(sysops.title).toBe('Platform operator')
    expect(sysops.summary).toBe('About Platform operator.')
  })

  test('a section of a role is a heading of its page, with the links under it', () => {
    expect(sysops.sections.map((section) => section.title)).toEqual(['Start here', 'Common tasks'])
    const [start] = sysops.sections
    expect(start?.entries.map((entry) => entry.label)).toEqual(['Gateway', 'Operations'])
    expect(start?.entries[0]?.links.map((link) => link.label)).toEqual(['Atlas'])
    expect(start?.entries[0]?.links[0]).toMatchObject({
      path: 'platform/atlas.html',
      document: false,
    })
  })

  test('a row that names its task is labelled by the task, and keeps its anchor', () => {
    const [, tasks] = sysops.sections
    expect(tasks?.entries[0]).toMatchObject({
      label: 'Rotate a secret',
      href: '/docs/gateway/operations#secrets',
      links: [],
    })
    // A row with several answers names them beside its task.
    expect(tasks?.entries[1]?.href).toBeNull()
    expect(tasks?.entries[1]?.links.map((link) => link.href)).toEqual([
      '/docs/gateway/spec',
      '/docs/data/spec',
    ])
  })

  test('the repository, the web and the other roles are not pages of a role', () => {
    expect(sysops.sections.some((section) => section.title === 'Not docs')).toBe(false)
  })

  test('the pages of a role are its page, then what it links to, once, in order', () => {
    expect(sysops.pages).toEqual([
      'roles/sysops',
      'gateway/README',
      'gateway/operations',
      'gateway/spec',
      'data/spec',
    ])
  })

  test('a page is read by the roles that link to it', () => {
    expect(rolesFor(roles, 'gateway/README').map((role) => role.id)).toEqual([
      'sysops',
      'developer',
    ])
    expect(rolesFor(roles, 'data/README')).toEqual([])
    expect(rolesFor(roles, 'roles/sysops')).toEqual([])
  })

  test('a role is walked in its own order', () => {
    const walk = roleNeighboursOf(tree, sysops, 'gateway/operations')
    expect(walk?.previous?.path).toBe('gateway/README')
    expect(walk?.next?.path).toBe('gateway/spec')
    expect(walk).toMatchObject({ position: 3, total: 5 })
    expect(roleNeighboursOf(tree, sysops, 'data/README')).toBeNull()
  })

  test('an unknown role is no role', () => {
    expect(roleOf(roles, 'nobody')).toBeNull()
    expect(roleOf(roles, undefined)).toBeNull()
  })

  test('the choice of a role is an address of the documentation', () => {
    expect(roleChoiceUrlOf('sysops', 'gateway/operations')).toBe(
      '/docs?role=sysops&to=gateway%2Foperations'
    )
    expect(roleChoiceUrlOf('all', null)).toBe('/docs?role=all')
  })

  test('a link names a document, a file of the documentation, the repository or the web', () => {
    const from = 'docs/roles/sysops.md'
    expect(targetOf(tree, from, '../gateway/spec.md#2-x')).toEqual({
      kind: 'document',
      path: 'gateway/spec',
      anchor: '#2-x',
    })
    expect(targetOf(tree, from, '../platform/atlas.html').kind).toBe('asset')
    expect(targetOf(tree, from, '../../README.md')).toEqual({
      kind: 'repository',
      path: 'README.md',
      anchor: '',
    })
    expect(targetOf(tree, from, 'https://example.com').kind).toBe('web')
  })
})

describe('the navigation of a reader', () => {
  async function nav(current: string | null, role: string | null): Promise<string> {
    const element = (
      <DocsNav tree={tree} current={current} roles={roles} role={roleOf(roles, role)} />
    )
    return String(await element.toString())
  }

  test('without a role, the roles are offered first, each a choice that comes back to the page', async () => {
    const html = await nav('gateway/spec', null)
    expect(html).toContain('<p class="docs-nav-label">Read as</p>')
    expect(html).toContain('href="/docs?role=sysops&amp;to=gateway%2Fspec">Platform operator</a>')
    expect(html.indexOf('Read as')).toBeLessThan(html.indexOf('docs-nav-area'))
    expect(html).not.toContain('All documentation')
  })

  test("with a role, the role's map leads and every area is folded under it", async () => {
    const html = await nav('gateway/operations', 'sysops')
    expect(html).toContain('Reading as')
    expect(html).toContain(
      '<a class="docs-role-name" href="/docs/roles/sysops">Platform operator</a>'
    )
    expect(html).toContain('href="/docs/gateway/operations" aria-current="page">Operations</a>')
    expect(html).toContain('href="/docs/gateway/operations#secrets" aria-current="location">')
    expect(html).toContain('<details class="docs-nav-all">')
    expect(html.indexOf('class="docs-nav-role"')).toBeLessThan(html.indexOf('class="docs-nav-all"'))
    expect(html).toContain(
      'href="/docs?role=all&amp;to=gateway%2Foperations">Everyone (no role)</a>'
    )
  })

  test("a page off the role's map shows where it sits first, open on its area", async () => {
    const html = await nav('data/README', 'sysops')
    expect(html).toContain('<details class="docs-nav-all" open="">')
    expect(html.indexOf('class="docs-nav-all"')).toBeLessThan(html.indexOf('class="docs-nav-role"'))
    expect(html).toContain(
      '<details class="docs-nav-area" open=""><summary class="docs-nav-area-summary">Data</summary>'
    )
  })
})
