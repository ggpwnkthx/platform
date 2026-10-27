/**
 * The audit of a workspace: the mutations that were committed, who made
 * them and which fields they changed. It never holds a value.
 */

import { createRoute } from 'honox/factory'
import { DataError } from '../../../../domains/data'
import { isUuid } from '../../../../domains/operators'
import { Badge, Empty, Moment, PageHead, Refusal, refusalOf } from '../../../components/page'
import {
  recordPath,
  WorkspaceTabs,
  workspaceCrumbs,
  workspaceName,
  workspacePath,
} from '../../../components/workspace'
import CopyText from '../../../islands/copy-text'
import { sessionOf } from '../../../middleware/session'

const TONES: Record<string, 'accent' | 'warn' | 'error'> = {
  create: 'accent',
  update: 'warn',
  delete: 'error',
  rollback: 'warn',
}

export default createRoute(async (c) => {
  const workspace = c.req.param('workspace') ?? ''
  if (!isUuid(workspace)) return c.notFound()
  const client = c.get('services').data(workspace, sessionOf(c).accessToken)
  const me = await client.me()
  const cursor = c.req.query('cursor') ?? ''
  const path = `${workspacePath(workspace)}/audit`
  let page = null
  let refusal = null
  try {
    page = await client.audit({ limit: 50, ...(cursor ? { cursor } : {}) })
  } catch (error) {
    if (!(error instanceof DataError) || error.status >= 500 || error.status === 401) throw error
    refusal = refusalOf(error)
  }
  return c.render(
    <>
      <PageHead
        title={workspaceName(me, workspace)}
        eyebrow="Workspace"
        lede="The mutations committed in the workspace, the latest first. The audit names the fields that changed, never their values."
      />
      <WorkspaceTabs id={workspace} current="audit" />
      {refusal ? (
        <Refusal refusal={refusal}>
          {refusal.status === 403 ? (
            <span class="small">The audit requires the permission data.audit.read.</span>
          ) : null}
        </Refusal>
      ) : null}
      {page && page.data.length === 0 ? <Empty>Nothing was committed yet.</Empty> : null}
      {page && page.data.length > 0 ? (
        <>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Action</th>
                  <th>Record</th>
                  <th>Fields</th>
                  <th>Principal</th>
                  <th>Request</th>
                </tr>
              </thead>
              <tbody>
                {page.data.map((entry) => (
                  <tr>
                    <td>
                      <Moment at={entry.occurredAt} />
                    </td>
                    <td>
                      <Badge tone={TONES[entry.action ?? ''] ?? 'accent'} plain>
                        {entry.action ?? '—'}
                      </Badge>
                      {entry.source && entry.source !== 'gateway' ? (
                        <div class="small muted">{entry.source}</div>
                      ) : null}
                    </td>
                    <td>
                      {entry.collection && entry.recordId ? (
                        <>
                          <a
                            class="mono"
                            href={recordPath(workspace, entry.collection, entry.recordId)}
                          >
                            {entry.recordId.slice(0, 8)}
                          </a>
                          <div class="small muted">
                            {entry.collection}
                            {entry.resultVersion ? ` · v${entry.resultVersion}` : ''}
                          </div>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td class="small">{(entry.changedFields ?? []).join(', ') || '—'}</td>
                    <td>
                      <CopyText text={entry.principalId} short />
                    </td>
                    <td class="small mono">{entry.requestId?.slice(0, 13) ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div class="pager">
            <span class="muted">{page.data.length} entries</span>
            <span class="row">
              {cursor ? (
                <a class="button quiet small" href={path}>
                  Latest
                </a>
              ) : null}
              {page.meta.nextCursor ? (
                <a
                  class="button quiet small"
                  href={`${path}?cursor=${encodeURIComponent(page.meta.nextCursor)}`}
                >
                  Older
                </a>
              ) : null}
            </span>
          </div>
        </>
      ) : null}
    </>,
    {
      title: `Audit of ${workspaceName(me, workspace)}`,
      section: 'workspaces',
      crumbs: workspaceCrumbs(workspace, me, { label: 'Audit' }),
    }
  )
})
