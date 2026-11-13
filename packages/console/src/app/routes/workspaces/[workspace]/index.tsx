/**
 * A workspace: who the caller is in it, and the collections it may use.
 *
 * Every collection says what the caller may do with its records, the
 * refused actions too, and the tabs of the model and of the audit are
 * drawn closed when Access gives the caller no key that opens them.
 */

import { createRoute } from 'honox/factory'
import { workspaceAbility } from '../../../../domains/ability'
import { isUuid } from '../../../../domains/operators'
import { Empty, KeyValues, PageHead } from '../../../components/page'
import {
  accessPath,
  CollectionActions,
  collectionPath,
  WorkspaceTabs,
  workspaceCrumbs,
  workspaceName,
} from '../../../components/workspace'
import CopyText from '../../../islands/copy-text'
import { sessionOf } from '../../../middleware/session'
import { rememberWorkspace, workspaceKeys } from '../../../middleware/workspaces'

export default createRoute(async (c) => {
  const id = c.req.param('workspace') ?? ''
  if (!isUuid(id)) return c.notFound()
  const session = sessionOf(c)
  const client = c.get('services').data(id, session.accessToken)
  const [me, schema] = await Promise.all([client.me(), client.schema()])
  rememberWorkspace(c, id, me)
  const ability = workspaceAbility(await workspaceKeys(c, id, me.routeId))

  return c.render(
    <>
      <PageHead
        title={workspaceName(me, id)}
        eyebrow="Workspace"
        lede={`${schema.collections.length} ${schema.collections.length === 1 ? 'collection is' : 'collections are'} open to you.`}
      />
      <WorkspaceTabs id={id} current="collections" ability={ability} />
      <div class="split">
        <section class="stack">
          {schema.collections.length === 0 ? (
            <Empty>No collection in this workspace is open to you.</Empty>
          ) : (
            <div class="grid">
              {schema.collections.map((collection) => (
                <a class="card card-link" href={collectionPath(id, collection.key)}>
                  <header>
                    <h2>{collection.label}</h2>
                    <code class="small muted">{collection.key}</code>
                  </header>
                  {collection.description ? (
                    <p class="small muted">{collection.description}</p>
                  ) : null}
                  <CollectionActions collection={collection} />
                  <span class="small muted">
                    {collection.readableFields.length} readable · {collection.writableFields.length}{' '}
                    writable fields
                  </span>
                </a>
              ))}
            </div>
          )}
        </section>
        <aside class="card">
          <h2>You in this workspace</h2>
          <KeyValues
            rows={[
              ['Workspace', <CopyText text={id} short />],
              ['Slug', me.workspace?.slug ?? '—'],
              ['Principal', <CopyText text={me.principalId} short />],
              ['Tenant', <CopyText text={me.tenantId} short />],
              ['Route', <code>{me.routeId}</code>],
              ['API', me.apiVersion],
              ['Schema', <code>{schema.schemaVersion}</code>],
              ['Policies', <code>{schema.policyBundleVersion}</code>],
            ]}
          />
          <a class="small" href={accessPath(id)}>
            What you may do here, field by field →
          </a>
        </aside>
      </div>
    </>,
    {
      title: workspaceName(me, id),
      section: 'workspaces',
      crumbs: workspaceCrumbs(id, me),
    }
  )
})
