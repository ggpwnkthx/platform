/**
 * The administration: the tenants the operator administers.
 */

import { createRoute } from 'honox/factory'
import {
  administersOwnTenant,
  consoleAbility,
  CONSOLE_ACTIONS,
  CONSOLE_SUBJECT,
} from '../../../domains/ability'
import { AccessError, type Tenant } from '../../../domains/access'
import { listingCredential } from '../../../domains/operators'
import { tenantPath } from '../../components/operators'
import { Badge, Empty, Moment, PageHead, Refusal, refusalOf } from '../../components/page'
import { TenantForm, tenantInputOf } from '../../components/tenant-form'
import { formOf } from '../../middleware/forms'
import { operatorScope } from '../../middleware/scope'
import { flash } from '../../middleware/session'

export const POST = createRoute(async (c) => {
  const scope = await operatorScope(c)
  const ability = consoleAbility(scope)
  const services = c.get('services')
  if (!ability.can(CONSOLE_ACTIONS.platform, CONSOLE_SUBJECT) || !services.credentials.platform) {
    return c.text('only the operator of the platform creates a tenant', 403)
  }
  const form = await formOf(c)
  try {
    const { tenant, created } = await services
      .admin(services.credentials.platform)
      .saveTenant(tenantInputOf(form, true))
    flash(c, {
      kind: 'ok',
      text: created
        ? `The tenant ${tenant.slug} was created.`
        : `The tenant ${tenant.slug} was updated.`,
    })
    return c.redirect(tenantPath(tenant.slug))
  } catch (error) {
    if (!(error instanceof AccessError) || error.status >= 500) throw error
    c.status(422)
    return c.render(
      <>
        <PageHead title="A new tenant" />
        <Refusal refusal={refusalOf(error)} />
        <section class="card">
          <TenantForm platform values={form.fields} action="/operators" />
        </section>
      </>,
      {
        title: 'A new tenant',
        section: 'operators',
        crumbs: [{ label: 'Operators', href: '/operators' }],
      }
    )
  }
})

export default createRoute(async (c) => {
  const scope = await operatorScope(c)
  const ability = consoleAbility(scope)
  const services = c.get('services')
  // An operator of one tenant has one place to go.
  if (administersOwnTenant(ability)) return c.redirect(tenantPath(scope.tenant))
  const credential = listingCredential(scope, services.credentials)
  let tenants: readonly Tenant[] = []
  let refusal = null
  if (credential) {
    try {
      tenants = await services.admin(credential).tenants()
    } catch (error) {
      if (!(error instanceof AccessError) || error.status >= 500) throw error
      refusal = refusalOf(error)
    }
  }
  return c.render(
    <>
      <PageHead
        title="Tenants"
        lede="Every tenant of the platform: its provider, its client, its users and its rights. You administer the platform."
      />
      {refusal ? <Refusal refusal={refusal} /> : null}
      {tenants.length === 0 && !refusal ? <Empty>The platform has no tenant yet.</Empty> : null}
      {tenants.length > 0 ? (
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tenant</th>
                <th>Provider</th>
                <th>Client</th>
                <th class="num">Users</th>
                <th class="num">Rights</th>
                <th>State</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((tenant) => (
                <tr>
                  <td>
                    <a href={tenantPath(tenant.slug)}>
                      <strong>{tenant.displayName}</strong>
                    </a>
                    <div class="small muted mono">{tenant.slug}</div>
                  </td>
                  <td class="small">
                    <span class="cell">{tenant.issuer}</span>
                    {tenant.emailDomain ? <div class="muted">@{tenant.emailDomain}</div> : null}
                  </td>
                  <td>
                    <code>{tenant.clientId}</code>
                  </td>
                  <td class="num">{tenant.userCount ?? '—'}</td>
                  <td class="num">{tenant.grantCount ?? '—'}</td>
                  <td>
                    <div class="chips">
                      {tenant.enabled ? (
                        <Badge tone="ok">enabled</Badge>
                      ) : (
                        <Badge tone="error">disabled</Badge>
                      )}
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
                    </div>
                  </td>
                  <td class="small">
                    <Moment at={tenant.createdAt} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {ability.can(CONSOLE_ACTIONS.platform, CONSOLE_SUBJECT) && services.credentials.platform ? (
        <details class="card disclosure">
          <summary>Create a tenant</summary>
          <TenantForm platform action="/operators" />
        </details>
      ) : null}
    </>,
    { title: 'Tenants', section: 'operators', crumbs: [{ label: 'Operators' }] }
  )
})
