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
import {
  CredentialForm,
  ProviderForm,
  ProviderRow,
  RemoveCredential,
} from '../../../../components/provider-form'
import { RouteForm, RouteRow } from '../../../../components/route-form'
import { formOf, listOf } from '../../../../middleware/forms'
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
  const base = tenantPath(slug)
  try {
    if (form.get('_action') === 'save-provider') {
      const kind = form.get('kind') === 'local' ? 'local' : 'oidc'
      const { provider, created } = await access.admin.saveProvider({
        tenant: slug,
        kind,
        slug: form.get('slug').trim(),
        ...(form.get('displayName').trim() ? { displayName: form.get('displayName').trim() } : {}),
        ...(kind === 'local'
          ? {}
          : {
              issuer: form.get('issuer').trim(),
              idpClientId: form.get('idpClientId').trim(),
              idpClientSecret: form.get('idpClientSecret'),
              idpRedirectUri: form.get('idpRedirectUri').trim(),
              ...(form.get('idpScopes').trim() ? { idpScopes: listOf(form.get('idpScopes')) } : {}),
            }),
      })
      flash(c, {
        kind: 'ok',
        text: created
          ? `The provider ${provider.slug} was registered.`
          : `The provider ${provider.slug} was updated.`,
      })
      return c.redirect(base)
    }
    if (form.get('_action') === 'save-route') {
      const provider = form.get('provider').trim()
      const { route, created } = await access.admin.saveRoute({
        tenant: slug,
        kind: form.get('kind') === 'address' ? 'address' : 'domain',
        key: form.get('key').trim(),
        ...(provider ? { provider } : {}),
      })
      flash(c, {
        kind: 'ok',
        text: created
          ? `The route ${route.key} was registered. It routes nothing until it is proved.`
          : `The route ${route.key} was changed. It waits for its proof again.`,
      })
      return c.redirect(base)
    }
    if (form.get('_action') === 'verify-route') {
      const method = form.get('verification') === 'operator' ? 'operator' : 'dns'
      const route = await access.admin.verifyRoute(form.get('id').trim(), {
        status: 'verified',
        verification: method,
      })
      flash(c, { kind: 'ok', text: `The route ${route.key} was proved.` })
      return c.redirect(base)
    }
    if (form.get('_action') === 'save-credential') {
      const { credential, created } = await access.admin.saveCredential({
        tenant: slug,
        provider: form.get('provider').trim(),
        email: form.get('email').trim(),
        password: form.get('password'),
      })
      flash(c, {
        kind: 'ok',
        text: created
          ? `The account ${credential.email} was written.`
          : `The password of ${credential.email} was changed.`,
      })
      return c.redirect(base)
    }
    if (form.get('_action') === 'remove-credential') {
      await access.admin.removeCredential(form.get('id').trim())
      flash(c, { kind: 'ok', text: 'The account was removed.' })
      return c.redirect(base)
    }
    if (form.get('_action') === 'remove-provider') {
      await access.admin.removeProvider(form.get('id').trim())
      flash(c, { kind: 'ok', text: 'The provider was removed.' })
      return c.redirect(base)
    }
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
  const [groups, roles, providers, credentials] = await Promise.all([
    access.admin.groups({ tenant: slug, limit: 1 }).catch(() => null),
    access.admin.roles({ tenant: slug, limit: 1 }).catch(() => null),
    access.admin.providers({ tenant: slug }).catch(() => null),
    access.admin.credentials({ tenant: slug }).catch(() => null),
  ])
  const localProviders = (providers?.rows ?? []).filter((provider) => provider.kind === 'local')
  const [routes, catalog] = await Promise.all([
    access.admin.routes({ tenant: slug }).catch(() => null),
    access.admin.catalog().catch(() => []),
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
                  {tenant.autoProvisionAdmin ? (
                    <Badge plain>the first one administers it</Badge>
                  ) : null}
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
      <section class="card">
        <h2>Providers</h2>
        <p class="muted small">
          The tenant signs its people in at the default provider, and at every other provider below.
          A login that names none asks the caller which one it signs in at.
        </p>
        <div class="table-wrap">
          <table>
            <tbody>
              {(providers?.rows ?? []).map((provider) => (
                <ProviderRow key={provider.id} provider={provider} action={base} />
              ))}
            </tbody>
          </table>
        </div>
        {(providers?.rows ?? []).length === 0 ? (
          <p class="muted">The tenant has no provider.</p>
        ) : null}
        <details class="disclosure">
          <summary>Register a provider</summary>
          <ProviderForm action={base} catalog={catalog} />
        </details>
        {localProviders.map((provider) => (
          <div key={provider.id}>
            <h3>The accounts of {provider.displayName}</h3>
            <div class="table-wrap">
              <table>
                <tbody>
                  {(credentials?.rows ?? [])
                    .filter((credential) => credential.provider === provider.slug)
                    .map((credential) => (
                      <tr key={credential.id}>
                        <td>{credential.email}</td>
                        <td class="small muted">
                          {credential.failedAttempts > 0
                            ? `${credential.failedAttempts} failed sign-ins`
                            : 'no failed sign-in'}
                        </td>
                        <td class="small">
                          {credential.status === 'active' ? (
                            <Badge tone="ok">active</Badge>
                          ) : (
                            <Badge tone="error">disabled</Badge>
                          )}
                        </td>
                        <td>
                          <RemoveCredential id={credential.id} action={base} />
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <details class="disclosure">
              <summary>Write an account</summary>
              <CredentialForm action={base} provider={provider.slug} />
            </details>
          </div>
        ))}
      </section>
      <section class="card">
        <h2>Routes</h2>
        <p class="muted small">
          A route names the tenant of a login and the provider the callers of a domain sign in at. A
          route routes nothing until it is proved: the owner of the domain publishes the record
          below, or the operator of the platform vouches for it.
        </p>
        <div class="table-wrap">
          <table>
            <tbody>
              {(routes?.rows ?? []).map((route) => (
                <RouteRow
                  key={route.id}
                  route={route}
                  action={base}
                  platform={ability.can(CONSOLE_ACTIONS.platform, CONSOLE_SUBJECT)}
                />
              ))}
            </tbody>
          </table>
        </div>
        {(routes?.rows ?? []).length === 0 ? <p class="muted">The tenant has no route.</p> : null}
        <details class="disclosure">
          <summary>Register a route</summary>
          <RouteForm action={base} providers={providers?.rows ?? []} />
        </details>
      </section>
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
