/**
 * The providers of a tenant: the list of them, and the form that
 * registers one.
 *
 * The default provider of a tenant is the registration of the tenant,
 * and it is written with it: it is not registered here, and it is not
 * removed here. The other providers of the tenant are the ones a caller
 * may sign in at, and the route of the address of the caller names the
 * one when there are several.
 */

import type { CatalogEntry, Provider } from '../../domains/access'
import ConfirmButton from '../islands/confirm-button'
import PresetPicker from '../islands/preset-picker'
import { Badge } from './page'

/** The form that registers a provider of a tenant. */
export function ProviderForm(props: { action: string; catalog: readonly CatalogEntry[] }) {
  return (
    <form method="post" action={props.action} class="form" data-provider>
      <input type="hidden" name="_action" value="save-provider" />
      <div class="form-grid">
        <PresetPicker catalog={props.catalog} />
        <label class="field">
          <span>Slug</span>
          <input name="slug" required pattern="[a-z0-9-]{2,63}" />
          <span class="hint">the name of the provider inside the tenant; it never changes</span>
        </label>
        <label class="field">
          <span>Kind</span>
          <select name="kind">
            <option value="oidc">an OpenID Connect provider</option>
            <option value="local">the accounts of the tenant</option>
          </select>
          <span class="hint">
            a local provider holds its own accounts: the callers sign in with a password
          </span>
        </label>
        <label class="field">
          <span>Name</span>
          <input name="displayName" />
        </label>
        <label class="field">
          <span>Issuer</span>
          <input name="issuer" type="url" />
          <span class="hint">the issuer of the provider: a local provider has none</span>
        </label>
        <label class="field">
          <span>Client at the provider</span>
          <input name="idpClientId" />
        </label>
        <label class="field">
          <span>Secret at the provider</span>
          <input name="idpClientSecret" type="password" autocomplete="new-password" />
          <span class="hint">never answered by the service</span>
        </label>
        <label class="field">
          <span>Redirect at the provider</span>
          <input name="idpRedirectUri" type="url" />
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

/** The button that removes a provider of a tenant: it asks first. */
export function RemoveProvider(props: { id: string; action: string; name: string }) {
  return (
    <form method="post" action={props.action} class="inline">
      <input type="hidden" name="_action" value="remove-provider" />
      <input type="hidden" name="id" value={props.id} />
      <ConfirmButton
        small
        label="Remove"
        message={`Remove the provider ${props.name}? Nobody signs in at it any more. Access refuses the removal while a user belongs to it.`}
      />
    </form>
  )
}

/** The form that writes the account of a caller of a local provider. */
export function CredentialForm(props: { action: string; provider: string }) {
  return (
    <form method="post" action={props.action} class="form">
      <input type="hidden" name="_action" value="save-credential" />
      <input type="hidden" name="provider" value={props.provider} />
      <div class="form-grid">
        <label class="field">
          <span>E-mail</span>
          <input name="email" type="email" required />
          <span class="hint">the address the caller signs in with</span>
        </label>
        <label class="field">
          <span>Password</span>
          <input name="password" type="password" required autocomplete="new-password" />
          <span class="hint">
            at least twelve characters: the caller cannot change it yet, the operator writes it
          </span>
        </label>
      </div>
      <button type="submit" class="button">
        Write the account
      </button>
    </form>
  )
}

/** The button that removes a credential of a local provider: it asks first. */
export function RemoveCredential(props: { id: string; action: string; email: string }) {
  return (
    <form method="post" action={props.action} class="inline">
      <input type="hidden" name="_action" value="remove-credential" />
      <input type="hidden" name="id" value={props.id} />
      <ConfirmButton
        small
        label="Remove"
        message={`Remove the account ${props.email}? It cannot sign in any more; its user and the rights it holds stay.`}
      />
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
      <td class="num actions">
        {isDefault ? (
          <span
            class="small muted"
            title="The default provider is the registration of the tenant: it is changed with the tenant"
          >
            the tenant's own
          </span>
        ) : (
          <RemoveProvider id={provider.id} action={props.action} name={provider.displayName} />
        )}
      </td>
    </tr>
  )
}
