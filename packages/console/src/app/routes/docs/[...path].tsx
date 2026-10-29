/**
 * A page of the documentation.
 *
 * The document is shown as it is written, inside the documentation
 * frame: the sidebar, the outline, and links to the previous and next
 * pages. Files of the documentation that are not markdown (the atlas)
 * are served as they are.
 *
 * The page knows the reader's role. It names the roles that read it —
 * each a way to read the documentation as that role — and when the
 * reader's role reads it, the previous and next pages follow the role's
 * reading order instead of the directories.
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
  type Role,
  roleChoiceUrlOf,
  roleNeighboursOf,
  rolesFor,
  sourceUrlOf,
  tierOf,
  titleOf,
  urlOf,
} from '../../../domains/documentation'
import { DOCUMENTATION, readerRoleOf, renderedOf, ROLES } from '../../documentation'

/** A link to the previous or next page. */
function PagerLink(props: {
  document: Document | null
  direction: 'previous' | 'next'
  /** What the page is part of: its area, or the role whose order is walked. */
  group?: string
}) {
  if (!props.document) return <span />
  return (
    <a class={`doc-pager-link ${props.direction}`} href={urlOf(props.document.path)}>
      <span class="doc-pager-label">
        {props.direction === 'previous' ? '← Previous' : 'Next →'}
      </span>
      <span class="doc-pager-title">{labelOf(props.document)}</span>
      <span class="doc-pager-group">{props.group ?? titleOf(props.document.directory)}</span>
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
  const role = readerRoleOf(c)
  const walk = role ? roleNeighboursOf(DOCUMENTATION, role, document.path) : null
  const { previous, next } = walk ?? neighboursOf(DOCUMENTATION, document.path)
  const pagerGroup = walk && role ? `${role.title} · ${walk.position} of ${walk.total}` : undefined
  const readers = rolesFor(ROLES, document.path)
  const pageRole: Role | null = ROLES.find((item) => item.page.path === document.path) ?? null
  const tree = DOCUMENTATION
  const tier = tierOf(document)
  return c.render(
    <DocsShell
      tree={tree}
      current={document.path}
      outline={outlineOf(body)}
      inlineOutline={!navigatesItself(rendered)}
      roles={ROLES}
      role={role}
    >
      <article class="doc-article">
        <header class="doc-head">
          <nav aria-label="Breadcrumbs">
            <ol class="crumbs">
              <li>
                <a href="/docs">Documentation</a>
              </li>
              {role && walk && role.page.path !== document.path ? (
                <li>
                  <a href={urlOf(role.page.path)}>{role.title}</a>
                </li>
              ) : null}
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
          {pageRole && pageRole.id !== role?.id ? (
            <p class="doc-role-banner">
              <a class="doc-path-primary" href={roleChoiceUrlOf(pageRole.id, document.path)}>
                Read the documentation as {pageRole.title} →
              </a>
              <span class="muted">
                {' '}
                The sidebar, the home and the previous and next links then follow this page.
              </span>
            </p>
          ) : null}
          {readers.length > 0 ? (
            <p class="doc-readers">
              <span class="doc-readers-label">Read by</span>
              {readers.map((reader) =>
                reader.id === role?.id ? (
                  <span class="doc-chip is-current" aria-current="true">
                    {reader.title}
                  </span>
                ) : (
                  <a
                    class="doc-chip"
                    href={roleChoiceUrlOf(reader.id, document.path)}
                    title={`Read the documentation as ${reader.title}`}
                  >
                    {reader.title}
                  </a>
                )
              )}
            </p>
          ) : null}
        </header>
        <div class="doc">
          <DocumentBlocks blocks={body} tree={tree} from={document.source} />
        </div>
        <footer class="doc-foot">
          <nav class="doc-pager" aria-label="Previous and next pages">
            <PagerLink document={previous} direction="previous" group={pagerGroup} />
            <PagerLink document={next} direction="next" group={pagerGroup} />
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
