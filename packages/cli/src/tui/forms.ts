/**
 * The forms of the interface.
 *
 * A form is a list of fields, and a field is a name, a label and a
 * value. The forms of the interface are the ones of the objects of a
 * deployment: a profile, a tenant, a principal and a grant. The forms
 * hold no policy: a form is written by the service that owns it.
 */

import type { Question } from '../domains/deployment'
import type { Field } from './model'

/**
 * A field of a question of the wizard.
 *
 * @param question the question.
 * @param value the value of the field.
 */
export function fieldOf(question: Question, value: string): Field {
  return {
    name: question.name,
    label: question.summary,
    value,
    kind: question.choices ? 'choice' : 'text',
    ...(question.choices ? { choices: question.choices } : {}),
  }
}

/**
 * The fields of a tenant.
 *
 * @param record the tenant, when there is one.
 */
export function tenantFields(record?: Record<string, unknown>): Field[] {
  const held = record ?? {}
  const text = (name: string, label: string, hint?: string, secret = false): Field => ({
    name,
    label,
    value: valueOfRecord(held, name),
    kind: 'text',
    ...(hint ? { hint } : {}),
    ...(secret ? { secret } : {}),
  })
  const toggle = (name: string, label: string, value: boolean): Field => ({
    name,
    label,
    value: value ? 'true' : 'false',
    kind: 'toggle',
  })
  return [
    text('slug', 'the slug of the tenant', 'the name of the tenant in Access'),
    text('displayName', 'the name of the tenant'),
    text('issuer', 'the issuer of the provider'),
    text('idpClientId', 'the client of the provider'),
    text('idpClientSecret', 'the secret of the provider', 'the interface does not draw it', true),
    text('idpRedirectUri', 'the callback of the provider'),
    text('emailDomain', 'the domain of the addresses'),
    text('clientId', 'the client of the gateway'),
    text('clientSecret', 'the secret of the gateway', 'the interface does not draw it', true),
    text('clientRedirectUris', 'the callbacks of the gateway', 'separated by commas'),
    toggle('autoProvision', 'registers unknown people', held.autoProvision === true),
    toggle(
      'autoProvisionAdmin',
      'the first one administers the tenant',
      held.autoProvisionAdmin === true
    ),
    toggle('sharedClient', 'the tenant shares the client', held.sharedClient === true),
    toggle('default', 'the tenant is the default one', held.default === true),
    toggle('enabled', 'the tenant is enabled', held.enabled !== false),
  ]
}

/**
 * The value of a field of a record.
 *
 * @param record the record.
 * @param name the name of the value.
 */
function valueOfRecord(record: Record<string, unknown>, name: string): string {
  const value = record[name]
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.map((entry) => String(entry)).join(', ')
  return String(value)
}

/** What the interface knows when it opens a form of Access. */
export interface Known {
  /** The slugs of the tenants of the deployment. */
  readonly tenants?: readonly string[]
  /** The principals of the tenant, as the reader calls them. */
  readonly principals?: readonly string[]
  /** The permissions the grants of the deployment name. */
  readonly permissions?: readonly string[]
  /** The workspaces the grants of the deployment name. */
  readonly workspaces?: readonly string[]
  /** The routes the grants of the deployment name. */
  readonly routes?: readonly string[]
  /** The operators who gave the grants of the deployment. */
  readonly givers?: readonly string[]
  /** The tenant the reader is in. */
  readonly tenant?: string
  /** The principal the reader is on, as the reader calls it. */
  readonly principal?: string
  /** The workspace of the deployment. */
  readonly workspace?: string
  /** Who gave the last grant of the reader. */
  readonly giver?: string
}

/**
 * A field that holds a text, with the values the interface knows for it.
 *
 * @param name the name of the value.
 * @param label what the field is.
 * @param value the value of the field.
 * @param suggestions the values the interface knows.
 * @param hint what the reader should know about the field.
 */
function offered(
  name: string,
  label: string,
  value: string | undefined,
  suggestions: readonly string[] | undefined,
  hint?: string
): Field {
  return {
    name,
    label,
    value: value ?? '',
    kind: 'text',
    ...(suggestions && suggestions.length > 0 ? { suggestions } : {}),
    ...(hint ? { hint } : {}),
  }
}

/**
 * The fields of a principal.
 *
 * The tenant is the one the reader is in, or the only one of the
 * deployment: the reader does not type what the interface knows.
 *
 * @param known what the interface knows.
 */
export function principalFields(known: Known = {}): Field[] {
  const tenant = known.tenant ?? (known.tenants?.length === 1 ? known.tenants[0] : undefined)
  return [
    offered(
      'tenant',
      'the tenant of the principal',
      tenant,
      known.tenants,
      'the slug of the tenant'
    ),
    {
      name: 'externalSubject',
      label: 'the subject of the provider',
      value: '',
      kind: 'text',
      hint: 'what the provider of the tenant calls the account: its sub',
    },
    { name: 'email', label: 'the address of the principal', value: '', kind: 'text' },
    { name: 'displayName', label: 'the name of the principal', value: '', kind: 'text' },
  ]
}

/**
 * The fields of a grant.
 *
 * A grant names a tenant, a principal, a permission, a workspace and a
 * route, and the interface knows most of them before the reader types
 * anything: the tenant and the principal are the ones the reader is
 * on, the workspace is the one of the deployment, and the others are
 * offered from the grants the deployment already holds.
 *
 * @param known what the interface knows.
 */
export function grantFields(known: Known = {}): Field[] {
  const tenant = known.tenant ?? (known.tenants?.length === 1 ? known.tenants[0] : undefined)
  const only = (values: readonly string[] | undefined): string | undefined =>
    values?.length === 1 ? values[0] : undefined
  return [
    offered('tenant', 'the tenant of the grant', tenant, known.tenants, 'the slug of the tenant'),
    offered(
      'userId',
      'the principal of the grant',
      known.principal,
      known.principals,
      'the address of a principal of the tenant, or its identifier'
    ),
    offered(
      'permission',
      'the permission of the grant',
      undefined,
      known.permissions,
      'the key of the permission, like workspace.read'
    ),
    offered(
      'workspaceId',
      'the workspace of the grant',
      known.workspace ?? only(known.workspaces),
      known.workspaces
    ),
    offered(
      'routeId',
      'the route of the grant',
      only(known.routes),
      known.routes,
      'the id of the route of the gateway'
    ),
    {
      name: 'expiresAt',
      label: 'the moment the grant ends',
      value: '',
      kind: 'text',
      hint: 'nothing, for a grant that never ends',
    },
    offered('grantedBy', 'who gave the grant', known.giver ?? only(known.givers), known.givers),
  ]
}

/**
 * The fields of a profile.
 *
 * @param profile the profile of the deployment.
 */
export function profileFields(profile: {
  gatewayUrl?: string
  controlUrl?: string
  accessUrl?: string
  workspaceId?: string
  tenantId?: string
  clientId?: string
  redirectUri?: string
}): Field[] {
  return [
    {
      name: 'gatewayUrl',
      label: 'the address of the gateway',
      value: profile.gatewayUrl ?? '',
      kind: 'text',
    },
    {
      name: 'controlUrl',
      label: 'the address of the control plane',
      value: profile.controlUrl ?? '',
      kind: 'text',
    },
    {
      name: 'accessUrl',
      label: 'the address of Access',
      value: profile.accessUrl ?? '',
      kind: 'text',
    },
    { name: 'workspaceId', label: 'the workspace', value: profile.workspaceId ?? '', kind: 'text' },
    { name: 'tenantId', label: 'the tenant', value: profile.tenantId ?? '', kind: 'text' },
    {
      name: 'clientId',
      label: 'the client of the CLI',
      value: profile.clientId ?? '',
      kind: 'text',
    },
    {
      name: 'redirectUri',
      label: 'the callback of the login',
      value: profile.redirectUri ?? '',
      kind: 'text',
    },
  ]
}
