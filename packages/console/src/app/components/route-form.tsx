/**
 * The routes of a tenant: the list of them, the form that registers one,
 * and the proof of one.
 *
 * A route names the tenant of a login and the provider the login signs in
 * at (§3.13). It waits for its proof before it routes anything: the
 * owner of the domain publishes a record that carries the challenge of
 * the route, and the operator of the platform may vouch for a domain
 * instead.
 */

import type { Allowance } from '../../domains/ability'
import type { Provider, Route } from '../../domains/access'
import { Badge } from './page'
import { DisabledAction } from './why'

/** The form that registers a route of a tenant. */
export function RouteForm(props: { action: string; providers: readonly Provider[] }) {
  return (
    <form method="post" action={props.action} class="form">
      <input type="hidden" name="_action" value="save-route" />
      <div class="form-grid">
        <label class="field">
          <span>Domain or address</span>
          <input name="key" required placeholder="acme.example" />
          <span class="hint">
            the domain of the addresses of the tenant, or one address of its own
          </span>
        </label>
        <label class="field">
          <span>Kind</span>
          <select name="kind">
            <option value="domain">a domain of addresses</option>
            <option value="address">one address</option>
          </select>
        </label>
        <label class="field">
          <span>Provider</span>
          <select name="provider">
            <option value="">the default provider of the tenant</option>
            {props.providers
              .filter((provider) => provider.slug !== 'default')
              .map((provider) => (
                <option key={provider.slug} value={provider.slug}>
                  {provider.displayName}
                </option>
              ))}
          </select>
          <span class="hint">
            the provider the callers of that domain sign in at; the default one answers the domain
            that names no provider
          </span>
        </label>
      </div>
      <button type="submit" class="button">
        Register the route
      </button>
    </form>
  )
}

/** The button that proves a route, or refuses it. */
export function ProveRoute(props: {
  id: string
  action: string
  method: 'dns' | 'operator'
  label: string
}) {
  return (
    <form method="post" action={props.action} class="inline">
      <input type="hidden" name="_action" value="verify-route" />
      <input type="hidden" name="id" value={props.id} />
      <input type="hidden" name="verification" value={props.method} />
      <button type="submit" class="button quiet small">
        {props.label}
      </button>
    </form>
  )
}

/** The row of a route in the list of the routes of a tenant. */
export function RouteRow(props: {
  route: Route
  action: string
  /**
   * Whether the reader may vouch for a domain, and why not.
   *
   * Vouching is the platform's: an operator of a tenant sees the act
   * disabled, with the reason, and proves the domain with its record.
   */
  vouch: Allowance
}) {
  const route = props.route
  const record = route.kind === 'domain' ? `_access.${route.key}` : ''
  return (
    <tr>
      <td>
        <code>{route.key}</code>
      </td>
      <td class="small muted">{route.kind}</td>
      <td class="small">{route.provider ?? 'the default one'}</td>
      <td class="small">
        {route.status === 'verified' ? (
          <Badge tone="ok">verified</Badge>
        ) : route.status === 'rejected' ? (
          <Badge tone="error">refused</Badge>
        ) : (
          <Badge tone="warn">waits for its proof</Badge>
        )}
      </td>
      <td class="small muted mono">{route.challenge}</td>
      <td class="small">
        {route.status !== 'verified' ? (
          <span class="row">
            <ProveRoute id={route.id} action={props.action} method="dns" label="Check the record" />
            {props.vouch.allowed ? (
              <ProveRoute
                id={route.id}
                action={props.action}
                method="operator"
                label="Vouch for it"
              />
            ) : (
              <DisabledAction
                id={`vouch-${route.id}`}
                label="Vouch for it"
                reason={props.vouch.reason ?? ''}
                small
                ask={false}
              />
            )}
          </span>
        ) : null}
        {record ? <span class="hint">{record}</span> : null}
      </td>
    </tr>
  )
}
