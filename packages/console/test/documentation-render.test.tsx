import { describe, expect, test } from 'bun:test'
import { parseMarkdown } from '../../../tooling/markdown'
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
