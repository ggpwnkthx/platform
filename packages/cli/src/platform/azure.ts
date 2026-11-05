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
import { join } from 'node:path'
import { CliFailure } from '../domains/failure'
import {
  ENVIRONMENTS,
  type Asker,
  type DeploymentProvider,
  type Importable,
  type Leftover,
  type Question,
  type SignIn,
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
    name: 'registry_name',
    summary: 'the name of the registry of the images of the deployment',
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
    name: 'gateway_client_id',
    summary: 'the identifier of the gateway as a client of Access',
    kind: 'given',
  },
  {
    name: 'console_client_id',
    summary: 'the identifier of the console as a client of Access',
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
    summary: 'the slug of the workspace of Data',
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
    })
  }
  return subscriptions
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
  if (refused === undefined) return undefined

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
 * The name of a vault and the name of a registry are unique in the
 * whole of Azure, and the operator names them when the default name is
 * taken: a deployment that cannot take the name of the resource it
 * wants names it differently.
 */
const NAMED: { readonly kind: string; readonly value: string; readonly length: number }[] = [
  { kind: 'Key Vault', value: 'key_vault_name', length: 24 },
  { kind: 'Container Registry', value: 'registry_name', length: 50 },
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
 * @param ask asks the operator a question and waits for the answer.
 */
async function signInOf(
  ask: Asker,
  environment: Readonly<Record<string, string | undefined>>
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
  if (subscriptions.length > 1) {
    const answer = await ask(
      'the subscription of the deployment',
      subscriptions.map((subscription) => subscription.name)
    )
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
 * The provider of a deployment on Microsoft Azure.
 *
 * @param questions the questions of the deployment.
 */
export function azureProvider(
  questions: readonly Question[] = AZURE_QUESTIONS,
  environment: Readonly<Record<string, string | undefined>> = process.env
): DeploymentProvider {
  return {
    name: 'azure',
    summary: 'Microsoft Azure',
    questions,
    signIn: (ask: Asker) => signInOf(ask, environment),
    facts: async () => factsOf(azureCli(environment)),
    leftoverOf: async (reason: string, region?: string) =>
      leftoverOf(azureCli(environment), reason, region),
    importablesOf: (reason: string) => importablesOf(reason),
    release: async (leftover: Leftover) => releaseOf(azureCli(environment), leftover),
  }
}
