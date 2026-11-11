/**
 * The providers of a tenant: the list of them, and the form that
 * registers one.
 *
 * The default provider of a tenant is the registration of the tenant,
 * and it is written with it: it is not registered here, and it is not
 * removed here. The other providers of the tenant are the ones a caller
 * may sign in at, and the login asks the caller which one when there
 * are several.
 */

import type { Provider } from '../../domains/access'
import { Badge } from './page'

/** The form that registers a provider of a tenant. */
export function ProviderForm(props: { action: string }) {
  return (
    <form method="post" action={props.action} class="form">
      <input type="hidden" name="_action" value="save-provider" />
      <div class="form-grid">
        <label class="field">
          <span>Slug</span>
          <input name="slug" required pattern="[a-z0-9-]{2,63}" />
          <span class="hint">the name of the provider inside the tenant; it never changes</span>
        </label>
        <label class="field">
          <span>Name</span>
          <input name="displayName" />
        </label>
        <label class="field">
          <span>Issuer</span>
          <input name="issuer" type="url" required />
        </label>
        <label class="field">
          <span>Client at the provider</span>
          <input name="idpClientId" required />
        </label>
        <label class="field">
          <span>Secret at the provider</span>
          <input name="idpClientSecret" type="password" required autocomplete="new-password" />
          <span class="hint">never answered by the service</span>
        </label>
        <label class="field">
          <span>Redirect at the provider</span>
          <input name="idpRedirectUri" type="url" required />
        </label>
        <label class="field">
          <span>Scopes</span>
          <input name="idpScopes" placeholder="openid, email, profile" />
        </label>
      </div>
      <button type="submit" class="button">
        Register the provider
      </button>
    </form>
  )
}

/** The button that removes a provider of a tenant. */
export function RemoveProvider(props: { id: string; action: string }) {
  return (
    <form method="post" action={props.action} class="inline">
      <input type="hidden" name="_action" value="remove-provider" />
      <input type="hidden" name="id" value={props.id} />
      <button type="submit" class="button button-quiet">
        Remove
      </button>
    </form>
  )
}

/** The row of a provider in the list of the providers of a tenant. */
export function ProviderRow(props: { provider: Provider; action: string }) {
  const provider = props.provider
  const isDefault = provider.slug === 'default'
  return (
    <tr>
      <td>
        <code>{provider.slug}</code>
      </td>
      <td>{provider.displayName}</td>
      <td class="small muted">{provider.issuer}</td>
      <td class="small muted">{provider.idpClientId}</td>
      <td class="small">
        {provider.enabled ? <Badge tone="ok">enabled</Badge> : <Badge tone="error">disabled</Badge>}
      </td>
      <td>{isDefault ? null : <RemoveProvider id={provider.id} action={props.action} />}</td>
    </tr>
  )
}
