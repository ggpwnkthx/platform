/**
 * A workspace: who the caller is in it, and the collections it may use.
 */

import { createRoute } from 'honox/factory'
import { isUuid } from '../../../../domains/operators'
import { Badge, Empty, KeyValues, PageHead } from '../../../components/page'
import {
  collectionPath,
  WorkspaceTabs,
  workspaceCrumbs,
  workspaceName,
} from '../../../components/workspace'
import CopyText from '../../../islands/copy-text'
import { sessionOf } from '../../../middleware/session'
import { rememberWorkspace } from '../../../middleware/workspaces'

const ACTION_TONES: Record<string, 'ok' | 'accent' | 'warn' | 'error'> = {
  read: 'ok',
  create: 'accent',
  update: 'warn',
  delete: 'error',
}

export default createRoute(async (c) => {
  const id = c.req.param('workspace') ?? ''
  if (!isUuid(id)) return c.notFound()
  const session = sessionOf(c)
  const client = c.get('services').data(id, session.accessToken)
  const [me, schema] = await Promise.all([client.me(), client.schema()])
  rememberWorkspace(c, id)

  return c.render(
    <>
      <PageHead
        title={workspaceName(me, id)}
        eyebrow="Workspace"
        lede={`${schema.collections.length} collections are open to you in this workspace.`}
      />
      <WorkspaceTabs id={id} current="collections" />
      <div class="split">
        <section class="stack">
          {schema.collections.length === 0 ? (
            <Empty>
              The policies of the deployment open no collection of this workspace to you.
            </Empty>
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
                  <div class="chips">
                    {collection.actions.map((action) => (
                      <Badge tone={ACTION_TONES[action] ?? 'accent'} plain>
                        {action}
                      </Badge>
                    ))}
                  </div>
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
