/**
 * A tenant: what Access holds about it, its latest changes,
 * and its form.
 */

import { createRoute } from 'honox/factory'
import { consoleAbility, CONSOLE_ACTIONS, CONSOLE_SUBJECT } from '../../../../../domains/ability'
import { AccessError, type Tenant } from '../../../../../domains/access'
import {
  adminFor,
  TenantHead,
  TenantTabs,
  tenantCrumbs,
  tenantPath,
} from '../../../../components/operators'
import { Badge, KeyValues, Moment, Refusal, refusalOf } from '../../../../components/page'
import { TenantForm, tenantInputOf } from '../../../../components/tenant-form'
import { formOf } from '../../../../middleware/forms'
import { operatorScope } from '../../../../middleware/scope'
import { flash } from '../../../../middleware/session'

async function tenantOf(
  admin: { tenants: () => Promise<readonly Tenant[]> },
  slug: string
): Promise<Tenant | null> {
  return (await admin.tenants()).find((tenant) => tenant.slug === slug) ?? null
}

export const POST = createRoute(async (c) => {
  const slug = c.req.param('tenant') ?? ''
  const access = await adminFor(c, slug)
  if ('refusal' in access) return access.refusal
  const current = await tenantOf(access.admin, slug)
  if (!current) return c.notFound()
  const scope = await operatorScope(c)
  const ability = consoleAbility(scope)
  const form = await formOf(c)
  try {
    await access.admin.saveTenant(
      tenantInputOf(form, ability.can(CONSOLE_ACTIONS.platform, CONSOLE_SUBJECT), current)
    )
    flash(c, { kind: 'ok', text: `The tenant ${slug} was saved.` })
  } catch (error) {
    if (!(error instanceof AccessError) || error.status >= 500) throw error
    flash(c, {
      kind: 'error',
      text: error.message,
      detail: `${error.status} ${error.code}${error.requestId ? ` · request ${error.requestId}` : ''}`,
    })
  }
  return c.redirect(tenantPath(slug))
})

export default createRoute(async (c) => {
  const slug = c.req.param('tenant') ?? ''
  const access = await adminFor(c, slug)
  if ('refusal' in access) return access.refusal
  const scope = await operatorScope(c)
  const ability = consoleAbility(scope)
  const tenant = await tenantOf(access.admin, slug)
  if (!tenant) return c.notFound()
  let audit = null
  let refusal = null
  const [groups, roles] = await Promise.all([
    access.admin.groups({ tenant: slug, limit: 1 }).catch(() => null),
    access.admin.roles({ tenant: slug, limit: 1 }).catch(() => null),
  ])
  try {
    audit = await access.admin.audit({ tenant: slug, limit: 8 })
  } catch (error) {
    if (!(error instanceof AccessError) || error.status >= 500) throw error
    refusal = refusalOf(error)
  }
  const base = tenantPath(slug)
  return c.render(
    <>
      <TenantHead slug={slug} title={tenant.displayName} />
      <TenantTabs slug={slug} current="overview" />
      <div class="grid">
        <a class="card card-link" href={`${base}/users`}>
          <span class="muted small">Users</span>
          <span class="metric">{tenant.userCount ?? '—'}</span>
        </a>
        <a class="card card-link" href={`${base}/groups`}>
          <span class="muted small">Groups</span>
          <span class="metric">{groups?.total ?? '—'}</span>
        </a>
        <a class="card card-link" href={`${base}/roles`}>
          <span class="muted small">Roles</span>
          <span class="metric">{roles?.total ?? '—'}</span>
        </a>
        <a class="card card-link" href={`${base}/rights`}>
          <span class="muted small">Rights</span>
          <span class="metric">{tenant.grantCount ?? '—'}</span>
        </a>
      </div>
      <div class="split">
        <section class="card">
          <h2>Recent changes</h2>
          {refusal ? <Refusal refusal={refusal} /> : null}
          {audit && audit.rows.length === 0 ? <p class="muted">Nothing changed yet.</p> : null}
          {audit && audit.rows.length > 0 ? (
            <div class="table-wrap">
              <table>
                <tbody>
                  {audit.rows.map((record) => (
                    <tr>
                      <td class="small">
                        <Moment at={record.at} />
                      </td>
                      <td>
                        <code>{record.action}</code>
                      </td>
                      <td class="small muted mono">{record.operator}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <a href={`${base}/audit`}>Full audit →</a>
        </section>
        <aside class="card">
          <h2>Tenant</h2>
          <KeyValues
            rows={[
              ['Slug', <code>{tenant.slug}</code>],
              ['Identifier', <code class="small">{tenant.id}</code>],
              ['Issuer', <span class="small">{tenant.issuer}</span>],
              ['E-mail domain', tenant.emailDomain ?? '—'],
              ['Client', <code>{tenant.clientId}</code>],
              [
                'Flags',
                <div class="chips">
                  {tenant.enabled ? (
                    <Badge tone="ok">enabled</Badge>
                  ) : (
                    <Badge tone="error">disabled</Badge>
                  )}
                  {tenant.autoProvision ? <Badge plain>registers unknown people</Badge> : null}
                  {tenant.default ? (
                    <Badge tone="accent" plain>
                      default
                    </Badge>
                  ) : null}
                  {tenant.sharedClient ? (
                    <Badge tone="warn" plain>
                      shared client
                    </Badge>
                  ) : null}
                </div>,
              ],
              ['Created', <Moment at={tenant.createdAt} />],
            ]}
          />
        </aside>
      </div>
      <details class="card disclosure">
        <summary>Edit tenant</summary>
        <TenantForm
          tenant={tenant}
          platform={ability.can(CONSOLE_ACTIONS.platform, CONSOLE_SUBJECT)}
          action={base}
        />
      </details>
    </>,
    { title: tenant.displayName, section: 'operators', crumbs: tenantCrumbs(slug) }
  )
})
