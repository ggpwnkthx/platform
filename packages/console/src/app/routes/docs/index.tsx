/**
 * The index of the documentation: a few pages to start with, then every
 * page of every group as a card. Anybody may read it.
 */

import { createRoute } from 'honox/factory'
import { DocsShell } from '../../components/docs-shell'
import { type Document, groupsOf, labelOf, titleOf, urlOf } from '../../../domains/documentation'
import { DOCUMENTATION } from '../../documentation'

/** The pages to start with, by path, and how the index names them. */
const START_HERE: readonly { path: string; label: string }[] = [
  { path: 'platform/README', label: 'Platform overview' },
  { path: 'platform/development', label: 'Local development' },
  { path: 'platform/operations', label: 'Operations' },
  { path: 'gateway/spec', label: 'Gateway specification' },
  { path: 'access/api', label: 'Access service API' },
  { path: 'data/api', label: 'Data service API' },
]

/** A card that links to a page. */
function DocCard(props: { document: Document; label?: string; group?: string }) {
  const { document } = props
  const label = props.label ?? labelOf(document)
  return (
    <a
      class="doc-card"
      href={urlOf(document.path)}
      data-doc-card={`${label} ${document.title} ${document.summary} ${titleOf(document.directory)}`}
    >
      {props.group ? <span class="doc-card-group">{props.group}</span> : null}
      <strong>{label}</strong>
      {document.summary ? <span class="doc-card-summary">{document.summary}</span> : null}
    </a>
  )
}

export default createRoute(async (c) => {
  const groups = groupsOf(DOCUMENTATION).filter((group) => group.name !== '')
  const starts = START_HERE.flatMap((start) => {
    const document = DOCUMENTATION.documents.find((item) => item.path === start.path)
    return document ? [{ document, label: start.label }] : []
  })
  return c.render(
    <DocsShell tree={DOCUMENTATION} current={null}>
      <div class="docs-home">
        <header class="doc-head">
          <h1>Documentation</h1>
          <p class="doc-lede">
            Specifications, guides and runbooks for the gateway, the access service, the data
            service and this console.
          </p>
          <div class="doc-filter" hidden>
            <input
              type="search"
              data-doc-filter
              placeholder="Filter pages…"
              aria-label="Filter pages"
              autocomplete="off"
            />
          </div>
        </header>
        {starts.length > 0 ? (
          <section class="doc-section" data-doc-section>
            <h2>Start here</h2>
            <div class="doc-cards featured">
              {starts.map((start) => (
                <DocCard
                  document={start.document}
                  label={start.label}
                  group={titleOf(start.document.directory)}
                />
              ))}
            </div>
          </section>
        ) : null}
        {groups.map((group) => (
          <section class="doc-section" data-doc-section>
            <div class="doc-section-head">
              <h2>
                {group.index ? <a href={urlOf(group.index.path)}>{group.title}</a> : group.title}
              </h2>
              {group.index?.summary ? <p>{group.index.summary}</p> : null}
            </div>
            <div class="doc-cards">
              {(group.index ? [group.index, ...group.documents] : group.documents).map(
                (document) => (
                  <DocCard document={document} />
                )
              )}
            </div>
          </section>
        ))}
        <p class="muted" data-doc-empty hidden>
          No page matches the filter.
        </p>
      </div>
    </DocsShell>,
    { title: 'Documentation', section: 'docs', wide: true }
  )
})
