/**
 * A page of the documentation.
 *
 * The document is shown as it is written, inside the documentation
 * frame: the sidebar, the outline, and links to the previous and next
 * pages. Files of the documentation that are not markdown (the atlas)
 * are served as they are.
 */

import { createRoute } from 'honox/factory'
import { DocsShell } from '../../components/docs-shell'
import { DocumentBlocks, Inlines } from '../../components/documentation'
import {
  type Document,
  labelOf,
  ledeOf,
  navigatesItself,
  neighboursOf,
  outlineOf,
  sourceUrlOf,
  tierOf,
  titleOf,
  urlOf,
} from '../../../domains/documentation'
import { DOCUMENTATION, renderedOf } from '../../documentation'

/** A link to the previous or next page. */
function PagerLink(props: { document: Document | null; direction: 'previous' | 'next' }) {
  if (!props.document) return <span />
  return (
    <a class={`doc-pager-link ${props.direction}`} href={urlOf(props.document.path)}>
      <span class="doc-pager-label">
        {props.direction === 'previous' ? '← Previous' : 'Next →'}
      </span>
      <span class="doc-pager-title">{labelOf(props.document)}</span>
      <span class="doc-pager-group">{titleOf(props.document.directory)}</span>
    </a>
  )
}

export default createRoute(async (c) => {
  const path = c.req.param('path') ?? ''
  const asset = DOCUMENTATION.assets.find((item) => item.path === path)
  if (asset) return c.html(asset.content)
  const rendered = renderedOf(path)
  if (!rendered) return c.notFound()
  const { document, title, blocks } = rendered
  const { lede, body } = ledeOf(blocks)
  const group = titleOf(document.directory)
  const groupIndex = DOCUMENTATION.documents.find(
    (item) => item.directory === document.directory && item.path.endsWith('README')
  )
  const { previous, next } = neighboursOf(DOCUMENTATION, document.path)
  const tree = DOCUMENTATION
  const tier = tierOf(document)
  return c.render(
    <DocsShell
      tree={tree}
      current={document.path}
      outline={outlineOf(body)}
      inlineOutline={!navigatesItself(rendered)}
    >
      <article class="doc-article">
        <header class="doc-head">
          <nav aria-label="Breadcrumbs">
            <ol class="crumbs">
              <li>
                <a href="/docs">Documentation</a>
              </li>
              <li>
                {groupIndex && groupIndex.path !== document.path ? (
                  <a href={urlOf(groupIndex.path)}>{group}</a>
                ) : (
                  <span>{group}</span>
                )}
              </li>
              {tier === 'reference' || tier === 'internals' ? (
                <li>
                  <span>{tier === 'reference' ? 'Reference' : 'Internals'}</span>
                </li>
              ) : null}
            </ol>
          </nav>
          <h1>{title}</h1>
          {tier === 'internals' ? (
            <p class="doc-banner">
              Maintainer documentation — you don't need this to use or operate the platform.
            </p>
          ) : null}
          {lede ? (
            <p class="doc-lede">
              <Inlines inlines={lede} tree={tree} from={document.source} />
            </p>
          ) : null}
        </header>
        <div class="doc">
          <DocumentBlocks blocks={body} tree={tree} from={document.source} />
        </div>
        <footer class="doc-foot">
          <nav class="doc-pager" aria-label="Previous and next pages">
            <PagerLink document={previous} direction="previous" />
            <PagerLink document={next} direction="next" />
          </nav>
          <p class="doc-source">
            <a href={sourceUrlOf(document.source)}>View source on GitHub</a>
            <span class="muted"> · {document.source}</span>
          </p>
        </footer>
      </article>
    </DocsShell>,
    { title: `${title} · ${group}`, section: 'docs', wide: true }
  )
})
