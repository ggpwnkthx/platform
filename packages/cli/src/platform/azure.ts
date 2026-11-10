/**
 * Microsoft Azure, as a provider of the infrastructure of a deployment.
 *
 * The provider knows how to sign the operator in: the client of Azure
 * is a program of the machine of the operator, and the provider runs
 * it. The provider reads the facts of the deployment from the system of
 * Azure — the tenant of the subscription and the subscription itself —
 * and it declares the questions the wizard asks.
 *
 * The provider holds no credential: the sign in is the one of the
 * client of Azure, and the reader of Azure chooses it.
 */

import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CliFailure } from '../domains/failure'
import {
  ACCOUNT,
  type Account,
  type AfterApply,
  ENVIRONMENTS,
  type Asker,
  type DeploymentProvider,
  type Importable,
  type Leftover,
  type Question,
  type SignIn,
  type Values,
} from '../domains/deployment'
import { run } from './process'

/** The questions of a deployment on Azure. */
export const AZURE_QUESTIONS: readonly Question[] = [
  {
    name: 'name_prefix',
    summary: 'the prefix of the name of every resource of the deployment',
    kind: 'chosen',
  },
  {
    name: 'environment',
    summary: 'the environment of the deployment',
    kind: 'chosen',
    choices: ENVIRONMENTS,
  },
  {
    name: 'location',
    summary: 'the region of Azure the deployment runs in',
    kind: 'chosen',
  },
  {
    name: 'resource_group_name',
    summary: 'the name of the resource group of the deployment',
    kind: 'given',
  },
  {
    name: 'tenant_id',
    summary: 'the tenant of Entra ID that holds the application of Access',
    kind: 'given',
    shape: 'uuid',
  },
  {
    name: 'subscription_id',
    summary: 'the subscription of Azure the deployment is written in',
    kind: 'given',
    shape: 'uuid',
  },
  {
    name: 'operator_principal_id',
    summary: 'the identity of the operator, which writes the secrets of the deployment',
    kind: 'given',
  },
  {
    name: 'key_vault_name',
    summary: 'the name of the vault of the deployment',
    kind: 'given',
  },
  {
    name: 'dns_zone_name',
    summary:
      'the zone of DNS that holds the public names of the deployment, for example example.com',
    kind: 'required',
  },
  {
    name: 'gateway_name',
    summary: 'the name of the gateway in the zone of the deployment, for example api',
    kind: 'required',
  },
  {
    name: 'access_name',
    summary: 'the name of the issuer of Access in the zone of the deployment, for example access',
    kind: 'required',
  },
  {
    name: 'console_name',
    summary: 'the name of the console in the zone of the deployment, for example console',
    kind: 'required',
  },
  {
    name: 'dns_records_managed',
    summary: 'whether the deployment writes the records of the public names in the zone of Azure',
    kind: 'given',
  },
  {
    name: 'dns_zone_resource_group_name',
    summary: 'the resource group that holds the zone of the public names of the deployment',
    kind: 'given',
  },
  {
    name: 'client_id',
    summary: "the identifier of the tenant's client at Access",
    kind: 'given',
  },
  {
    name: 'entra_tenant_enabled',
    summary: 'whether the deployment creates the application of Access at Entra ID',
    kind: 'given',
  },
  {
    name: 'entra_secret_rotation',
    summary: 'the key of the rotation of the secret of the client of Access at Entra ID',
    kind: 'given',
  },
  {
    name: 'route_id',
    summary: 'the identifier of the route that forwards to Data',
    kind: 'given',
  },
  {
    name: 'workspace_path_prefix',
    summary: 'the path prefix of the workspace, as the route table names it',
    kind: 'given',
  },
  {
    name: 'access_tenant_id',
    summary: 'the identifier of the tenant of Access',
    kind: 'required',
    shape: 'uuid',
  },
  {
    name: 'data_workspace_id',
    summary: 'the identifier of the workspace of Data',
    kind: 'required',
    shape: 'uuid',
  },
  {
    name: 'data_workspace_slug',
    summary: 'the slug of the workspace of Data, and of the tenant of the deployment',
    kind: 'required',
  },
  {
    name: 'tenant_auto_provision',
    summary:
      'whether the tenant of the deployment provisions the identities that sign in for the first time',
    kind: 'given',
  },
  {
    name: 'tenant_auto_provision_admin',
    summary: 'whether the first identity that signs in administers the tenant of the deployment',
    kind: 'given',
  },
  {
    name: 'gateway_image',
    summary: 'the image of the gateway, by digest',
    kind: 'required',
    shape: 'digest',
  },
  {
    name: 'access_image',
    summary: 'the image of Access, by digest',
    kind: 'required',
    shape: 'digest',
  },
  {
    name: 'data_image',
    summary: 'the image of Data, by digest',
    kind: 'required',
    shape: 'digest',
  },
  {
    name: 'console_image',
    summary: 'the image of the console, by digest',
    kind: 'required',
    shape: 'digest',
  },
  {
    name: 'postgres_client_image',
    summary: 'the image of the client of PostgreSQL, by digest',
    kind: 'required',
    shape: 'digest',
  },
  {
    name: 'postgresql_version',
    summary: 'the version of PostgreSQL the deployment runs',
    kind: 'given',
  },
  {
    name: 'postgresql_sku_name',
    summary: 'the size of the server of PostgreSQL',
    kind: 'given',
  },
  {
    name: 'postgresql_storage_mb',
    summary: 'the storage of the server of PostgreSQL, in megabytes',
    kind: 'given',
  },
  {
    name: 'postgresql_high_availability',
    summary: 'whether the server of PostgreSQL is zone redundant',
    kind: 'given',
  },
  {
    name: 'postgresql_backup_retention_days',
    summary: 'the number of days the backups of the deployment are kept',
    kind: 'given',
  },
  {
    name: 'redis_sku_name',
    summary: 'the size of the cache of Redis',
    kind: 'given',
  },
  {
    name: 'public_names_enabled',
    summary: 'whether the public names of the deployment are bound to the gateway',
    kind: 'given',
  },
  {
    name: 'trusted_proxy_cidrs',
    summary: 'the addresses of the proxies the gateway trusts',
    kind: 'given',
  },
  {
    name: 'log_analytics_retention_days',
    summary: 'the number of days the logs of the deployment are kept',
    kind: 'given',
  },
]

/** The path of the client of Azure. */
function azureCli(environment: Readonly<Record<string, string | undefined>>): string {
  const named = environment.AZURE_CLI
  if (named) return named
  const path = environment.PATH ?? ''
  for (const directory of path.split(':')) {
    if (directory === '') continue
    const candidate = join(directory, 'az')
    if (existsSync(candidate)) return candidate
  }
  throw new CliFailure(
    'the client of Azure is not on the path: install the Azure CLI, or name it with AZURE_CLI',
    4,
    'cli_missing'
  )
}

/** A subscription of the operator. */
interface Subscription {
  readonly id: string
  readonly name: string
  readonly tenantId?: string
  /** True when the subscription is the one the session works in. */
  readonly current: boolean
}

/**
 * The subscriptions the operator holds.
 *
 * @param binary the path of the client of Azure.
 */
async function subscriptionsOf(binary: string): Promise<Subscription[]> {
  const answer = await run(binary, ['account', 'list', '--output', 'json'])
  if (answer.status !== 0) {
    throw new CliFailure(
      `the subscriptions of the operator cannot be read: ${answer.stderr.trim()}`,
      7,
      'unreachable'
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(answer.stdout)
  } catch {
    throw new CliFailure(
      'the subscriptions of the operator are not the json the client writes',
      8,
      'invalid_answer'
    )
  }
  if (!Array.isArray(parsed)) return []
  const subscriptions: Subscription[] = []
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    if (typeof record.id !== 'string') continue
    subscriptions.push({
      id: record.id,
      name: typeof record.name === 'string' ? record.name : record.id,
      tenantId: typeof record.tenantId === 'string' ? record.tenantId : undefined,
      current: record.isDefault === true,
    })
  }
  return subscriptions
}

/**
 * The subscriptions the session of the machine holds.
 *
 * Nobody is signed in: a machine that holds no session, and a machine
 * that holds no client of Azure, hold no subscription.
 *
 * @param environment the environment of the process.
 */
async function accountsOf(
  environment: Readonly<Record<string, string | undefined>>
): Promise<readonly Account[]> {
  try {
    const binary = azureCli(environment)
    const current = await run(binary, ['account', 'show', '--output', 'json'])
    if (current.status !== 0) return []
    return (await subscriptionsOf(binary)).map(({ id, name, current }) => ({ id, name, current }))
  } catch {
    return []
  }
}

/**
 * The identity of the operator, as the client of Azure names it.
 *
 * The identity reads and writes the state of the deployment, and the
 * deployment needs its identifier: the client of Azure answers with it
 * when it is asked for the account it is signed in to. The account does
 * not always name the identity, and the directory of Entra ID does:
 * the second answer is the one that is used when the first one is
 * empty.
 *
 * @param binary the path of the client of Azure.
 */
async function principalOf(binary: string): Promise<string> {
  const answer = await run(binary, ['account', 'show', '--output', 'json'])
  let servicePrincipal = false
  if (answer.status === 0) {
    try {
      const parsed = JSON.parse(answer.stdout) as Record<string, unknown>
      const user = parsed.user
      if (user && typeof user === 'object') {
        const record = user as Record<string, unknown>
        if (typeof record.id === 'string' && record.id !== '') return record.id
        // The name of a service principal is the identifier of the
        // principal, and the name of a person is not.
        servicePrincipal = record.type === 'servicePrincipal'
        if (servicePrincipal && typeof record.name === 'string') return record.name
      }
    } catch {
      // The answer of the client is not the json it writes: the
      // directory of Entra ID is asked instead.
    }
  }
  if (servicePrincipal) return ''
  const signedIn = await run(binary, [
    'ad',
    'signed-in-user',
    'show',
    '--query',
    'id',
    '--output',
    'tsv',
  ])
  if (signedIn.status !== 0) return ''
  const id = signedIn.stdout.trim()
  return id === '' ? '' : id
}

/**
 * The resource of Azure that a refusal names.
 *
 * The refusal of the provider of Azure names the kind of the resource,
 * the name of it, the group of the resources it belongs to, and the
 * subscription. The name of the group and the name of the resource are
 * two names, and the refusal holds both: the one that is not the name
 * of the group is the name of the resource.
 */
interface Refused {
  /** The kind of the resource, as the refusal names it. */
  readonly kind: string
  /** The name of the resource. */
  readonly name: string
  /** The group of the resources the resource belongs to. */
  readonly group: string
  /** The subscription the resource belongs to. */
  readonly subscription: string
}

/**
 * Reads the resource that a refusal of Azure names.
 *
 * The refusal of the provider of Azure reads:
 *
 *   Error: creating Key Vault (Subscription: "…"
 *   Resource Group Name: "…"
 *   Key Vault Name: "…"): performing CreateOrUpdate: …
 *
 * The name of the resource is the one that carries the kind of the
 * resource: the kind of a vault is a vault, and the group of the
 * resources is a group of resources. A name that carries neither is
 * not the name of the resource, and the resource stays unknown.
 *
 * @param reason what the tool said about the failure.
 */
function refusedOf(reason: string): Refused | undefined {
  const refusal = reason.match(/creating ([A-Za-z][A-Za-z ]*) \(([^)]*)\)/)
  if (refusal === null) return undefined
  const kind = refusal[1]!.trim()
  const fields = refusal[2]!.replace(/Subscription: "[^"]*"/, '')
  const subscription = refusal[2]!.match(/Subscription: "([^"]+)"/)?.[1]
  const group = fields.match(/Resource Group Name: "([^"]+)"/)?.[1]
  if (subscription === undefined || group === undefined) return undefined
  const name = nameAmong(fields, kind)
  if (name === undefined) return undefined
  return { kind, name, group, subscription }
}

/**
 * The name of the resource among the names a refusal carries.
 *
 * The label of a name ends the kind of the resource: the kind of a
 * container registry is a container registry, and the name of it is
 * labelled with the registry of it. A label that does not end the kind
 * names something else, and it is not the name of the resource.
 *
 * @param fields the fields of the refusal.
 * @param kind the kind of the resource.
 */
function nameAmong(fields: string, kind: string): string | undefined {
  const words = kind
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== '')
  for (const match of fields.matchAll(/([A-Za-z][A-Za-z ]*?)Name: "([^"]+)"/g)) {
    const label = match[1]!
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word !== '')
    if (label.length === 0 || label.length > words.length) continue
    const tail = words.slice(words.length - label.length)
    if (!label.every((word, index) => word === tail[index])) continue
    return match[2]!
  }
  return undefined
}

/**
 * Reports whether the kind of a resource of Azure is the type of it.
 *
 * The type of a resource of Azure names the namespace of its provider
 * and the kind of the resource: a vault is a vault of the namespace of
 * the vaults. Every word of the kind of the resource is in the type of
 * it, and the type of a resource that is not of the kind does not
 * carry them all.
 *
 * @param kind the kind of the resource, as a refusal names it.
 * @param type the type of the resource, as Azure names it.
 */
function isKind(kind: string, type: string): boolean {
  const parts = type.split('/')
  // A resource of the kinds the platform deploys is the resource
  // itself, and not a resource that lives inside it.
  if (parts.length !== 2) return false
  const flat = parts
    .join('')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
  return kind
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== '')
    .every((word) => flat.includes(word))
}

/**
 * The identifiers of the resources of Azure that carry a name.
 *
 * The client of Azure knows every resource of a subscription, and it
 * answers with the identifier of the one that carries a name. The name
 * of a resource is the name of a resource of one kind, and a
 * subscription holds resources of many kinds: the import of the
 * resource of the wrong kind is refused by the provider of the
 * deployment, and the CLI tries the identifiers in the order the
 * client of Azure answered with them.
 *
 * @param binary the path of the client of Azure.
 * @param refused the resource the refusal names.
 * @param subscription the subscription to look in.
 */
async function identifiersOf(
  binary: string,
  refused: Refused,
  subscription: string
): Promise<string[]> {
  const listed = await run(binary, [
    'resource',
    'list',
    '--subscription',
    subscription,
    '--query',
    `[?name=='${refused.name}']`,
    '--output',
    'json',
  ])
  if (listed.status !== 0) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(listed.stdout)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const ofKind: string[] = []
  const ofOther: string[] = []
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const id = record.id
    const type = record.type
    if (typeof id !== 'string' || id === '') continue
    if (typeof type === 'string' && isKind(refused.kind, type)) ofKind.push(id)
    else ofOther.push(id)
  }
  // The resource of the kind of the refusal comes first: the import of
  // the resource of another kind is refused by the provider, and the
  // CLI tries the identifiers in the order it has them.
  return [...ofKind, ...ofOther]
}

/**
 * The resources of the cloud that a failed apply left behind, and that
 * the state of the deployment can take over.
 *
 * The tool refuses to create a resource that is already there, and it
 * names the resource and its identifier:
 *
 *   Error: a resource with the ID "https://…/secrets/…/…" already exists
 *   - to be managed via Terraform this resource needs to be imported into the State.
 *
 *   with azurerm_key_vault_secret.platform["…"],
 *
 * The address is the address the state of the deployment knows the
 * resource by, and the identifier is the identifier the cloud knows it
 * by. The identifier of a secret of a vault holds the version of the
 * secret, and the import of a secret of a vault takes the identifier
 * without the version: both are tried, the one without the version
 * first.
 *
 * @param reason what the tool said about the failure.
 */
export function importablesOf(reason: string): readonly Importable[] {
  const found = new Map<string, Importable>()
  const pattern =
    /a resource with the ID "([^"]+)" already exists[\s\S]*?with ([A-Za-z0-9_.[\]"-]+),/g
  for (const match of reason.matchAll(pattern)) {
    const id = match[1]!
    const address = match[2]!
    if (found.has(address)) continue
    found.set(address, { address, ids: idsOf(id) })
  }
  return [...found.values()]
}

/**
 * The identifiers of a resource, in the order they are to be tried.
 *
 * The identifier of a secret of a vault holds the version of the
 * secret, and the import of a secret of a vault takes the identifier
 * without the version: the identifier without the version is tried
 * first, and the one with it is the second.
 *
 * @param id the identifier the tool named.
 */
function idsOf(id: string): readonly string[] {
  const without = id.replace(/\/[0-9a-fA-F]{32}$/, '')
  return without === id ? [id] : [without, id]
}

/**
 * The role assignment that a refusal names.
 *
 * The provider refuses to create a role assignment that is already
 * there, and it names the identifier of the assignment: the identifier
 * is the name of the assignment in the cloud, and the name of the
 * assignment in the state is the address the refusal carries. The
 * identifier of the assignment in the cloud is found in the directory
 * of the assignments of the subscription.
 *
 * @param binary the path of the client of Azure.
 * @param reason what the tool said about the failure.
 */
async function assignmentOf(
  binary: string,
  reason: string
): Promise<{ address: string; id: string } | undefined> {
  const named = /The ID of the existing role assignment is ([0-9a-fA-F-]{32,36})\./.exec(reason)
  if (named === null) return undefined
  const address = reason.match(/with ([A-Za-z0-9_.[\]"-]+),/)?.[1]
  if (address === undefined) return undefined
  const listed = await run(binary, ['role', 'assignment', 'list', '--all', '--output', 'json'])
  if (listed.status !== 0) {
    throw new CliFailure(
      `the role assignment ${named[1]} is already there, and the client of Azure could not list the assignments of the subscription: ${listed.stderr.trim() || listed.stdout.trim()}`,
      5,
      'already_there'
    )
  }
  let assignments: unknown
  try {
    assignments = JSON.parse(listed.stdout) as unknown
  } catch {
    throw new CliFailure(
      `the role assignment ${named[1]} is already there, and the client of Azure answered with something that is not a list of assignments`,
      5,
      'already_there'
    )
  }
  if (!Array.isArray(assignments)) {
    throw new CliFailure(
      `the role assignment ${named[1]} is already there, and the client of Azure answered with something that is not a list of assignments`,
      5,
      'already_there'
    )
  }
  // The name of an assignment is the identifier of the assignment, and
  // the identifier of the assignment in the cloud carries it with the
  // dashes that the refusal of the provider does not.
  const wanted = named[1]!.replace(/-/g, '').toLowerCase()
  for (const assignment of assignments) {
    if (!assignment || typeof assignment !== 'object') continue
    const record = assignment as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id : ''
    const name = typeof record.name === 'string' ? record.name : ''
    const identifier = (id.split('/').pop() ?? '').replace(/-/g, '').toLowerCase()
    if (identifier !== wanted && name.replace(/-/g, '').toLowerCase() !== wanted) continue
    if (id === '') continue
    return { address, id }
  }
  throw new CliFailure(
    `the role assignment ${named[1]} is already there, and the client of Azure did not find it in the assignments of the subscription: the assignment is in another subscription, or the account of the operator cannot read it`,
    5,
    'already_there'
  )
}

/**
 * The resource of Azure that a failed apply left behind.
 *
 * The client of Azure knows every resource of every subscription the
 * operator holds, and it answers with the identifier of the one that
 * carries a name.
 *
 * The resource that holds the name of the resource the deployment
 * wants is in the group of the deployment and in its subscription: the
 * state of the deployment can take it over. A resource of another
 * group or of another subscription holds the name and cannot be taken
 * over: the name has to be freed, or the deployment has to name its
 * resource differently.
 *
 * @param binary the path of the client of Azure.
 * @param reason what the tool said about the failure.
 */
async function leftoverOf(
  binary: string,
  reason: string,
  region?: string
): Promise<Leftover | undefined> {
  const refused = refusedOf(reason)
  if (refused === undefined) {
    // The provider refuses to create a role assignment that is already
    // there, and it names the identifier of the assignment instead of
    // the identifier of the resource: the assignment is found in the
    // directory of the assignments of the subscription.
    const assignment = await assignmentOf(binary, reason)
    if (assignment === undefined) return undefined
    return { name: assignment.address, ids: [assignment.id] }
  }

  // The resource of the group of the deployment and of its
  // subscription: the state of the deployment can take it over.
  const mine = await identifiersOf(binary, refused, refused.subscription)
  const adoptable = mine.filter((id) => groupOf(id) === refused.group)
  if (adoptable.length > 0) {
    return { name: refused.name, ids: adoptable }
  }

  // The name is held by a resource of another group or of another
  // subscription: the CLI says where it is, and it proposes a name
  // that is free.
  const elsewhere = mine.length > 0 ? mine : await heldElsewhere(binary, refused)
  if (elsewhere.length > 0) {
    return {
      name: refused.name,
      ids: [],
      place: placeOf(elsewhere),
      values: proposedOf(refused),
    }
  }

  // The name is held by a resource that was deleted and not purged:
  // the client of Azure cannot see it, and the directory of the
  // deleted resources of Azure can.
  const deleted = await deletedOf(binary, refused, region)
  if (deleted.location !== undefined) {
    return { name: refused.name, ids: [], location: deleted.location }
  }

  // The CLI looked and did not find it: it says where it looked, so
  // that the operator knows what is left to do, and it proposes a name
  // that is free.
  return {
    name: refused.name,
    ids: [],
    searched: searchedOf(refused, region, deleted.refusal),
    values: proposedOf(refused),
  }
}

/**
 * The names of the resources of Azure that are unique in Azure, and
 * the value that names them.
 *
 * The name of a vault is unique in the whole of Azure, and the operator
 * names it when the default name is taken: a deployment that cannot
 * take the name of the resource it wants names it differently.
 */
const NAMED: { readonly kind: string; readonly value: string; readonly length: number }[] = [
  { kind: 'Key Vault', value: 'key_vault_name', length: 24 },
]

/**
 * The value that names the resource of the deployment differently.
 *
 * The name the deployment wanted is held by something the deployment
 * cannot take over: the resource of the deployment is named after it,
 * with a number that is not taken yet.
 *
 * @param refused the resource the refusal names.
 */
function proposedOf(refused: Refused): Readonly<Record<string, string>> | undefined {
  const named = NAMED.find((one) => kindOf(one.kind) === kindOf(refused.kind))
  if (named === undefined) return undefined
  const value = freeOf(refused.name, named.length)
  if (value === undefined) return undefined
  return { [named.value]: value }
}

/**
 * The kind of a resource, as the words of it.
 *
 * @param kind the kind of the resource.
 */
function kindOf(kind: string): string {
  return kind.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * A name that is free, next to a name that is not.
 *
 * The name of a resource of Azure that is unique in Azure is short, and
 * the name that is free is the name that is taken with a number: the
 * number is the smallest one that keeps the name a name Azure takes.
 *
 * @param name the name that is held.
 * @param length the longest name Azure takes.
 */
function freeOf(name: string, length: number): string | undefined {
  for (let number = 2; number < 100; number += 1) {
    const suffix = String(number)
    const grown = `${name}${suffix}`
    const candidate =
      grown.length <= length ? grown : `${name.slice(0, length - suffix.length)}${suffix}`
    if (/^[a-zA-Z][a-zA-Z0-9-]{2,63}$/.test(candidate) && candidate.length <= length) {
      return candidate
    }
  }
  return undefined
}

/**
 * What the client of Azure was asked for, and did not find.
 *
 * The name of a resource is held by something the CLI cannot see, and
 * the operator has to know what was looked for: the message names the
 * places and the command that frees the name.
 *
 * @param refused the resource the refusal names.
 * @param region the region the deployment runs in.
 * @param refusal what the cloud said when it refused the question.
 */
function searchedOf(refused: Refused, region: string | undefined, refusal?: string): string {
  if (refusal !== undefined) {
    return `the client of Azure refused the question: ${refusal}`
  }
  const where = region === undefined ? 'the region of the deployment' : `the region ${region}`
  return (
    `the resource was not alive in the subscription ${refused.subscription}, ` +
    `and it was not among the resources that were deleted in ${where}, nor in the other regions of Azure: ` +
    `free the name with 'az keyvault purge --name ${refused.name} --location ${region ?? '<the region of the vault>'}', ` +
    `or name the vault of the deployment differently`
  )
}

/**
 * The region a resource of Azure that was deleted and not purged is in.
 *
 * A resource that was deleted and not purged keeps the name it had,
 * and the name cannot be used again: the resource has to be purged
 * before the name is free. The client of Azure does not list the
 * resources that were deleted, and the directory of Azure does: it
 * lists them region by region, and the region the deployment runs in
 * is asked first, for it is the region the resource was made in.
 *
 * @param binary the path of the client of Azure.
 * @param refused the resource the refusal names.
 * @param region the region the deployment runs in.
 */
async function deletedOf(
  binary: string,
  refused: Refused,
  region?: string
): Promise<{ location?: string; refusal?: string }> {
  // Only a vault is emptied into a bin that is kept, and only the name
  // of a vault is held by the bin: the other kinds of resources are
  // looked for among the resources that are alive.
  if (!isKind(refused.kind, 'Microsoft.KeyVault/vaults')) return {}
  const subscriptions = await subscriptionsOf(binary)
  const others = subscriptions.filter((one) => one.id !== refused.subscription)
  const regions = await regionsOf(binary)

  // The region of the deployment, in the subscription of the
  // deployment and in the subscriptions of the operator: the resource
  // was made by a deployment of the platform, and the name of a vault
  // is unique in the whole of Azure.
  const first = region === undefined ? [] : [region]
  const refusals: string[] = []
  for (const subscription of [refused.subscription, ...others.map((one) => one.id)]) {
    const found = await deletedIn(binary, refused, subscription, first)
    if (found.location !== undefined) return found
    refusals.push(...found.refusals)
  }

  // The other regions of every subscription the operator holds: the
  // resource was made there by a deployment of another region.
  const rest = regions.filter((one) => one !== region)
  for (const subscription of [refused.subscription, ...others.map((one) => one.id)]) {
    const found = await deletedIn(binary, refused, subscription, rest)
    if (found.location !== undefined) return found
    refusals.push(...found.refusals)
  }

  // The cloud refused every question: the CLI says so, and does not
  // say that the resource is not there.
  if (refusals.length > 0) {
    return { refusal: refusals[0] }
  }
  return {}
}

/**
 * The region a deleted resource of Azure of a name is in.
 *
 * The directory of the deleted resources of Azure is asked region by
 * region, and the regions are asked together: the wait is the time of
 * the client of Azure and not the time of the CLI.
 *
 * @param binary the path of the client of Azure.
 * @param refused the resource the refusal names.
 * @param subscription the subscription to look in.
 * @param regions the regions to look in.
 */
async function deletedIn(
  binary: string,
  refused: Refused,
  subscription: string,
  regions: readonly string[]
): Promise<{ location?: string; refusals: string[] }> {
  // The regions are asked a few at a time: the client of Azure is a
  // program of its own, and a machine does not run sixty of them at
  // once well.
  const batch = 8
  const refusals: string[] = []
  for (let from = 0; from < regions.length; from += batch) {
    const slice = regions.slice(from, from + batch)
    const answers = await Promise.all(
      slice.map(async (region) => {
        const url =
          `https://management.azure.com/subscriptions/${subscription}` +
          `/providers/Microsoft.KeyVault/locations/${region}/deletedVaults` +
          '?api-version=2023-07-01'
        const answer = await run(binary, ['rest', '--method', 'get', '--url', url])
        return { region, answer }
      })
    )
    for (const { region, answer } of answers) {
      if (answer.status !== 0) {
        refusals.push((answer.stderr || answer.stdout).trim())
        continue
      }
      const parsed = jsonOf(answer.stdout)
      if (parsed === undefined) {
        refusals.push(
          `the answer of the client of Azure is not the json it writes: ${answer.stdout.trim()}`
        )
        continue
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
      const value = (parsed as Record<string, unknown>).value
      if (!Array.isArray(value)) continue
      for (const entry of value) {
        if (!entry || typeof entry !== 'object') continue
        const record = entry as Record<string, unknown>
        const properties = record.properties
        const named =
          typeof record.name === 'string'
            ? record.name
            : properties && typeof properties === 'object'
              ? ((properties as Record<string, unknown>).vaultName as string | undefined)
              : undefined
        if (named === refused.name) return { location: region, refusals }
      }
    }
  }
  return { refusals }
}

/**
 * The json a program wrote, among everything it wrote.
 *
 * The client of Azure writes what it has to say, and it may write
 * something else first: the json is the part of the answer that is
 * json, and not the whole of it.
 *
 * @param stdout what the program wrote.
 */
function jsonOf(stdout: string): unknown {
  const from = stdout.indexOf('{')
  const to = stdout.lastIndexOf('}')
  if (from < 0 || to <= from) return undefined
  try {
    return JSON.parse(stdout.slice(from, to + 1))
  } catch {
    return undefined
  }
}

/**
 * The regions of Azure that the operator may deploy in.
 *
 * @param binary the path of the client of Azure.
 */
async function regionsOf(binary: string): Promise<string[]> {
  const answer = await run(binary, [
    'account',
    'list-locations',
    '--query',
    '[].name',
    '--output',
    'tsv',
  ])
  if (answer.status !== 0) return []
  return answer.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

/**
 * Frees the name of a resource of Azure that was deleted and not
 * purged.
 *
 * The resource is purged, and what is left of it is lost: the CLI asks
 * the operator before it does it.
 *
 * @param binary the path of the client of Azure.
 * @param leftover the resource that holds the name.
 */
async function releaseOf(binary: string, leftover: Leftover): Promise<void> {
  const location = leftover.location
  if (location === undefined || location === '') {
    throw new CliFailure(
      `the region of ${leftover.name} is not known: the name cannot be freed`,
      5,
      'already_there'
    )
  }
  const answer = await run(binary, [
    'keyvault',
    'purge',
    '--name',
    leftover.name,
    '--location',
    location,
  ])
  if (answer.status !== 0) {
    throw new CliFailure(
      `${leftover.name} was not purged: ${(answer.stderr || answer.stdout).trim()}`,
      5,
      'already_there'
    )
  }
}

/**
 * The group of the resources a resource of Azure lives in.
 *
 * The identifier of a resource of Azure names the group of the
 * resources it belongs to, and the client of Azure names it in a
 * field of its own that came later. The identifier is the truth.
 *
 * @param id the identifier of the resource.
 */
function groupOf(id: string): string {
  return id.match(/\/resourceGroups\/([^/]+)\//)?.[1] ?? ''
}

/**
 * The place where a resource of Azure that holds a name lives.
 *
 * The identifier of a resource of Azure names the subscription and the
 * group of the resources it belongs to.
 *
 * @param ids the identifiers of the resources.
 */
function placeOf(ids: readonly string[]): string {
  const first = ids[0]
  if (first === undefined) return ''
  const subscription = first.match(/\/subscriptions\/([^/]+)\//)?.[1] ?? ''
  const group = groupOf(first)
  if (subscription === '' || group === '') return ''
  return `the group ${group} of the subscription ${subscription}`
}

/**
 * The resources of the other subscriptions that hold a name.
 *
 * The name of a vault of Azure is unique in the whole of Azure, and
 * the resource that holds it may live in a subscription the operator
 * holds and the deployment does not.
 *
 * @param binary the path of the client of Azure.
 * @param refused the resource the refusal names.
 */
async function heldElsewhere(binary: string, refused: Refused): Promise<string[]> {
  const held: string[] = []
  for (const subscription of await subscriptionsOf(binary)) {
    if (subscription.id === refused.subscription) continue
    held.push(...(await identifiersOf(binary, refused, subscription.id)))
  }
  return held
}

/**
 * Signs the operator in to Azure.
 *
 * The sign in is the one of the client of Azure: the wizard runs it when
 * the operator holds no session, and it lets the reader choose the
 * subscription of the deployment when there is more than one.
 *
 * The subscription the answers of the operator name is the one of the
 * deployment, and the reader is not asked: a deployment that runs
 * where nobody can answer — under the interface of the operator, in a
 * pipeline — names its subscription in the file of the answers.
 *
 * @param ask asks the operator a question and waits for the answer.
 * @param environment the environment of the process.
 * @param answers the answers the operator gave before the sign in.
 */
async function signInOf(
  ask: Asker,
  environment: Readonly<Record<string, string | undefined>>,
  answers: Readonly<Values> = {}
): Promise<SignIn> {
  const binary = azureCli(environment)

  let current = await run(binary, ['account', 'show', '--output', 'json'])
  if (current.status !== 0) {
    // The operator holds no session: the client of Azure opens a
    // browser, and the reader finishes the sign in there.
    const login = await run(binary, ['login'], { inherit: true })
    if (login.status !== 0) {
      throw new CliFailure(
        'the sign in to Azure was refused: run "az login" and try again',
        7,
        'unreachable'
      )
    }
    current = await run(binary, ['account', 'show', '--output', 'json'])
    if (current.status !== 0) {
      throw new CliFailure(
        'the sign in to Azure did not leave a session: run "az login" and try again',
        7,
        'unreachable'
      )
    }
  }

  const subscriptions = await subscriptionsOf(binary)
  if (subscriptions.length === 0) {
    throw new CliFailure(
      'the operator holds no subscription of Azure: a deployment needs one',
      4,
      'not_found'
    )
  }

  let chosen = subscriptions[0]!
  const named = answers[ACCOUNT]?.trim() ?? ''
  if (named !== '') {
    const found = subscriptions.find((subscription) => subscription.id === named)
    if (found === undefined) {
      throw new CliFailure(
        `the subscription ${named} of the answers is not one the operator holds: the operator holds ${subscriptions.map((one) => `${one.name} (${one.id})`).join(', ')}`,
        4,
        'not_found'
      )
    }
    chosen = found
  } else if (subscriptions.length > 1) {
    let answer: string
    try {
      answer = await ask(
        'the subscription of the deployment',
        subscriptions.map((subscription) => subscription.name)
      )
    } catch (error) {
      if (!(error instanceof CliFailure) || error.code !== 'not_answered') throw error
      // Nobody can answer, and the deployment is not written in a
      // subscription nobody chose: the refusal says how it is named.
      throw new CliFailure(
        `the operator holds ${subscriptions.length} subscriptions and nobody can say which one the deployment is written in: name it in the file of the answers, as ${ACCOUNT} = "<the identifier>": ${subscriptions.map((one) => `${one.name} (${one.id})`).join(', ')}`,
        2,
        'not_answered'
      )
    }
    chosen = subscriptions.find((subscription) => subscription.name === answer) ?? chosen
  }

  const selected = await run(binary, ['account', 'set', '--subscription', chosen.id])
  if (selected.status !== 0) {
    throw new CliFailure(
      `the subscription ${chosen.name} cannot be chosen: ${selected.stderr.trim()}`,
      7,
      'unreachable'
    )
  }

  const facts: Record<string, string> = {
    tenant_id: chosen.tenantId ?? '',
    subscription_id: chosen.id,
  }
  // The identity of the operator reads and writes the state of the
  // deployment: the bootstrap needs its identifier to give it the
  // permission that does so.
  const principalId = await principalOf(binary)
  if (principalId !== '') facts.operator_principal_id = principalId
  return {
    facts,
    message: `signed in to Azure as ${chosen.name}`,
    account: chosen.name,
  }
}

/**
 * The facts of the deployment, as the machine of the operator holds them.
 *
 * A dry run signs nobody in: it reads the facts the session of the
 * client of Azure already holds, and a machine that holds no session
 * holds no facts. The client of Azure is not asked to sign in, and no
 * browser opens.
 *
 * @param binary the path of the client of Azure.
 */
async function factsOf(binary: string): Promise<Record<string, string>> {
  const current = await run(binary, ['account', 'show', '--output', 'json'])
  if (current.status !== 0) return {}
  const facts: Record<string, string> = {}
  let parsed: unknown
  try {
    parsed = JSON.parse(current.stdout)
  } catch {
    return facts
  }
  if (!parsed || typeof parsed !== 'object') return facts
  const record = parsed as Record<string, unknown>
  if (typeof record.id === 'string' && record.id !== '') facts.subscription_id = record.id
  if (typeof record.tenantId === 'string' && record.tenantId !== '') {
    facts.tenant_id = record.tenantId
  }
  const user = record.user
  if (user && typeof user === 'object') {
    const account = user as Record<string, unknown>
    if (typeof account.id === 'string' && account.id !== '') {
      facts.operator_principal_id = account.id
    }
  }
  return facts
}

/**
 * Reads a name of the answers of the templates.
 *
 * The answers of the templates hold the names of the resources of the
 * deployment, and the provider reads them there: a name that is
 * written in the templates and in the code of the provider is a name
 * that drifts.
 *
 * @param outputs the answers of the templates.
 * @param path the way to the name in the answers.
 */
function answerOf(outputs: Readonly<Record<string, unknown>>, path: readonly string[]): string {
  let value: unknown = outputs
  for (const name of path) {
    if (typeof value !== 'object' || value === null) return ''
    value = (value as Record<string, unknown>)[name]
  }
  return typeof value === 'string' ? value : ''
}

/**
 * Reads a setting of the deployment.
 *
 * The setting is read in the answers of the templates first: the
 * answers are the values the deployment runs with, and they are the
 * truth of the deployment. The values of the wizard are the fallback:
 * a deployment whose templates are older answers nothing, and the
 * values of the wizard are the values it holds.
 *
 * @param context what the deployment applied.
 * @param name the name of the setting.
 */
function settingOf(context: AfterApply, name: string): string {
  const answered = context.outputs[name]
  if (typeof answered === 'string') return answered
  if (typeof answered === 'boolean') return answered ? 'true' : 'false'
  return context.values[name] ?? ''
}

/**
 * Whether the tenant of the deployment provisions the identities that
 * sign in.
 *
 * The deployment answers the value: the tenant of the deployment
 * provisions the identities that sign in, and the operator of the
 * deployment says so in the values of the deployment. A deployment whose
 * templates do not answer keeps the flag of the tenant that is already
 * there, and a tenant that is not there yet provisions its identities.
 *
 * @param context what the deployment applied.
 * @param existing the tenant that is already there.
 */
function provisioningOf(context: AfterApply, existing: TenantOfAccess | undefined): boolean {
  const answered = settingOf(context, 'tenant_auto_provision')
  if (answered === '') return existing?.autoProvision ?? true
  return answered === 'true'
}

/**
 * Whether the first identity that signs in administers the tenant of the
 * deployment.
 *
 * The deployment answers the value: the first principal of the tenant is
 * given the administration of the tenant, and the operator of the
 * deployment says so in the values of the deployment. A deployment whose
 * templates do not answer keeps the flag of the tenant that is already
 * there, and a tenant that is not there yet administers nothing.
 *
 * @param context what the deployment applied.
 * @param existing the tenant that is already there.
 */
function administrationOf(context: AfterApply, existing: TenantOfAccess | undefined): boolean {
  const answered = settingOf(context, 'tenant_auto_provision_admin')
  if (answered === '') return existing?.autoProvisionAdmin ?? false
  return answered === 'true'
}

/**
 * Reads the names of the answers of the templates.
 *
 * @param outputs the answers of the templates.
 * @param name the name of the answer that holds the names.
 */
function namesOf(outputs: Readonly<Record<string, unknown>>, name: string): string[] {
  const value = outputs[name]
  if (typeof value !== 'object' || value === null) return []
  return Object.values(value as Record<string, unknown>).filter(
    (entry): entry is string => typeof entry === 'string' && entry !== ''
  )
}

/**
 * Binds the certificate of every public name of the deployment.
 *
 * The templates of the deployment write the public names of the
 * deployment as custom domains of the application of the gateway, and
 * they write them without a certificate: the provider of the
 * infrastructure of Azure has no resource that binds the certificate of
 * the environment of the container apps to a custom domain, and a
 * custom domain without a certificate is a name that answers in plain
 * HTTP only.
 *
 * The client of Azure writes the binding: it asks the environment of
 * the container apps for the certificate of the name, the environment
 * issues the certificate and renews it, and the ingress of the
 * environment terminates the TLS of the callers with it.
 *
 * The binding waits for the records of DNS of the name: the
 * environment proves the ownership of a name with them, and a name
 * whose records are not in place yet is a name the environment cannot
 * prove. The step says what it did and what it could not do, and the
 * deployment is applied either way: the certificate is issued in the
 * background, and the binding is written again the next time the
 * deployment goes on.
 *
 * @param binary the path of the client of Azure.
 * @param context what the deployment applied.
 */
async function certificatesOf(binary: string, context: AfterApply): Promise<string[]> {
  const notes: string[] = []
  if (settingOf(context, 'public_names_enabled') !== 'true') return notes

  const application = answerOf(context.outputs, ['container_apps', 'gateway'])
  const environment = answerOf(context.outputs, ['container_app_environment'])
  const group = answerOf(context.outputs, ['resource_group_name'])
  const names = namesOf(context.outputs, 'public_names')
  if (application === '' || environment === '' || group === '' || names.length === 0) {
    return [
      'the certificate of the public names is not bound: the templates did not answer the names of the deployment',
    ]
  }

  for (const hostname of names) {
    const answer = await run(binary, [
      'containerapp',
      'hostname',
      'bind',
      '--hostname',
      hostname,
      '--name',
      application,
      '--resource-group',
      group,
      '--environment',
      environment,
      '--validation-method',
      'HTTP',
    ])
    if (answer.status === 0) {
      notes.push(`the certificate of the name ${hostname} is bound to the gateway`)
      continue
    }
    const reason = answer.stderr.trim() || answer.stdout.trim() || 'the client of Azure refused'
    notes.push(
      `the certificate of the name ${hostname} is not bound to the gateway: ${reason}: the binding is written again the next time the deployment goes on`
    )
  }
  return notes
}

/**
 * Starts the job of the migration of the schema.
 *
 * The templates of the deployment write the job of the migration, and
 * the job waits for the hand of the operator: it creates the roles of
 * the deployment, and the services that read the database of the
 * deployment do not start without them. A deployment that is applied
 * and whose job waits is a deployment whose Access answers that the
 * password of its role is refused.
 *
 * The wizard starts the job when the deployment is applied, and the job
 * runs again at every apply: the job creates the roles that are
 * missing and writes the passwords of the roles that are there, and
 * the migrations it applies are the migrations that are missing.
 *
 * The job is started by the client of Azure, and a client that refuses
 * is told what it refused: the deployment is applied either way, and
 * the operator starts the job by hand.
 *
 * @param binary the path of the client of Azure.
 * @param context what the deployment applied.
 */
async function migrationOf(binary: string, context: AfterApply): Promise<string[]> {
  const job = answerOf(context.outputs, ['migration_job'])
  const group = answerOf(context.outputs, ['resource_group_name'])
  if (job === '' || group === '') {
    return [
      'the migration of the schema is not started: the templates did not answer the job of the migration',
    ]
  }

  const answer = await run(binary, [
    'containerapp',
    'job',
    'start',
    '--name',
    job,
    '--resource-group',
    group,
  ])
  if (answer.status === 0) {
    return [
      `the migration of the schema is started: the job ${job} creates the roles of the deployment and applies the migrations of the schema`,
    ]
  }
  const reason = answer.stderr.trim() || answer.stdout.trim() || 'the client of Azure refused'
  return [
    `the migration of the schema is not started: ${reason}: the job ${job} is started by hand, and the services that read the database of the deployment do not start without their roles`,
  ]
}

/**
 * A tenant of Access, as the administration API answers with it.
 *
 * The registration of a tenant is an upsert by its slug, and the
 * wizard writes the tenant of the deployment again with the
 * application of Entra ID as its provider. The flags of the tenant are
 * kept: the auto-provisioning of the principals, the shared client and
 * the default of the platform are the work of the operator of the
 * platform, and a registration that does not carry them resets them.
 *
 * The issuer of the tenant is read as well: a tenant that has a
 * provider of its own keeps it, and the deployment takes no provider
 * back.
 */
interface TenantOfAccess {
  readonly id: string
  readonly slug: string
  readonly displayName: string
  /** The issuer of the provider of the tenant. */
  readonly issuer: string
  readonly emailDomain: string | null
  readonly autoProvision: boolean
  readonly autoProvisionAdmin: boolean
  readonly sharedClient: boolean
  readonly default: boolean
  readonly enabled: boolean
}

/**
 * Reads a tenant of Access out of the answer of the administration API.
 *
 * The tenant of the deployment is the one its identifier names, and it
 * is the one its slug names as well: the identifier is written in the
 * values of the deployment the first time the tenant is created, and
 * a deployment whose identifier is stale finds its tenant by its slug.
 *
 * @param answer the answer of the administration API.
 * @param id the identifier of the tenant of the deployment.
 * @param slug the slug of the tenant of the deployment.
 */
function tenantOf(answer: unknown, id: string, slug: string): TenantOfAccess | undefined {
  if (!answer || typeof answer !== 'object') return undefined
  const tenants = (answer as { tenants?: unknown }).tenants
  if (!Array.isArray(tenants)) return undefined
  const rows: TenantOfAccess[] = []
  for (const entry of tenants) {
    if (!entry || typeof entry !== 'object') continue
    const tenant = entry as Record<string, unknown>
    rows.push({
      id: typeof tenant.id === 'string' ? tenant.id : '',
      slug: typeof tenant.slug === 'string' ? tenant.slug : '',
      displayName: typeof tenant.displayName === 'string' ? tenant.displayName : '',
      issuer: typeof tenant.issuer === 'string' ? tenant.issuer : '',
      emailDomain: typeof tenant.emailDomain === 'string' ? tenant.emailDomain : null,
      autoProvision: tenant.autoProvision === true,
      autoProvisionAdmin: tenant.autoProvisionAdmin === true,
      sharedClient: tenant.sharedClient === true,
      default: tenant.default === true,
      enabled: tenant.enabled !== false,
    })
  }
  return rows.find((tenant) => tenant.id === id) ?? rows.find((tenant) => tenant.slug === slug)
}

/**
 * The waits of the wizard for the administration of Access.
 *
 * Access is a service of the deployment, and it cannot answer before
 * the job of the migration has run: the job creates the roles of the
 * deployment, and Access reads the database with a role of its own. The
 * wizard waits for Access, and a wait that ends without an answer is a
 * note and not a failure.
 */
export interface Waits {
  /** The number of times the wizard asks Access for its tenants. */
  readonly attempts: number
  /** The time between two of them, in milliseconds. */
  readonly intervalMs: number
  /** The time one call to Access may take, in milliseconds. */
  readonly callMs: number
}

/** The waits of the wizard, when it is not told otherwise. */
const WAITS: Waits = { attempts: 30, intervalMs: 10_000, callMs: 5_000 }

/**
 * Asks Access for the tenants of the platform.
 *
 * @param access the address of Access.
 * @param admin the token of the administration of Access.
 */
async function tenantsOf(
  access: string,
  admin: string,
  callMs: number
): Promise<{ status: number; answer: unknown }> {
  try {
    const answer = await fetch(`${access}/v1/admin/tenants`, {
      headers: { authorization: `Bearer ${admin}`, accept: 'application/json' },
      signal: AbortSignal.timeout(callMs),
    })
    if (answer.status !== 200) return { status: answer.status, answer: undefined }
    return { status: answer.status, answer: await answer.json() }
  } catch {
    return { status: 0, answer: undefined }
  }
}

/**
 * Waits for the administration of Access to answer.
 *
 * Access is a service of the deployment that has to be up before the
 * tenant of the deployment can be registered: the job of the migration
 * creates the roles of the deployment, and Access reads the database
 * with a role of its own. A deployment whose Access answers is a
 * deployment whose tenant is registered; a deployment whose Access
 * never answers is a deployment whose tenant is registered by hand.
 *
 * @param access the address of Access.
 * @param admin the token of the administration of Access.
 */
async function waitForAccess(
  access: string,
  admin: string,
  waits: Waits
): Promise<{ answer: unknown; waited: number }> {
  for (let attempt = 0; attempt < waits.attempts; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, waits.intervalMs))
    const { status, answer } = await tenantsOf(access, admin, waits.callMs)
    if (status === 200) return { answer, waited: attempt }
  }
  return { answer: undefined, waited: waits.attempts }
}

/**
 * Writes the identifier of the tenant of the deployment in the file of
 * the values.
 *
 * The tenant of the deployment is created by the administration of
 * Access, and the values of the deployment name it: the access context
 * of the deployment is scoped to it, and a scope that names no tenant
 * asks about nothing. The identifier is written in the file of the
 * values, and the deployment goes on with it.
 *
 * @param file the file of the values of the deployment.
 * @param id the identifier of the tenant.
 */
async function writeTenantId(file: string, id: string): Promise<boolean> {
  let content: string
  try {
    content = await readFile(file, 'utf8')
  } catch {
    return false
  }
  const line = `access_tenant_id = "${id}"`
  if (/^access_tenant_id\s*=/m.test(content)) {
    const written = content.replace(/^access_tenant_id\s*=.*$/m, line)
    if (written === content) return false
    await writeFile(file, written)
    return true
  }
  await writeFile(file, `${content.trimEnd()}\n${line}\n`)
  return true
}

/**
 * Reads the tenant that the administration of Access answered with.
 *
 * The answer of an upsert is the tenant itself: its identifier and
 * its slug are the two things the wizard needs.
 *
 * @param answer the answer of the administration API.
 */
function registeredOf(answer: unknown): { id: string; slug: string } | undefined {
  if (!answer || typeof answer !== 'object') return undefined
  const tenant = answer as Record<string, unknown>
  const id = tenant.id
  const slug = tenant.slug
  if (typeof id !== 'string' || id === '') return undefined
  return { id, slug: typeof slug === 'string' ? slug : '' }
}

/**
 * Registers the tenant of the deployment with the application of Entra
 * ID as its provider.
 *
 * The templates of the deployment create the application of Access at
 * Entra ID and its secret, and they cannot register the tenant: the
 * registration is a call to the administration API of Access, and
 * Access is a service of the deployment that has to be up.
 *
 * The tenant of the deployment is the one the values name, and the
 * wizard reads it among the tenants of Access: the registration is an
 * upsert by the slug of the tenant, and the slug is the name the
 * tenant is known by. A deployment whose tenant is not there yet gets
 * one: the tenant of a deployment is the work of the deployment, and
 * the platform creates the tenants through the administration API of
 * Access.
 *
 * The provider of the deployment belongs to the tenant the deployment
 * creates, and to no other: a tenant that has a provider of its own
 * keeps it, and the registration of such a tenant names no provider
 * at all. A tenant names the provider its people sign in at, and the
 * deployment takes no provider back.
 *
 * The flags of the tenant are kept: the auto-provisioning of the
 * principals, the shared client and the default of the platform are
 * the work of the operator of the platform, and a registration that
 * does not carry them resets them.
 *
 * The step is not a failure of the deployment when it does not go
 * through: the deployment is applied, and the registration is written
 * again the next time the deployment goes on.
 *
 * @param context what the deployment applied.
 */
async function tenantWithEntra(context: AfterApply, waits: Waits): Promise<string[]> {
  // A deployment whose tenant has another provider creates no
  // application, and the registration is the work of the operator.
  if (settingOf(context, 'entra_tenant_enabled') === 'false') return []

  const access = answerOf(context.outputs, ['access_issuer'])
  const admin = answerOf(context.outputs, ['access_admin_token'])
  const entraIssuer = answerOf(context.outputs, ['entra_issuer'])
  const entraClient = answerOf(context.outputs, ['entra_client_id'])
  const entraSecret = answerOf(context.outputs, ['entra_client_secret'])
  const entraCallback = answerOf(context.outputs, ['entra_redirect_uri'])
  const clientId = answerOf(context.outputs, ['client_id'])
  const clientSecret = answerOf(context.outputs, ['client_secret'])
  const callbacks = namesOf(context.outputs, 'client_redirect_uris')
  if (
    access === '' ||
    admin === '' ||
    entraIssuer === '' ||
    entraClient === '' ||
    entraSecret === '' ||
    entraCallback === ''
  ) {
    return [
      'the tenant of the deployment is not registered with Entra ID: the templates did not answer the application of Access at Entra ID',
    ]
  }

  // The tenant of the deployment is created with the slug of the
  // workspace of the deployment: the deployment holds one tenant and
  // one workspace, and they belong to the same customer.
  const slug = settingOf(context, 'data_workspace_slug')
  if (slug === '') {
    return [
      'the tenant of the deployment is not registered with Entra ID: the deployment names no workspace: the slug of the workspace of Data is a value of the deployment, and the wizard reads it in the answers of the templates',
    ]
  }

  // Access is a service of the deployment, and it cannot answer before
  // the job of the migration has created the roles of the deployment.
  const { answer, waited } = await waitForAccess(access, admin, waits)
  if (answer === undefined) {
    return [
      'the tenant of the deployment is not registered with Entra ID: the administration of Access did not answer, and the tenant is registered by hand',
    ]
  }

  const id = settingOf(context, 'access_tenant_id')
  const existing = tenantOf(answer, id, slug)
  // The provider of the identity of the tenant of the deployment is
  // the one the deployment creates: Entra ID, and the application of
  // Access at it. A tenant that has a provider of its own keeps it: a
  // tenant names the provider its people sign in at, and the
  // deployment takes no provider back. The registration of such a
  // tenant names no provider at all, and Access keeps the one the
  // tenant has.
  const keepsProvider =
    existing !== undefined && existing.issuer !== '' && existing.issuer !== entraIssuer
  const body = {
    slug: existing?.slug ?? slug,
    displayName: existing?.displayName ?? slug,
    ...(keepsProvider
      ? {}
      : {
          issuer: entraIssuer,
          idpClientId: entraClient,
          idpClientSecret: entraSecret,
          idpRedirectUri: entraCallback,
          // The scopes of the provider of the tenant: the three that
          // every provider knows. The groups of a caller are read in
          // the grants of Access, and not in the directory of the
          // provider.
          idpScopes: ['openid', 'profile', 'email'],
          idpAlgorithms: ['RS256'],
        }),
    emailDomain: existing?.emailDomain ?? null,
    clientId,
    clientSecret,
    clientRedirectUris: callbacks,
    // The tenant of the deployment provisions the identities that sign
    // in for the first time: the operator of the deployment is the
    // first one to sign in, and the principal it needs is created at
    // that login. The value is the one of the deployment, and the
    // deployment holds it.
    autoProvision: provisioningOf(context, existing),
    // The first identity that signs in may administer the tenant: the
    // flag is a value of the deployment, and it is off by default.
    autoProvisionAdmin: administrationOf(context, existing),
    sharedClient: existing?.sharedClient ?? false,
    default: existing?.default ?? false,
    enabled: existing?.enabled ?? true,
  }
  let registered: { id: string; slug: string } | undefined
  try {
    const answer = await fetch(`${access}/v1/admin/tenants`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${admin}`,
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(waits.callMs),
    })
    if (answer.status !== 200 && answer.status !== 201) {
      return [
        `the tenant of the deployment is not registered with Entra ID: the administration of Access answered ${answer.status}: the registration is repeated the next time the deployment goes on`,
      ]
    }
    registered = registeredOf(await answer.json())
  } catch (error) {
    return [
      `the tenant of the deployment is not registered with Entra ID: ${error instanceof Error ? error.message : String(error)}`,
    ]
  }
  if (registered === undefined) {
    return [
      'the tenant of the deployment is not registered with Entra ID: the administration of Access answered with no tenant',
    ]
  }

  const notes: string[] = []
  if (waited > 0) {
    notes.push(
      `the administration of Access answered after ${Math.round((waited * waits.intervalMs) / 1000)} seconds: the job of the migration created the roles of the deployment, and Access came up`
    )
  }
  notes.push(
    keepsProvider
      ? `the tenant ${body.slug} of the deployment keeps the provider of its identity it has: ${existing?.issuer ?? ''}: the provider of the deployment belongs to the tenant the deployment creates, and the deployment takes no provider back`
      : `the tenant ${body.slug} of the deployment is registered with the application of Access at Entra ID as its provider: the callers of the tenant sign in at Entra ID`
  )

  // The identifier of the tenant is the scope of the access context of
  // the deployment, and the values of the deployment name it.
  if (registered.id !== id && context.file !== undefined) {
    const written = await writeTenantId(context.file, registered.id)
    if (written) {
      notes.push(
        `the identifier of the tenant ${registered.id} is written in the file of the values: the deployment goes on again, and the access context of the tenant is scoped to it`
      )
    }
  }
  return notes
}

/**
 * The provider of a deployment on Microsoft Azure.
 *
 * @param questions the questions of the deployment.
 */
export function azureProvider(
  questions: readonly Question[] = AZURE_QUESTIONS,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  waits: Waits = WAITS
): DeploymentProvider {
  return {
    name: 'azure',
    summary: 'Microsoft Azure',
    questions,
    signIn: (ask: Asker, answers?: Readonly<Values>) => signInOf(ask, environment, answers),
    accounts: async () => accountsOf(environment),
    facts: async () => factsOf(azureCli(environment)),
    leftoverOf: async (reason: string, region?: string) =>
      leftoverOf(azureCli(environment), reason, region),
    importablesOf: (reason: string) => importablesOf(reason),
    release: async (leftover: Leftover) => releaseOf(azureCli(environment), leftover),
    afterApply: async (context: AfterApply) => {
      const binary = azureCli(environment)
      const notes: string[] = []
      try {
        notes.push(...(await certificatesOf(binary, context)))
      } catch (error) {
        // The deployment is applied, and the client of Azure is not
        // there: the binding is written again the next time the
        // deployment goes on.
        notes.push(
          `the certificate of the public names is not bound: ${error instanceof Error ? error.message : String(error)}`
        )
      }
      try {
        notes.push(...(await migrationOf(binary, context)))
      } catch (error) {
        // The deployment is applied, and the client of Azure is not
        // there: the job is started by hand.
        notes.push(
          `the migration of the schema is not started: ${error instanceof Error ? error.message : String(error)}`
        )
      }
      try {
        notes.push(...(await tenantWithEntra(context, waits)))
      } catch (error) {
        // The deployment is applied, and Access is not there yet: the
        // registration of the tenant is repeated the next time the
        // deployment goes on.
        notes.push(
          `the tenant of the deployment is not registered with Entra ID: ${error instanceof Error ? error.message : String(error)}`
        )
      }
      return notes
    },
  }
}
