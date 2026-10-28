import { describe, expect, test } from 'bun:test'
import { parseMarkdown } from '../../../tooling/markdown'
import { DocsNav } from '../src/app/components/docs-shell'
import { DocumentBlocks } from '../src/app/components/documentation'
import type { Tree } from '../src/domains/documentation'

/** Renders markdown the way a documentation page does. */
async function render(markdown: string): Promise<string> {
  const tree: Tree = { documents: [], assets: [] }
  const element = <DocumentBlocks blocks={parseMarkdown(markdown)} tree={tree} from="docs/x/y.md" />
  return String(await element.toString())
}

describe('the rendering of a documentation page', () => {
  test('a callout carries its kind and its label', async () => {
    const html = await render('> [!WARNING]\n> Rotate the **secret** first.\n')
    expect(html).toContain('class="callout warning"')
    expect(html).toContain('<p class="callout-title">Warning</p>')
    expect(html).toContain('<strong>secret</strong>')
    expect(html).not.toContain('[!WARNING]')
  })

  test('a plain quote stays a quote', async () => {
    expect(await render('> Just a quote.\n')).toContain('<blockquote>')
  })

  test('a code block names its language and offers a copy button', async () => {
    const html = await render('```bash\nbun run dev\n```\n')
    expect(html).toContain('<figure class="code-block">')
    expect(html).toContain('<span>bash</span>')
    expect(html).toContain('data-copy')
    expect(html).toContain('<code>bun run dev</code>')
  })

  test('a heading carries a permalink to itself', async () => {
    const html = await render('## 6.2 The places\n')
    expect(html).toContain('id="62-the-places"')
    expect(html).toContain('href="#62-the-places"')
  })
})

describe('the navigation of the documentation', () => {
  /** A tree of two areas, each with a guide, a reference page and internals. */
  const tree: Tree = {
    documents: ['gateway', 'data'].flatMap((directory) =>
      ['README', 'operations', 'spec', 'internals'].map((name) => ({
        path: `${directory}/${name}`,
        source: `docs/${directory}/${name}.md`,
        directory,
        content: `# ${name}\n`,
        title: name,
        summary: '',
      }))
    ),
    assets: [],
  }

  async function nav(current: string | null): Promise<string> {
    return String(await (<DocsNav tree={tree} current={current} />).toString())
  }

  test('on the home, the navigation lists the areas and nothing else', async () => {
    const html = await nav(null)
    expect(html).toContain('href="/docs/gateway/README">Gateway</a>')
    expect(html).not.toContain('<details')
    expect(html).not.toContain('/docs/gateway/internals')
  })

  test('on a page, only its area is open, and the internals stay folded', async () => {
    const html = await nav('gateway/operations')
    expect(html).toContain(
      '<details class="docs-nav-area" open=""><summary class="docs-nav-area-summary">Gateway</summary>'
    )
    expect(html).toContain(
      '<details class="docs-nav-area"><summary class="docs-nav-area-summary">Data service</summary>'
    )
    expect(html).toContain('<p class="docs-nav-label">Reference</p>')
    expect(html).toContain(
      '<details class="docs-nav-internals"><summary class="docs-nav-internals-summary">Internals</summary>'
    )
  })

  test('the internals open when the page is one of them', async () => {
    const html = await nav('gateway/internals')
    expect(html).toContain(
      '<details class="docs-nav-internals" open=""><summary class="docs-nav-internals-summary">Internals</summary>'
    )
  })
})
