/**
 * The home of the documentation, built around the reader's role.
 *
 * A reader without a role chooses one: a card per role page, with what
 * the job owns and a few of its tasks. A reader with a role finds that
 * role's map — where to start, its tasks, its reference, what to do when
 * something breaks — and the rest of the documentation below it, by
 * area. Anybody may read it.
 *
 * The same address takes the choice: `/docs?role=<role>` keeps the role
 * in a preference cookie and `/docs?role=all` forgets it; `to` names the
 * page to show next, and only a page of the documentation is followed.
 */

import { deleteCookie, setCookie } from 'hono/cookie'
import type { Child } from 'hono/jsx'
import { createRoute } from 'honox/factory'
import { DocsShell } from '../../components/docs-shell'
import {
  type Document,
  type Group,
  groupsOf,
  labelOf,
  type Role,
  type RoleEntry,
  type RoleSection,
  roleChoiceUrlOf,
  roleOf,
  titleOf,
  urlOf,
} from '../../../domains/documentation'
import { DOCUMENTATION, readerRoleOf, ROLE_COOKIE, ROLES } from '../../documentation'

/** How long the choice of a role is kept: a year, like the theme. */
const ROLE_MAX_AGE = 60 * 60 * 24 * 365

/** The pages a newcomer of any role starts with, when the documentation holds them. */
const NEW_HERE: readonly string[] = ['platform/README', 'platform/concepts', 'platform/quickstart']

/** The atlas: the platform on one page. */
const ATLAS = 'platform/atlas.html'

/** The groups that the home shows on their own, and not among the areas. */
const NOT_AREAS = ['', 'roles', 'guides']

/** The document of a path, if the documentation holds it. */
function find(path: string): Document | undefined {
  return DOCUMENTATION.documents.find((document) => document.path === path)
}

/** A link to a page, named by its area and label. */
function Chip(props: { href: string; children: Child }) {
  return (
    <a class="doc-chip" href={props.href}>
      {props.children}
    </a>
  )
}

/** The section of a role a card previews: its tasks, or else its first section. */
function previewOf(role: Role): RoleSection | undefined {
  return role.sections.find((section) => /task|building/i.test(section.title)) ?? role.sections[0]
}

/** One entry of a role section: the label, and the other pages that answer it. */
function Entry(props: { entry: RoleEntry }) {
  const { entry } = props
  return (
    <li>
      {entry.href ? (
        <a class="doc-entry-link" href={entry.href}>
          {entry.label}
        </a>
      ) : (
        <span class="doc-entry-label">{entry.label}</span>
      )}
      {entry.links.length > 0 ? (
        <span class="doc-entry-also">
          {entry.links.map((link) => (
            <a class="doc-entry-also-link" href={link.href}>
              {link.label}
            </a>
          ))}
        </span>
      ) : null}
    </li>
  )
}

/** The card of a role the reader may choose. */
function RoleCard(props: { role: Role }) {
  const { role } = props
  const preview = previewOf(role)
  return (
    <article class="doc-role">
      <h3 class="doc-role-title">
        <a class="doc-role-title-link" href={roleChoiceUrlOf(role.id, null)}>
          {role.title}
        </a>
      </h3>
      {role.summary ? <p class="doc-role-summary">{role.summary}</p> : null}
      {preview ? (
        <>
          <p class="doc-role-label">{preview.title}</p>
          <ul class="doc-role-preview">
            {preview.entries.slice(0, 3).map((entry) => (
              <li>{entry.label}</li>
            ))}
          </ul>
        </>
      ) : null}
      <a class="doc-path-primary doc-role-choose" href={roleChoiceUrlOf(role.id, null)}>
        Read as {role.title} →
      </a>
    </article>
  )
}

/** The section of a role, as a card of the role's home. */
function SectionCard(props: { section: RoleSection }) {
  const { section } = props
  const ordered = /start/i.test(section.title)
  const entries = section.entries.map((entry) => <Entry entry={entry} />)
  return (
    <section class={`doc-role-section${ordered ? ' is-path' : ''}`}>
      <h2>{section.title}</h2>
      {ordered ? <ol class="doc-entries">{entries}</ol> : <ul class="doc-entries">{entries}</ul>}
    </section>
  )
}

/** The task guides, as one list. */
function Guides(props: { group: Group | undefined }) {
  const guides = props.group?.guides ?? []
  if (guides.length === 0) return null
  return (
    <section class="doc-section">
      <h2>Task guides</h2>
      <p class="doc-section-lede">
        Step-by-step guides for jobs that cross several services.
        {props.group?.index ? (
          <>
            {' '}
            <a href={urlOf(props.group.index.path)}>All guides</a>
          </>
        ) : null}
      </p>
      <ul class="doc-guides">
        {guides.map((document) => (
          <li>
            <a class="doc-guides-link" href={urlOf(document.path)}>
              {document.title}
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** The areas of the documentation: one card per service and the platform. */
function Areas(props: { groups: readonly Group[]; title: string }) {
  return (
    <section class="doc-section">
      <h2>{props.title}</h2>
      <div class="doc-areas">
        {props.groups.map((group) => {
          const links = [...group.guides, ...group.reference].slice(0, 4)
          return (
            <article class="doc-area">
              <h3 class="doc-area-title">
                {group.index ? (
                  <a class="doc-area-title-link" href={urlOf(group.index.path)}>
                    {group.title}
                  </a>
                ) : (
                  group.title
                )}
              </h3>
              {group.index?.summary ? <p class="doc-area-summary">{group.index.summary}</p> : null}
              {links.length > 0 ? (
                <ul class="doc-area-links">
                  {links.map((document) => (
                    <li>
                      <a class="doc-area-link" href={urlOf(document.path)}>
                        {labelOf(document)}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </article>
          )
        })}
      </div>
    </section>
  )
}

/** The pages every newcomer starts with, whatever the role. */
function NewHere() {
  const pages = NEW_HERE.map(find).filter((document): document is Document => !!document)
  const atlas = DOCUMENTATION.assets.find((item) => item.path === ATLAS)
  if (pages.length === 0 && !atlas) return null
  return (
    <div class="doc-path-links doc-new-here">
      <span class="doc-new-here-label">New here?</span>
      {pages.map((document) => (
        <Chip href={urlOf(document.path)}>
          {`${document.directory ? `${titleOf(document.directory)} · ` : ''}${labelOf(document)}`}
        </Chip>
      ))}
      {atlas ? <Chip href={urlOf(atlas.path)}>Atlas</Chip> : null}
    </div>
  )
}

export default createRoute(async (c) => {
  // The choice of a role: kept, or forgotten, then the page it was made on.
  const choice = c.req.query('role')
  if (choice !== undefined) {
    const secure = c.get('services').config.cookieSecure
    const chosen = roleOf(ROLES, choice)
    if (chosen) {
      setCookie(c, ROLE_COOKIE, chosen.id, {
        path: '/docs',
        maxAge: ROLE_MAX_AGE,
        sameSite: 'Lax',
        httpOnly: true,
        secure,
      })
    } else if (choice === 'all') {
      deleteCookie(c, ROLE_COOKIE, { path: '/docs', secure })
    }
    const to = c.req.query('to')
    const next = to && find(to) ? urlOf(to) : '/docs'
    return c.redirect(next, 303)
  }

  const role = readerRoleOf(c)
  const groups = groupsOf(DOCUMENTATION)
  const guides = groups.find((group) => group.name === 'guides')
  const areas = groups.filter((group) => !NOT_AREAS.includes(group.name))
  const shell = (children: Child, title: string) =>
    c.render(
      <DocsShell tree={DOCUMENTATION} current={null} roles={ROLES} role={role}>
        <div class="docs-home">{children}</div>
      </DocsShell>,
      { title, section: 'docs', wide: true }
    )

  if (role) {
    const others = ROLES.filter((item) => item.id !== role.id)
    return shell(
      <>
        <header class="doc-head">
          <p class="doc-eyebrow">Documentation · reading as</p>
          <h1>{role.title}</h1>
          {role.summary ? <p class="doc-lede">{role.summary}</p> : null}
          <div class="doc-path-links">
            <a class="doc-path-primary" href={urlOf(role.page.path)}>
              The {role.title.toLowerCase()} page →
            </a>
            <span class="doc-new-here-label">Switch role:</span>
            {others.map((item) => (
              <Chip href={roleChoiceUrlOf(item.id, null)}>{item.title}</Chip>
            ))}
            <Chip href={roleChoiceUrlOf('all', null)}>Everyone</Chip>
          </div>
        </header>
        <div class="doc-role-sections">
          {role.sections.map((section) => (
            <SectionCard section={section} />
          ))}
        </div>
        <Guides group={guides} />
        <Areas groups={areas} title="All documentation, by area" />
      </>,
      `Documentation · ${role.title}`
    )
  }

  return shell(
    <>
      <header class="doc-head">
        <h1>Documentation</h1>
        <p class="doc-lede">
          Choose the job you do, and the documentation arranges itself around it: where to start,
          your tasks, your reference and what to do when something breaks.
        </p>
        <NewHere />
      </header>
      {ROLES.length > 0 ? (
        <section class="doc-section">
          <h2>Choose your role</h2>
          <div class="doc-roles">
            {ROLES.map((item) => (
              <RoleCard role={item} />
            ))}
          </div>
        </section>
      ) : null}
      <Guides group={guides} />
      <Areas groups={areas} title="Browse by area" />
    </>,
    'Documentation'
  )
})
