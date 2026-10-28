/**
 * A document of the documentation of the platform.
 *
 * The console shows the document as it is written, and every link of
 * it is rewritten to the address of its target: the reader walks the
 * documentation in the console the way the reader of the repository
 * walks it.
 */

import { createRoute } from 'honox/factory'
import { DocumentBlocks } from '../../components/documentation'
import { PageHead } from '../../components/page'
import { textOf, titleOf } from '../../../domains/documentation'
import { DOCUMENTATION, renderedOf } from '../../documentation'

export default createRoute(async (c) => {
  const path = c.req.param('path') ?? ''
  // The files of the documentation that are not documents are served as
  // they are: the atlas of the platform is a page of its own.
  const asset = DOCUMENTATION.assets.find((item) => item.path === path)
  if (asset) return c.html(asset.content)
  const rendered = renderedOf(path)
  if (!rendered) return c.notFound()
  const { document, title, blocks } = rendered
  const headings = blocks.filter(
    (block) => block.kind === 'heading' && block.level >= 2 && block.level <= 3
  )
  return c.render(
    <>
      <PageHead title={title} eyebrow={titleOf(document.directory)} />
      {headings.length > 1 ? (
        <nav class="toc" aria-label="The document">
          <ol>
            {headings.map((heading) =>
              heading.kind === 'heading' ? (
                <li class={`level-${heading.level}`}>
                  <a href={`#${heading.id}`}>{textOf(heading.inline)}</a>
                </li>
              ) : null
            )}
          </ol>
        </nav>
      ) : null}
      <article class="doc">
        <DocumentBlocks blocks={blocks} tree={DOCUMENTATION} from={document.source} />
      </article>
    </>,
    {
      title,
      section: 'docs',
      crumbs: [{ label: 'The documentation', href: '/docs' }, { label: title }],
    }
  )
})
