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
})
