/**
 * The creation of a workspace.
 *
 * The page is the way a tenant creates a workspace: the caller names the
 * slug of the workspace and its name, Data registers it, and the caller
 * is given the administration of the workspace it created.
 *
 * The capability that allows the creation is `data.workspace.create`: it
 * is a right of the tenant, and Access says whether the caller holds it.
 * The console hides the page from a caller that holds none, and it
 * refuses the call of a caller that holds none — Data refuses it too.
 */

import { createRoute } from 'honox/factory'
import { ACTIONS, consoleAbility, reasonOf, SUBJECTS } from '../../../domains/ability'
import { AccessError } from '../../../domains/access'
import { type CreatedWorkspace, DataError } from '../../../domains/data'
import { DATA_KEYS, permissionsOfRole, TENANT_ADMIN_ROLE } from '../../../domains/operators'
import { platformWrite } from '../../components/operators'
import { Badge, Notice, PageHead, refusalOf } from '../../components/page'
import { WorkspaceForm } from '../../components/workspace-form'
import { workspacePath } from '../../components/workspace'
import { formOf } from '../../middleware/forms'
import { operatorScope } from '../../middleware/scope'
import { flash, sessionOf } from '../../middleware/session'

export const POST = createRoute(async (c) => {
  const scope = await operatorScope(c)
  const services = c.get('services')
  const session = sessionOf(c)
  const refused = reasonOf(consoleAbility(scope), ACTIONS.create, SUBJECTS.workspace)
  if (refused) return c.text(refused, 403)
  const form = await formOf(c)
  const slug = form.get('slug').trim()
  const displayName = form.get('displayName').trim()
  const tenantId = await services.tenantId(scope.tenant)
  if (!tenantId) {
    flash(c, { kind: 'error', text: 'The identifier of your tenant could not be read.' })
    return c.redirect('/workspaces/new')
  }
  let created: CreatedWorkspace
  try {
    created = await services.workspaces(session.accessToken).createWorkspace({
      tenant: scope.tenant,
      tenantId,
      slug,
      displayName,
    })
  } catch (error) {
    if (!(error instanceof DataError) || error.status >= 500) throw error
    flash(c, { kind: 'error', text: refusalOf(error).message })
    return c.redirect('/workspaces/new')
  }
  // The caller is the administrator of the workspace it created: the
  // role of the administration of the tenant is granted on the workspace,
  // and it reaches the model, the audit and the records of it.
  const credential = services.credentials.tenants[scope.tenant] ?? services.credentials.platform
  if (!credential) {
    flash(c, {
      kind: 'error',
      text: 'The workspace was created, and the console has no credential to give you its rights.',
    })
    return c.redirect(workspacePath(created.id))
  }
  const caller = c.get('callerAddress')
  const admin = services.admin(credential, ...(caller ? [caller] : []))
  try {
    // The role is the tenant's own, and it holds what was written in it.
    // One that holds a capability of the platform is the platform's to
    // grant (Access spec §3.3.1): the grant is signed with the credential
    // of the platform for an operator of the platform, and it is not
    // written for anybody else.
    const roles = await admin.all((page) => admin.roles({ tenant: scope.tenant, ...page }))
    const write = await platformWrite(c, permissionsOfRole(TENANT_ADMIN_ROLE, roles.rows))
    if (write.kind === 'refused') {
      flash(c, {
        kind: 'error',
        text: `The workspace was created, and its rights were not: the role ${TENANT_ADMIN_ROLE} of your tenant holds a capability of the platform, and only an operator of the platform grants it.`,
      })
      return c.redirect(workspacePath(created.id))
    }
    await (write.kind === 'platform' ? write.client : admin).saveGrant({
      tenant: scope.tenant,
      userId: session.principal.id,
      role: TENANT_ADMIN_ROLE,
      workspaceId: created.id,
    })
  } catch (error) {
    if (!(error instanceof AccessError) || error.status >= 500) throw error
    flash(c, {
      kind: 'error',
      text: `The workspace was created, and its rights were not: ${refusalOf(error).message}`,
    })
    return c.redirect(workspacePath(created.id))
  }
  flash(c, { kind: 'ok', text: `The workspace ${created.slug ?? created.id} was created.` })
  return c.redirect(workspacePath(created.id))
})

export default createRoute(async (c) => {
  const refused = reasonOf(
    consoleAbility(await operatorScope(c)),
    ACTIONS.create,
    SUBJECTS.workspace
  )
  if (refused) {
    c.status(403)
    return c.render(
      <section class="refusal">
        <h1>The creation of a workspace is not open to you</h1>
        <p>{refused}</p>
        <p>
          An operator of your tenant can grant you <code>{DATA_KEYS.workspaceCreate}</code> on its
          Rights tab: on the tenant itself, and on every route.
        </p>
        <p>
          <a href="/workspaces">Back to the workspaces</a>
        </p>
      </section>,
      { title: 'Not open to you', section: 'workspaces' }
    )
  }
  return c.render(
    <>
      <PageHead
        eyebrow="Data"
        title="A new workspace"
        lede="A workspace holds the records of a tenant, and it is where its routes serve them. You administer the one you create."
      />
      <Notice tone="ok" title="The name of a workspace">
        The slug is the name of the workspace inside your tenant, and it never changes. It is unique
        in the tenant: two workspaces of a tenant may not share it.
      </Notice>
      <section class="card" style="max-width: 36rem">
        <WorkspaceForm action="/workspaces/new" />
      </section>
      <p class="small muted">
        <Badge tone="accent" plain>
          {DATA_KEYS.workspaceCreate}
        </Badge>{' '}
        is the right that lets you create a workspace of your tenant.
      </p>
    </>,
    { title: 'A new workspace', section: 'workspaces', crumbs: [{ label: 'Workspaces' }] }
  )
})
