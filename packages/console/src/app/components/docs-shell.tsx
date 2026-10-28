/**
 * The frame of the documentation pages: the sidebar of every document,
 * the article, and the outline of the page.
 *
 * Below 900px the sidebar folds into a "Browse docs" drawer; below
 * 1200px the outline moves above the article. Both are rendered twice
 * (once per breakpoint) so the page works without a script.
 */

import type { Child } from 'hono/jsx'
import {
  type Document,
  type Group,
  groupsOf,
  labelOf,
  type OutlineItem,
  type Tree,
  urlOf,
} from '../../domains/documentation'
import DocEnhancer from '../islands/doc-enhancer'

/** A list of links to documents. */
function NavList(props: { documents: readonly Document[]; current: string | null }) {
  return (
    <ul>
      {props.documents.map((document) => (
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
  )
}

/**
 * The pages of one area: its overview and guides, its reference under a
 * label, and its internals folded away unless the reader is in them.
 */
function AreaPages(props: { group: Group; current: string | null }) {
  const { group, current } = props
  const inInternals = group.internals.some((document) => document.path === current)
  return (
    <>
      <NavList
        documents={[...(group.index ? [group.index] : []), ...group.guides]}
        current={current}
      />
      {group.reference.length > 0 ? (
        <>
          <p class="docs-nav-label">Reference</p>
          <NavList documents={group.reference} current={current} />
        </>
      ) : null}
      {group.internals.length > 0 ? (
        <details class="docs-nav-internals" open={inInternals}>
          <summary class="docs-nav-internals-summary">Internals</summary>
          <NavList documents={group.internals} current={current} />
        </details>
      ) : null}
    </>
  )
}

/**
 * The navigation of the documentation. On the home it is short: the
 * areas, each linking to its overview. On a page, every area is a folded
 * section, and only the area of the page is open.
 */
export function DocsNav(props: { tree: Tree; current: string | null }) {
  const all = groupsOf(props.tree)
  const root = all.find((group) => group.name === '')
  const groups = all.filter((group) => group !== root)
  const document = props.tree.documents.find((item) => item.path === props.current)
  const area = document?.directory ?? null
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
      {document === undefined ? (
        <>
          <p class="docs-nav-label">Areas</p>
          <ul class="docs-nav-areas">
            {groups.map((group) => (
              <li>
                <a href={group.index ? urlOf(group.index.path) : '/docs'}>{group.title}</a>
              </li>
            ))}
          </ul>
        </>
      ) : (
        groups.map((group) => (
          <details class="docs-nav-area" open={group.name === area}>
            <summary class="docs-nav-area-summary">{group.title}</summary>
            <AreaPages group={group} current={props.current} />
          </details>
        ))
      )}
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
