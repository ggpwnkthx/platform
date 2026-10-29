/**
 * The home of the documentation: a short reading path, then one card per
 * area with its overview and main guides. The full list of pages lives
 * in the sidebar of each area, and the pages for maintainers stay out of
 * the way. Anybody may read it.
 */

import { createRoute } from 'honox/factory'
import { DocsShell } from '../../components/docs-shell'
import { type Document, groupsOf, labelOf, titleOf, urlOf } from '../../../domains/documentation'
import { DOCUMENTATION } from '../../documentation'

/** A step of the reading path. */
interface Step {
  readonly title: string
  readonly text: string
  /** The page the step leads to: the first of these that exists. */
  readonly primary: readonly string[]
  /** More pages for the step, shown when they exist. */
  readonly more?: readonly string[]
  /** A file of the documentation that is not a document, with its label. */
  readonly asset?: { readonly path: string; readonly label: string }
}

/** The reading path, from understanding the platform to its contracts. */
const PATH: readonly Step[] = [
  {
    title: 'Understand',
    text: 'What the platform is and how a request moves through it.',
    primary: ['platform/README', 'README'],
    asset: { path: 'platform/atlas.html', label: 'Atlas' },
  },
  {
    title: 'Run it locally',
    text: 'Start the whole platform on your machine.',
    primary: ['platform/quickstart', 'platform/development', 'data/getting-started'],
  },
  {
    title: 'Deploy',
    text: 'Run the services in production.',
    primary: ['platform/operations'],
  },
  {
    title: 'Integrate',
    text: 'Build an upstream or a client against the services.',
    primary: ['gateway/upstream-identity', 'data/client'],
    more: ['access/api', 'data/client', 'data/api'],
  },
  {
    title: 'Look things up',
    text: 'The normative contracts of each service.',
    primary: ['gateway/spec'],
    more: ['access/spec', 'data/spec', 'console/spec'],
  },
]

/** The document of a path, if the documentation holds it. */
function find(path: string): Document | undefined {
  return DOCUMENTATION.documents.find((document) => document.path === path)
}

/** A link to a page, named by its area and label. */
function Chip(props: { document: Document }) {
  return (
    <a class="doc-chip" href={urlOf(props.document.path)}>
      {props.document.directory ? `${titleOf(props.document.directory)} · ` : ''}
      {labelOf(props.document)}
    </a>
  )
}

export default createRoute(async (c) => {
  const steps = PATH.flatMap((step) => {
    const primary = step.primary.map(find).find((document) => document !== undefined)
    if (!primary) return []
    const more = (step.more ?? [])
      .map(find)
      .filter((document): document is Document => document !== undefined && document !== primary)
      .slice(0, 3)
    const asset = step.asset
      ? DOCUMENTATION.assets.find((item) => item.path === step.asset?.path)
      : undefined
    return [{ step, primary, more, asset }]
  })
  const areas = groupsOf(DOCUMENTATION).filter((group) => group.name !== '')
  return c.render(
    <DocsShell tree={DOCUMENTATION} current={null}>
      <div class="docs-home">
        <header class="doc-head">
          <h1>Documentation</h1>
          <p class="doc-lede">
            Guides and contracts for the gateway, Access, Data and this console. New here? Follow
            the reading path.
          </p>
        </header>
        {steps.length > 0 ? (
          <section class="doc-section">
            <h2>Reading path</h2>
            <ol class="doc-path">
              {steps.map(({ step, primary, more, asset }, index) => (
                <li>
                  <span class="doc-path-number" aria-hidden="true">
                    {index + 1}
                  </span>
                  <div class="doc-path-body">
                    <p class="doc-path-title">{step.title}</p>
                    <p class="doc-path-text">{step.text}</p>
                    <div class="doc-path-links">
                      <a class="doc-path-primary" href={urlOf(primary.path)}>
                        {primary.directory ? `${titleOf(primary.directory)} · ` : ''}
                        {labelOf(primary)} →
                      </a>
                      {more.map((document) => (
                        <Chip document={document} />
                      ))}
                      {asset && step.asset ? (
                        <a class="doc-chip" href={urlOf(asset.path)}>
                          {step.asset.label}
                        </a>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ) : null}
        <section class="doc-section">
          <h2>Areas</h2>
          <div class="doc-areas">
            {areas.map((group) => {
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
                  {group.index?.summary ? (
                    <p class="doc-area-summary">{group.index.summary}</p>
                  ) : null}
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
      </div>
    </DocsShell>,
    { title: 'Documentation', section: 'docs', wide: true }
  )
})
