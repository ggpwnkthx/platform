/**
 * The workspaces of the caller.
 */

import { createRoute } from 'honox/factory'
import { DataError, type Me } from '../../../domains/data'
import { isUuid } from '../../../domains/operators'
import { Badge, Empty, Notice, PageHead } from '../../components/page'
import { workspaceName, workspacePath } from '../../components/workspace'
import CopyText from '../../islands/copy-text'
import { formOf } from '../../middleware/forms'
import { flash, sessionOf } from '../../middleware/session'
import { knownWorkspaces } from '../../middleware/workspaces'

/** What the data service answers for a workspace the caller may hold. */
interface Probe {
  readonly id: string
  readonly me: Me | null
  readonly refusal: string | null
}

export const POST = createRoute(async (c) => {
  const form = await formOf(c)
  const id = form.get('workspace').trim().toLowerCase()
  if (!isUuid(id)) {
    flash(c, { kind: 'error', text: 'The identifier of a workspace is a uuid.' })
    return c.redirect('/workspaces')
  }
  return c.redirect(workspacePath(id))
})

export default createRoute(async (c) => {
  const services = c.get('services')
  const session = sessionOf(c)
  const known = await knownWorkspaces(c)
  // The data service answers whether the caller may read a workspace:
  // the console asks it for every workspace it knows, at most two dozen.
  const probes: Probe[] = await Promise.all(
    known.ids.slice(0, 24).map(async (id) => {
      try {
        return { id, me: await services.data(id, session.accessToken).me(), refusal: null }
      } catch (error) {
        return {
          id,
          me: null,
          refusal: error instanceof DataError ? `${error.status} ${error.code}` : 'not reachable',
        }
      }
    })
  )

  return c.render(
    <>
      <PageHead
        title="Workspaces"
        lede="The workspaces your rights name, and the ones you opened. The data service decides what you see in each of them."
      />
      {!known.rightsRead ? (
        <Notice tone="warn" title="Your rights could not be read">
          The console holds no credential of the administration for your tenant, or the access
          service did not answer: it lists the workspaces you opened, and you open another one by
          its identifier.
        </Notice>
      ) : null}
      {known.everyWorkspace ? (
        <Notice tone="warn" title="A right of yours holds for every workspace of your tenant">
          The console cannot list what a right does not name: open such a workspace by its
          identifier.
        </Notice>
      ) : null}
      {probes.length === 0 ? (
        <Empty>No workspace is known to the console for you yet.</Empty>
      ) : (
        <div class="grid grid-wide">
          {probes.map((probe) =>
            probe.me ? (
              <a class="card card-link" href={workspacePath(probe.id)}>
                <header>
                  <h2>{workspaceName(probe.me, probe.id)}</h2>
                  <Badge tone="ok">open</Badge>
                </header>
                <span class="small muted mono">{probe.id}</span>
                <span class="small muted">
                  route <code>{probe.me.routeId}</code> · API {probe.me.apiVersion}
                </span>
              </a>
            ) : (
              <article class="card">
                <header>
                  <h2 class="mono small">{probe.id}</h2>
                  <Badge tone="error">{probe.refusal ?? 'refused'}</Badge>
                </header>
                <p class="small muted">The data service does not open this workspace to you.</p>
                <CopyText text={probe.id} />
              </article>
            )
          )}
        </div>
      )}
      <section class="card" style="max-width: 36rem">
        <h2>Open a workspace</h2>
        <form method="post" class="toolbar">
          <label class="field">
            <span>The identifier of the workspace</span>
            <input
              name="workspace"
              class="mono"
              required
              pattern="[0-9a-fA-F-]{36}"
              placeholder="11111111-1111-4111-8111-111111111111"
              spellcheck={false}
            />
          </label>
          <button type="submit" class="button">
            Open
          </button>
        </form>
      </section>
    </>,
    { title: 'Workspaces', section: 'workspaces', crumbs: [{ label: 'Workspaces' }] }
  )
})
