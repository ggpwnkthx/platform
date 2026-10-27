/**
 * The form of a tenant: its creation, and its change.
 *
 * The access service never answers a secret: a change of a tenant
 * carries the secrets of its provider and of its client again, and a
 * secret that replaces another one is accepted beside it for a day.
 */

import type { Tenant, TenantInput } from '../../domains/access'
import type { SentForm } from '../middleware/forms'
import { listOf } from '../middleware/forms'

/** The input of the upsert of a tenant, from its form. */
export function tenantInputOf(form: SentForm, platform: boolean, current?: Tenant): TenantInput {
  const optional = (name: string) => {
    const value = form.get(name).trim()
    return value === '' ? undefined : value
  }
  const flag = (name: string) => form.get(name) === 'true'
  return {
    slug: current?.slug ?? form.get('slug').trim(),
    displayName: form.get('displayName').trim(),
    issuer: form.get('issuer').trim(),
    idpClientId: form.get('idpClientId').trim(),
    idpClientSecret: form.get('idpClientSecret'),
    ...(optional('idpRedirectUri') ? { idpRedirectUri: optional('idpRedirectUri') } : {}),
    ...(optional('idpScopes') ? { idpScopes: listOf(form.get('idpScopes')) } : {}),
    ...(optional('emailDomain') ? { emailDomain: optional('emailDomain') } : {}),
    clientId: form.get('clientId').trim(),
    clientSecret: form.get('clientSecret'),
    clientRedirectUris: listOf(form.get('clientRedirectUris')),
    autoProvision: flag('autoProvision'),
    enabled: flag('enabled'),
    // The flags of the platform are sent by the operator of the platform
    // only: the access service refuses a tenant credential that changes
    // them, and the console sends what the row holds.
    sharedClient: platform ? flag('sharedClient') : (current?.sharedClient ?? false),
    default: platform ? flag('default') : (current?.default ?? false),
  }
}

function Flag(props: {
  name: string
  label: string
  value: boolean
  disabled?: boolean
  hint?: string
}) {
  return (
    <label class="field">
      <span>{props.label}</span>
      <select name={props.name} disabled={props.disabled}>
        <option value="true" selected={props.value}>
          yes
        </option>
        <option value="false" selected={!props.value}>
          no
        </option>
      </select>
      {props.hint ? <span class="hint">{props.hint}</span> : null}
    </label>
  )
}

/** The form of a tenant. */
export function TenantForm(props: {
  tenant?: Tenant
  platform: boolean
  values?: Readonly<Record<string, string>>
  action: string
}) {
  const { tenant, values } = props
  const value = (name: string, fallback: string) => values?.[name] ?? fallback
  return (
    <form method="post" action={props.action} class="form">
      <input type="hidden" name="_action" value="save-tenant" />
      <div class="form-grid">
        <label class="field">
          <span>Slug</span>
          <input
            name="slug"
            required
            pattern="[a-z0-9-]{2,63}"
            value={value('slug', tenant?.slug ?? '')}
            disabled={tenant !== undefined}
          />
          <span class="hint">the key of the tenant; it never changes</span>
        </label>
        <label class="field">
          <span>Name</span>
          <input
            name="displayName"
            required
            value={value('displayName', tenant?.displayName ?? '')}
          />
        </label>
        <label class="field">
          <span>E-mail domain</span>
          <input name="emailDomain" value={value('emailDomain', tenant?.emailDomain ?? '')} />
        </label>
      </div>
      <fieldset class="form-grid" style="border: 0; padding: 0; margin: 0">
        <legend class="small muted" style="grid-column: 1 / -1">
          The provider of the tenant: the access service signs its people in there
        </legend>
        <label class="field">
          <span>Issuer</span>
          <input name="issuer" type="url" required value={value('issuer', tenant?.issuer ?? '')} />
        </label>
        <label class="field">
          <span>Client at the provider</span>
          <input name="idpClientId" required value={value('idpClientId', '')} />
        </label>
        <label class="field">
          <span>Secret at the provider</span>
          <input name="idpClientSecret" type="password" required autocomplete="new-password" />
          <span class="hint">never answered by the service: send it with every change</span>
        </label>
        <label class="field">
          <span>Redirect at the provider</span>
          <input
            name="idpRedirectUri"
            type="url"
            value={value('idpRedirectUri', '')}
            placeholder="the default of the service"
          />
        </label>
        <label class="field">
          <span>Scopes</span>
          <input
            name="idpScopes"
            value={value('idpScopes', '')}
            placeholder="openid, email, profile"
          />
        </label>
      </fieldset>
      <fieldset class="form-grid" style="border: 0; padding: 0; margin: 0">
        <legend class="small muted" style="grid-column: 1 / -1">
          The client of the tenant: the gateway, and the console, sign in with it
        </legend>
        <label class="field">
          <span>Client</span>
          <input name="clientId" required value={value('clientId', tenant?.clientId ?? '')} />
        </label>
        <label class="field">
          <span>Secret of the client</span>
          <input name="clientSecret" type="password" required autocomplete="new-password" />
          <span class="hint">a new secret is accepted beside the old one for a day</span>
        </label>
        <label class="field wide">
          <span>Redirects of the client</span>
          <textarea name="clientRedirectUris" rows={3} class="code">
            {value('clientRedirectUris', (tenant?.clientRedirectUris ?? []).join('\n'))}
          </textarea>
          <span class="hint">one url per line: a tenant that registers none signs nobody in</span>
        </label>
      </fieldset>
      <div class="form-grid">
        <Flag name="enabled" label="Enabled" value={tenant?.enabled ?? true} />
        <Flag
          name="autoProvision"
          label="Registers unknown people"
          value={tenant?.autoProvision ?? false}
        />
        <Flag
          name="sharedClient"
          label="Shared client"
          value={tenant?.sharedClient ?? false}
          disabled={!props.platform}
          hint="the operator of the platform only"
        />
        <Flag
          name="default"
          label="Default tenant"
          value={tenant?.default ?? false}
          disabled={!props.platform}
          hint="the operator of the platform only"
        />
      </div>
      <div class="row">
        <button type="submit" class="button">
          {tenant ? 'Save the tenant' : 'Create the tenant'}
        </button>
      </div>
    </form>
  )
}
