/**
 * A tenant: who administers it, what Access holds about it, its latest
 * changes, and its form.
 *
 * The page is where an operator of a tenant lands. It answers the first
 * question of an administration — who administers this tenant — and
 * leads to the pages that manage the rest: granting a right, reading
 * what a user holds, changing what a role holds.
 *
 * What is the platform's is drawn as the platform's: the flags of a
 * tenant that only its operator changes, and the route it alone vouches
 * for, are shown disabled to an operator of the tenant, with the reason.
 */

import { createRoute } from 'honox/factory'
import {
  ACTIONS,
  allowanceOf,
  consoleAbility,
  reasonOf,
  SUBJECTS,
  tenantOf as tenantNamed,
} from '../../../../../domains/ability'
import { AccessError, type Grant, type Tenant } from '../../../../../domains/access'
import {
  type Administration,
  administrationOf,
  CONSOLE_KEYS,
} from '../../../../../domains/operators'
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
import { type Holder, holderOf, RightPlace, rightsViewOf } from '../../../../components/rights'
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
  const services = c.get('services')
  const caller = c.get('callerAddress')
  // What is the platform's is written with the credential of the
  // platform: Access refuses the credential of a tenant, whoever holds it.
  const platform = () =>
    services.credentials.platform
      ? services.admin(services.credentials.platform, ...(caller ? [caller] : []))
      : access.admin
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
      // Vouching for a domain is the platform's: an operator of a tenant
      // is told why before Access refuses it.
      const refused =
        method === 'operator' ? reasonOf(ability, ACTIONS.vouch, SUBJECTS.route) : null
      if (refused) {
        flash(c, { kind: 'error', text: 'The route was not vouched for.', detail: refused })
        return c.redirect(base)
      }
      const client = method === 'operator' ? platform() : access.admin
      const route = await client.verifyRoute(form.get('id').trim(), {
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
    const mayFlag = ability.can(ACTIONS.flag, tenantNamed(slug))
    const input = tenantInputOf(form, mayFlag, current)
    // The flags of the platform are changed with its credential; every
    // other change of a tenant is signed by the credential of the tenant.
    const flagged = input.sharedClient !== current.sharedClient || input.default !== current.default
    await (flagged && mayFlag ? platform() : access.admin).saveTenant(input)
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

/** A holder that administers the tenant, and the rights that make it so. */
interface Administrator {
  readonly holder: Holder
  readonly sources: readonly { readonly grant: Grant; readonly how: Administration }[]
}

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
  const { admin } = access
  const [groups, roles, grants, users, providers, credentials, routes, catalog] = await Promise.all(
    [
      admin.all((offsets) => admin.groups({ tenant: slug, ...offsets })).catch(() => null),
      admin.all((offsets) => admin.roles({ tenant: slug, ...offsets })).catch(() => null),
      admin
        .all((offsets) => admin.grants({ tenant: slug, live: true, ...offsets }))
        .catch(() => null),
      admin.all((offsets) => admin.principals({ tenant: slug, ...offsets })).catch(() => null),
      admin.providers({ tenant: slug }).catch(() => null),
      admin.credentials({ tenant: slug }).catch(() => null),
      admin.routes({ tenant: slug }).catch(() => null),
      admin.catalog().catch(() => []),
    ]
  )
  const localProviders = (providers?.rows ?? []).filter((provider) => provider.kind === 'local')
  try {
    audit = await admin.audit({ tenant: slug, limit: 8 })
  } catch (error) {
    if (!(error instanceof AccessError) || error.status >= 500) throw error
    refusal = refusalOf(error)
  }
  const base = tenantPath(slug)
  const view = await rightsViewOf(c, slug, {
    grants: grants?.rows ?? [],
    roles: roles?.rows ?? [],
    groups: groups?.rows ?? [],
    users: users?.rows ?? [],
  })

  // Who administers the tenant: the holders of a live right that opens
  // the administration on the tenant itself, as Access would answer.
  const byId = new Map((users?.rows ?? []).map((user) => [user.id, user]))
  const administrators = new Map<string, Administrator>()
  for (const grant of grants?.rows ?? []) {
    const how = administrationOf(grant, view.roles, {
      tenant: slug,
      consoleRoute: view.consoleRoute,
    })
    if (!how) continue
    const key = grant.group ? `group:${grant.group}` : `user:${grant.userId}`
    const known = administrators.get(key)
    administrators.set(key, {
      holder: known?.holder ?? holderOf(slug, grant, byId, view.caller),
      sources: [...(known?.sources ?? []), { grant, how }],
    })
  }
  const membersOf = (key: string) =>
    groups?.rows.find((group) => group.key === key)?.members.length ?? 0
  const count = (total: number | undefined, complete: boolean | undefined) =>
    total === undefined ? '—' : complete === false ? `${total}+` : String(total)
  const mayFlag = allowanceOf(ability, ACTIONS.flag, tenantNamed(slug))

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
          <span class="metric">{count(groups?.rows.length, groups?.complete)}</span>
        </a>
        <a class="card card-link" href={`${base}/roles`}>
          <span class="muted small">Roles</span>
          <span class="metric">{count(roles?.rows.length, roles?.complete)}</span>
        </a>
        <a class="card card-link" href={`${base}/rights`}>
          <span class="muted small">Rights</span>
          <span class="metric">{tenant.grantCount ?? '—'}</span>
        </a>
      </div>
      <div class="split">
        <div class="stack">
          <section class="card">
            <header>
              <h2>Manage access</h2>
            </header>
            <ul class="tasks">
              <li>
                <a class="task" href={`${base}/rights?grant=1#grant`}>
                  <strong class="task-name">Give someone access</strong>
                  <span class="small muted">
                    Grant a role or a permission to a user or a group, where it should hold.
                  </span>
                </a>
              </li>
              <li>
                <a class="task" href={`${base}/users`}>
                  <strong class="task-name">See what someone can do</strong>
                  <span class="small muted">
                    Every permission of a user, where it comes from, and its groups.
                  </span>
                </a>
              </li>
              <li>
                <a class="task" href={`${base}/roles?view=matrix`}>
                  <strong class="task-name">Change what a role holds</strong>
                  <span class="small muted">
                    The roles against the permissions, in one grid you tick and save.
                  </span>
                </a>
              </li>
              <li>
                <a class="task" href={`${base}/rights`}>
                  <strong class="task-name">Find who holds a permission</strong>
                  <span class="small muted">
                    Filter the rights by what they give, a role's permissions included.
                  </span>
                </a>
              </li>
            </ul>
          </section>
          <section class="card" id="administrators">
            <header>
              <h2>Administrators</h2>
              <span class="small muted">{grants ? administrators.size : '—'}</span>
            </header>
            <p class="small muted">
              Who opens this administration: the holders of a live right that gives{' '}
              <code>{CONSOLE_KEYS.admin}</code> on the tenant itself.
            </p>
            {grants === null ? (
              <p class="muted">The console could not read the rights of the tenant.</p>
            ) : administrators.size === 0 ? (
              <p class="muted">
                Nobody of this tenant administers it. Make a user an administrator on the page of
                that user.
              </p>
            ) : (
              <div class="table-wrap">
                <table>
                  <tbody>
                    {[...administrators.values()].map(({ holder, sources }) => (
                      <tr>
                        <td>
                          {holder.kind === 'group' ? <span class="small muted">group </span> : null}
                          {holder.href ? <a href={holder.href}>{holder.label}</a> : holder.label}
                          {holder.self ? (
                            <>
                              {' '}
                              <Badge plain>you</Badge>
                            </>
                          ) : null}
                          {holder.kind === 'group' ? (
                            <div class="small muted">
                              {membersOf(holder.label)}{' '}
                              {membersOf(holder.label) === 1 ? 'member' : 'members'}
                            </div>
                          ) : null}
                        </td>
                        <td class="small">
                          {sources.map(({ grant, how }) => (
                            <div class="source">
                              {how.roles.length > 0 ? (
                                <>role {how.roles.join(' → ')}</>
                              ) : (
                                <code>{how.key}</code>
                              )}
                              <span class="muted"> · </span>
                              <RightPlace grant={grant} view={view} />
                            </div>
                          ))}
                        </td>
                        <td class="small">
                          {sources.some(({ how }) => how.key === CONSOLE_KEYS.platform) ? (
                            <Badge tone="accent" plain>
                              every tenant
                            </Badge>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {grants && !grants.complete ? (
              <p class="small muted">
                The console read the first thousand rights of the tenant: an administrator beyond
                them is not listed.
              </p>
            ) : null}
          </section>
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
        </div>
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
          <div key={provider.id} class="stack">
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
                        <td class="num actions">
                          <RemoveCredential
                            id={credential.id}
                            action={base}
                            email={credential.email}
                          />
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
                  vouch={allowanceOf(ability, ACTIONS.vouch, SUBJECTS.route)}
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
          platform={mayFlag.allowed}
          platformReason={mayFlag.reason}
          action={base}
        />
      </details>
    </>,
    { title: tenant.displayName, section: 'operators', crumbs: tenantCrumbs(slug) }
  )
})
