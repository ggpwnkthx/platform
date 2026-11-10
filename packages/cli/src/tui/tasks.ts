/**
 * The work of the interface.
 *
 * The interface asks the same services the commands ask, and it asks
 * them through the same core: a fact the interface holds and a fact a
 * command holds are the same fact, and the interface never computes
 * what Access or the gateway answers.
 */

import {
  listGrants,
  listPrincipals,
  listTenants,
  revokeGrant,
  writeGrant,
  writePrincipal,
  writeTenant,
  type AccessCall,
} from '../domains/access'
import type { ResolvedContext } from '../domains/context'
import { CliFailure } from '../domains/failure'
import type { HttpPort, Profile, Profiles } from '../domains/contracts'
import { probesOf, type Probe } from '../domains/status'
import type { Row } from './model'
import type { Form } from './model'
import type { Values } from '../domains/deployment'

/**
 * The call to the administration of Access.
 *
 * The credential of the administration is not a part of a profile: it
 * is in the environment of the shell, and the interface says so when
 * there is none.
 *
 * @param http the transport of the calls.
 * @param context the deployment the call works on.
 */
export function accessCallOf(http: HttpPort, context: ResolvedContext): AccessCall {
  if (!context.accessUrl) {
    throw new CliFailure(
      'the address of Access is missing: set PLATFORMCTL_ACCESS_URL, or name it in the profile',
      2,
      'missing_argument'
    )
  }
  if (!context.adminToken) {
    throw new CliFailure(
      'the credential of the administration is missing: set PLATFORMCTL_ADMIN_TOKEN',
      3,
      'not_authenticated'
    )
  }
  return { http, baseUrl: context.accessUrl, token: context.adminToken }
}

/**
 * A record of an answer of a service.
 *
 * @param value the value of the answer.
 */
function recordOf(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return {}
  return value as Record<string, unknown>
}

/**
 * The rows of a list of an answer.
 *
 * @param body the answer of the service.
 * @param key the name of the list in the answer.
 */
export function rowsOf(body: unknown, key: string): Record<string, unknown>[] {
  const list = recordOf(body)[key]
  if (!Array.isArray(list)) return []
  return list.filter(
    (entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null
  )
}

/**
 * The text of a value of a record.
 *
 * @param record the record.
 * @param key the name of the value.
 */
function textOf(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

/**
 * The rows of the tenants of a deployment.
 *
 * @param body the answer of Access.
 */
export function tenantRows(body: unknown): Row[] {
  return rowsOf(body, 'tenants').map((tenant) => ({
    id: textOf(tenant, 'slug'),
    cells: [
      textOf(tenant, 'slug'),
      textOf(tenant, 'displayName'),
      textOf(tenant, 'id'),
      textOf(tenant, 'userCount'),
      textOf(tenant, 'grantCount'),
      tenant.enabled === false ? 'disabled' : 'enabled',
    ],
  }))
}

/**
 * The rows of the principals of a deployment.
 *
 * @param body the answer of Access.
 */
export function principalRows(body: unknown): Row[] {
  return rowsOf(body, 'principals').map((principal) => ({
    id: textOf(principal, 'id'),
    cells: [
      textOf(principal, 'email'),
      textOf(principal, 'displayName'),
      textOf(principal, 'id'),
      textOf(principal, 'tenant'),
      textOf(principal, 'status'),
      textOf(principal, 'lastLoginAt'),
    ],
  }))
}

/**
 * The rows of the grants of a deployment.
 *
 * @param body the answer of Access.
 */
export function grantRows(body: unknown, names: ReadonlyMap<string, string> = new Map()): Row[] {
  return rowsOf(body, 'grants').map((grant) => ({
    id: textOf(grant, 'id'),
    cells: [
      textOf(grant, 'tenant'),
      // A principal is read by its address, and not by its identifier,
      // when the interface knows the address.
      names.get(textOf(grant, 'userId')) ?? (textOf(grant, 'userId') || textOf(grant, 'group')),
      textOf(grant, 'permission'),
      textOf(grant, 'workspaceId'),
      textOf(grant, 'routeId'),
      textOf(grant, 'expiresAt') || 'never',
    ],
  }))
}

/** A principal, as the interface names it. */
export interface Person {
  /** The identifier of the principal. */
  readonly id: string
  /** What the reader calls the principal: its address, its name or its identifier. */
  readonly label: string
  /** The slug of the tenant of the principal. */
  readonly tenant: string
}

/**
 * The principals of an answer of Access, as the interface names them.
 *
 * @param body the answer of Access: a list of principals, or one of them.
 */
export function peopleOf(body: unknown): Person[] {
  const records = rowsOf(body, 'principals')
  const one = recordOf(body)
  if (records.length === 0 && typeof one.id === 'string') records.push(one)
  return records
    .filter((record) => textOf(record, 'id') !== '')
    .map((record) => ({
      id: textOf(record, 'id'),
      label:
        textOf(record, 'email') ||
        textOf(record, 'displayName') ||
        textOf(record, 'externalSubject') ||
        textOf(record, 'id'),
      tenant: textOf(record, 'tenant'),
    }))
}

/**
 * The values of a list of an answer, each of them once.
 *
 * @param body the answer of the service.
 * @param key the name of the list in the answer.
 * @param name the name of the value.
 */
export function valuesIn(body: unknown, key: string, name: string): string[] {
  return [...new Set(rowsOf(body, key).map((record) => textOf(record, name)))].filter(
    (value) => value !== ''
  )
}

/**
 * The lines that describe a record.
 *
 * @param record the record.
 */
export function detailsOf(record: Record<string, unknown>): string[] {
  const lines: string[] = []
  for (const [name, value] of Object.entries(record)) {
    if (value === null || value === undefined) continue
    if (typeof value === 'object') continue
    lines.push(`${name}: ${String(value)}`)
  }
  return lines
}

/**
 * A list of values, separated by commas.
 *
 * @param text the text of the reader.
 */
export function listOf(text: string): string[] {
  return text
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
}

/**
 * The record of a row of a list.
 *
 * @param body the answer of the service.
 * @param key the name of the list in the answer.
 * @param id the identifier of the row.
 */
export function recordOfRow(
  body: unknown,
  key: string,
  id: string
): Record<string, unknown> | undefined {
  // A tenant is a row of its slug, and it carries an identifier as
  // well: the record of a row is the one that answers to either.
  return rowsOf(body, key).find((record) => record.id === id || record.slug === id)
}

/**
 * The tenants of a deployment.
 *
 * @param call the call to Access.
 */
export async function tenantsOf(call: AccessCall): Promise<unknown> {
  return await listTenants(call)
}

/**
 * The principals of a deployment.
 *
 * @param call the call to Access.
 * @param query the query of the page.
 */
export async function principalsOf(
  call: AccessCall,
  query: Readonly<Record<string, string | number | undefined>>
): Promise<unknown> {
  return await listPrincipals(call, query)
}

/**
 * The grants of a deployment.
 *
 * @param call the call to Access.
 * @param query the query of the page.
 */
export async function grantsOf(
  call: AccessCall,
  query: Readonly<Record<string, string | number | undefined>>
): Promise<unknown> {
  return await listGrants(call, query)
}

/**
 * Writes a tenant.
 *
 * @param call the call to Access.
 * @param tenant the tenant to write.
 */
export async function tenantOf(call: AccessCall, tenant: unknown): Promise<unknown> {
  return await writeTenant(call, tenant)
}

/**
 * Writes a principal.
 *
 * @param call the call to Access.
 * @param principal the principal to write.
 */
export async function principalOf(call: AccessCall, principal: unknown): Promise<unknown> {
  return await writePrincipal(call, principal)
}

/**
 * Writes a grant.
 *
 * @param call the call to Access.
 * @param grant the grant to write.
 */
export async function grantOf(call: AccessCall, grant: unknown): Promise<unknown> {
  return await writeGrant(call, grant)
}

/**
 * Revokes a grant.
 *
 * @param call the call to Access.
 * @param id the id of the grant.
 */
export async function revokeOf(call: AccessCall, id: string): Promise<unknown> {
  return await revokeGrant(call, id)
}

/**
 * The probes of a deployment.
 *
 * @param http the transport of the calls.
 * @param context the deployment the probes are of.
 */
export async function probesOfDeployment(
  http: HttpPort,
  context: ResolvedContext
): Promise<readonly Probe[]> {
  return await probesOf(http, {
    gatewayUrl: context.gatewayUrl,
    controlUrl: context.controlUrl,
    accessUrl: context.accessUrl,
  })
}

/**
 * The deployments of the machine.
 *
 * @param store the store of the profiles.
 */
export async function profilesOf(store: { read(): Promise<Profiles> }): Promise<Profiles> {
  return await store.read()
}

/**
 * Writes a profile of a deployment.
 *
 * @param store the store of the profiles.
 * @param name the name of the profile.
 * @param profile the values of the profile.
 * @param current true when the profile becomes the one of the machine.
 */
export async function saveProfile(
  store: { read(): Promise<Profiles>; write(profiles: Profiles): Promise<void> },
  name: string,
  profile: Profile,
  current: boolean
): Promise<void> {
  const profiles = await store.read()
  const existing = profiles.profiles[name] ?? {}
  await store.write({
    current: current ? name : profiles.current,
    profiles: { ...profiles.profiles, [name]: { ...existing, ...profile } },
  })
}

/**
 * Removes a profile of a deployment.
 *
 * @param store the store of the profiles.
 * @param name the name of the profile.
 */
export async function removeProfile(
  store: { read(): Promise<Profiles>; write(profiles: Profiles): Promise<void> },
  name: string
): Promise<void> {
  const profiles = await store.read()
  const rest = { ...profiles.profiles }
  delete rest[name]
  await store.write({
    current: profiles.current === name ? undefined : profiles.current,
    profiles: rest,
  })
}

/**
 * The profile of a deployment that was just applied.
 *
 * A deployment the interface created is a deployment the interface
 * works on: its profile is written when it is applied, and the reader
 * does not copy its addresses out of the log. The profile is named
 * after the group of the resources of the deployment — its prefix and
 * its environment. The addresses are the public names of the
 * deployment, and the address of Access is the one the templates
 * answered when they answered one. A deployment that has no public
 * names names no address the interface can vouch for.
 *
 * @param values the answers the deployment was created with.
 * @param outputs what the templates answered, as the log holds it.
 */
export function profileOfDeployment(
  values: Readonly<Values>,
  outputs: Readonly<Record<string, string>>
): { readonly name: string; readonly profile: Profile } {
  const environment = values.environment || outputs.environment || 'deployment'
  const prefix = values.name_prefix ?? ''
  const zone = values.dns_zone_name ?? ''
  const named = outputs.public_names_enabled !== 'false' && zone !== ''
  const addressOf = (name: string | undefined): string | undefined =>
    named && name ? `https://${name}.${zone}` : undefined
  const profile: Record<string, string> = {}
  const gateway = addressOf(values.gateway_name)
  const access = /^https?:\/\//.test(outputs.access_issuer ?? '')
    ? outputs.access_issuer
    : addressOf(values.access_name)
  if (gateway) profile.gatewayUrl = gateway
  if (access) profile.accessUrl = access
  if (values.data_workspace_id) profile.workspaceId = values.data_workspace_id
  return { name: prefix === '' ? environment : `${prefix}-${environment}`, profile }
}

/**
 * A deployment of the machine, as the interface knows it.
 *
 * The key of the map of the deployments of the machine is the
 * environment of the deployment, and the value names the profile of the
 * deployment and the address of Access it answers at. The interface
 * reads them to know which deployment the profile the reader has
 * selected is: a deployment is applied again by its environment.
 */
export interface DeploymentOnMachine {
  /** The name of the profile of the deployment. */
  readonly name: string
  /** The address of Access of the deployment. */
  readonly accessUrl?: string
}

/**
 * An address without the stroke it may end with.
 *
 * Two addresses that name the same service are the same address when
 * they are written the same way, and the reader may have written the
 * stroke that ends it.
 *
 * @param address the address.
 */
export function plain(address: string | undefined): string {
  return (address ?? '').replace(/\/+$/, '').toLowerCase()
}

/**
 * The environment of the deployment of a profile.
 *
 * A profile is the deployment the reader works on, and a deployment is
 * applied again by its environment: the answers of that environment are
 * the answers of the deployment. The profile of a deployment is named
 * after it, and the address of Access of the deployment is the address
 * of the profile: the two tell which deployment a profile is.
 *
 * @param deployments the deployments of the machine, by their environment.
 * @param name the name of the profile.
 * @param accessUrl the address of Access of the profile.
 */
export function environmentOf(
  deployments: ReadonlyMap<string, DeploymentOnMachine>,
  name: string,
  accessUrl?: string
): string | undefined {
  for (const [environment, deployment] of deployments) {
    if (deployment.name === name) return environment
  }
  if (accessUrl === undefined) return undefined
  for (const [environment, deployment] of deployments) {
    if (deployment.accessUrl === undefined) continue
    if (plain(deployment.accessUrl) === plain(accessUrl)) return environment
  }
  return undefined
}

/**
 * The answers the wizard of a deployment is given.
 *
 * The answers are the values of the form, and the digests of the
 * images are the exception: the release of the platform answers them,
 * and the placeholder of the example of the templates is not a digest
 * anybody proved. An answer that is the placeholder is left out, and
 * the release answers the question.
 *
 * @param form the form the reader filled in.
 * @param defaults the values the templates hold by default.
 */
export function answersFor(form: Form, defaults: Readonly<Values>): Values {
  const values: Values = {}
  for (const field of form.fields) {
    const value = field.value
    if (value === '' && (defaults[field.name] ?? '') === '') continue
    if (field.name.endsWith('_image') && value === (defaults[field.name] ?? '')) continue
    values[field.name] = value
  }
  return values
}
