/**
 * The frame of the documentation pages: the sidebar of every document,
 * the article, and the outline of the page.
 *
 * The sidebar revolves around the reader's role. A reader who chose a
 * role sees that role's page as a map — where to start, its tasks, its
 * reference, what to do when something breaks — and the rest of the
 * documentation folded under it, by area. A reader without a role is
 * offered the roles first, then the areas.
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
  type Role,
  type RoleEntry,
  type RoleLink,
  roleChoiceUrlOf,
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

/** How a link of a role relates to the page the reader is on. */
function currentOf(link: RoleLink, current: string | null): 'page' | 'location' | undefined {
  if (link.path !== current) return undefined
  return link.anchor === '' ? 'page' : 'location'
}

/** One entry of a role's map: its label, and the other pages that answer it. */
function RoleEntryItem(props: { entry: RoleEntry; current: string | null }) {
  const { entry, current } = props
  const own = entry.href ? entry.targets.find((link) => link.href === entry.href) : undefined
  return (
    <li>
      {entry.href ? (
        <a href={entry.href} aria-current={own ? currentOf(own, current) : undefined}>
          {entry.label}
        </a>
      ) : (
        <span class="docs-nav-entry">{entry.label}</span>
      )}
      {entry.links.length > 0 ? (
        <span class="docs-nav-also">
          {entry.links.map((link) => (
            <a class="docs-nav-also-link" href={link.href} aria-current={currentOf(link, current)}>
              {link.label}
            </a>
          ))}
        </span>
      ) : null}
    </li>
  )
}

/** The map of a role: the sections of its page, with their entries. */
function RoleMap(props: { role: Role; current: string | null; titled?: boolean }) {
  const { role, current } = props
  return (
    <div class={`docs-nav-role${props.titled ? ' is-titled' : ''}`}>
      {props.titled ? <p class="docs-nav-role-title">{role.title}: your pages</p> : null}
      {role.sections.map((section) => (
        <>
          <p class="docs-nav-label">{section.title}</p>
          <ul class="docs-nav-entries">
            {section.entries.map((entry) => (
              <RoleEntryItem entry={entry} current={current} />
            ))}
          </ul>
        </>
      ))}
    </div>
  )
}

/**
 * Who the reader reads as. With a role: its name, which leads to its
 * page, and the other roles folded under "Change role". Without one: the
 * roles, each a choice.
 */
function RoleChoice(props: { roles: readonly Role[]; role: Role | null; current: string | null }) {
  const { roles, role, current } = props
  if (!role) {
    return (
      <div class="docs-role">
        <p class="docs-nav-label">Read as</p>
        <ul class="docs-nav-roles">
          {roles.map((item) => (
            <li>
              <a href={roleChoiceUrlOf(item.id, current)}>{item.title}</a>
            </li>
          ))}
        </ul>
      </div>
    )
  }
  return (
    <div class="docs-role is-chosen">
      <p class="docs-nav-label">Reading as</p>
      <a
        class="docs-role-name"
        href={urlOf(role.page.path)}
        aria-current={role.page.path === current ? 'page' : undefined}
      >
        {role.title}
      </a>
      <details class="docs-role-switch">
        <summary class="docs-role-switch-summary">Change role</summary>
        <ul class="docs-nav-roles">
          {roles
            .filter((item) => item.id !== role.id)
            .map((item) => (
              <li>
                <a href={roleChoiceUrlOf(item.id, current)}>{item.title}</a>
              </li>
            ))}
          <li>
            <a href={roleChoiceUrlOf('all', current)}>Everyone (no role)</a>
          </li>
        </ul>
      </details>
    </div>
  )
}

/** The areas of the documentation, each a folded section; the area of the page is open. */
function AreaSections(props: {
  groups: readonly Group[]
  area: string | null
  current: string | null
}) {
  return (
    <>
      {props.groups.map((group) => (
        <details class="docs-nav-area" open={group.name === props.area}>
          <summary class="docs-nav-area-summary">{group.title}</summary>
          <AreaPages group={group} current={props.current} />
        </details>
      ))}
    </>
  )
}

/** Every area of the documentation, folded under one summary, for a reader with a role. */
function AllDocumentation(props: {
  root: Group | undefined
  groups: readonly Group[]
  area: string | null
  current: string | null
  open: boolean
}) {
  const index = props.root?.index
  return (
    <details class="docs-nav-all" open={props.open}>
      <summary class="docs-nav-all-summary">All documentation</summary>
      {index ? (
        <ul class="docs-nav-home">
          <li>
            <a
              href={urlOf(index.path)}
              aria-current={index.path === props.current ? 'page' : undefined}
            >
              Where to start
            </a>
          </li>
        </ul>
      ) : null}
      <AreaSections groups={props.groups} area={props.area} current={props.current} />
    </details>
  )
}

/**
 * The navigation of the documentation.
 *
 * With a role, the role's map leads, and every area waits under "All
 * documentation". A page off the role's map turns the two around: the
 * areas come first, open on the page's own, and the map follows.
 * Without a role, the roles are offered first; then, on the home, the
 * areas link to their overviews, and on a page every area is a folded
 * section with only the page's area open.
 */
export function DocsNav(props: {
  tree: Tree
  current: string | null
  roles?: readonly Role[]
  role?: Role | null
}) {
  const roles = props.roles ?? []
  const role = props.role ?? null
  const all = groupsOf(props.tree)
  const root = all.find((group) => group.name === '')
  const groups = all.filter((group) => group !== root)
  const document = props.tree.documents.find((item) => item.path === props.current)
  const area = document?.directory ?? null
  const onMap = role !== null && props.current !== null && role.pages.includes(props.current)
  return (
    <nav class="docs-nav" aria-label="Documentation">
      <ul class="docs-nav-home">
        <li>
          <a href="/docs" aria-current={props.current === null ? 'page' : undefined}>
            Home
          </a>
        </li>
        {root?.index && !role ? (
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
      {roles.length > 0 ? <RoleChoice roles={roles} role={role} current={props.current} /> : null}
      {role ? (
        onMap || document === undefined ? (
          <>
            <RoleMap role={role} current={props.current} />
            <AllDocumentation
              root={root}
              groups={groups}
              area={null}
              current={props.current}
              open={false}
            />
          </>
        ) : (
          // A page off the role's map: where it sits comes first, the map after it.
          <>
            <AllDocumentation
              root={root}
              groups={groups}
              area={area}
              current={props.current}
              open
            />
            <RoleMap role={role} current={props.current} />
          </>
        )
      ) : document === undefined ? (
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
        <AreaSections groups={groups} area={area} current={props.current} />
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
  /** The roles of the documentation. */
  roles?: readonly Role[]
  /** The role the reader reads as, or null. */
  role?: Role | null
  children: Child
}) {
  const outline = props.outline ?? []
  const hasOutline = outline.length > 1
  return (
    <div class={`docs-shell${hasOutline ? ' has-toc' : ''}`}>
      <aside class="docs-sidebar">
        <DocsNav tree={props.tree} current={props.current} roles={props.roles} role={props.role} />
      </aside>
      <details class="docs-drawer">
        <summary>{props.role ? `Docs for ${props.role.title}` : 'Browse docs'}</summary>
        <DocsNav tree={props.tree} current={props.current} roles={props.roles} role={props.role} />
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
