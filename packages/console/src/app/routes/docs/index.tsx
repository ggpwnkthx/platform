/**
 * The documentation of the platform: the documents of the platform, the
 * contracts of the three services and the console itself.
 *
 * Anybody reads it: the documentation is the documentation of the
 * platform, and it is not the administration of anything.
 */

import { createRoute } from 'honox/factory'
import { PageHead } from '../../components/page'
import { groupsOf, urlOf } from '../../../domains/documentation'
import { DOCUMENTATION } from '../../documentation'

export default createRoute(async (c) =>
  c.render(
    <div class="doc-page">
      <PageHead
        title="The documentation of the platform"
        lede="The documents of the platform, the contract of each of the three services and the contract of the console. They are the documents of the repository, and the console shows them as they are written."
      />
      {groupsOf(DOCUMENTATION).map((group) => (
        <section class="stack">
          <h2>{group.title}</h2>
          <ul class="doc-index">
            {group.documents.map((document) => (
              <li>
                <a href={urlOf(document.path)}>{document.title}</a>
                {document.summary ? <p>{document.summary}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>,
    { title: 'Documentation', section: 'docs' }
  )
)
