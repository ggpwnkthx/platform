/**
 * The frame of the documentation pages: the sidebar of every document,
 * the article, and the outline of the page.
 *
 * Below 900px the sidebar folds into a "Browse docs" drawer; below
 * 1200px the outline moves above the article. Both are rendered twice
 * (once per breakpoint) so the page works without a script.
 */

import type { Child } from 'hono/jsx'
import { groupsOf, labelOf, type OutlineItem, type Tree, urlOf } from '../../domains/documentation'
import DocEnhancer from '../islands/doc-enhancer'

/** The list of every group and document of the documentation. */
function DocsNav(props: { tree: Tree; current: string | null }) {
  // The documentation's own README has no group of its own: it is the
  // page to start with, listed under the home of the documentation.
  const all = groupsOf(props.tree)
  const root = all.find((group) => group.name === '')
  const groups = all.filter((group) => group !== root)
  return (
    <nav class="docs-nav" aria-label="Documentation">
      <ul class="docs-nav-home">
        <li>
          <a href="/docs" aria-current={props.current === null ? 'page' : undefined}>
            Home
          </a>
        </li>
        {root?.index ? (
          <li>
            <a
              href={urlOf(root.index.path)}
              aria-current={root.index.path === props.current ? 'page' : undefined}
            >
              Where to start
            </a>
          </li>
        ) : null}
      </ul>
      {groups.map((group) => {
        const documents = group.index ? [group.index, ...group.documents] : group.documents
        return (
          <section>
            <h2>{group.title}</h2>
            <ul>
              {documents.map((document) => (
                <li>
                  <a
                    href={urlOf(document.path)}
                    aria-current={document.path === props.current ? 'page' : undefined}
                  >
                    {labelOf(document)}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </nav>
  )
}

/** The headings of the page, as links. */
function OutlineList(props: { items: readonly OutlineItem[] }) {
  return (
    <ol>
      {props.items.map((item) => (
        <li class={`level-${item.level}`}>
          <a href={`#${item.id}`}>{item.text}</a>
        </li>
      ))}
    </ol>
  )
}

/** The frame of a documentation page. */
export function DocsShell(props: {
  tree: Tree
  /** The path of the document shown, or null on the index. */
  current: string | null
  /** The outline of the page; omitted on pages without one. */
  outline?: readonly OutlineItem[]
  /**
   * Whether the outline is shown above the article on narrow screens. A
   * document with its own table of contents does not need a second one
   * in the same column.
   */
  inlineOutline?: boolean
  children: Child
}) {
  const outline = props.outline ?? []
  const hasOutline = outline.length > 1
  return (
    <div class={`docs-shell${hasOutline ? ' has-toc' : ''}`}>
      <aside class="docs-sidebar">
        <DocsNav tree={props.tree} current={props.current} />
      </aside>
      <details class="docs-drawer">
        <summary>Browse docs</summary>
        <DocsNav tree={props.tree} current={props.current} />
      </details>
      <div class="docs-main">
        {hasOutline && props.inlineOutline !== false ? (
          <details class="docs-toc-inline">
            <summary>On this page</summary>
            <OutlineList items={outline} />
          </details>
        ) : null}
        {props.children}
      </div>
      {hasOutline ? (
        <aside class="docs-toc" aria-label="On this page">
          <p class="docs-toc-title">On this page</p>
          <OutlineList items={outline} />
        </aside>
      ) : null}
      <DocEnhancer />
    </div>
  )
}
