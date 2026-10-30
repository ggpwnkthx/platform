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
import type { Asker, DeploymentProvider, Question, SignIn } from '../domains/deployment'
import { run } from './process'

/** The questions of a deployment on Azure. */
export const AZURE_QUESTIONS: readonly Question[] = [
  {
    name: 'name_prefix',
    summary: 'The prefix of the name of every resource of the deployment',
    kind: 'chosen',
  },
  {
    name: 'environment',
    summary: 'The environment of the deployment: development, staging or production',
    kind: 'chosen',
  },
  {
    name: 'location',
    summary: 'The region of Azure the deployment runs in',
    kind: 'chosen',
  },
  {
    name: 'resource_group_name',
    summary: 'The name of the resource group of the deployment',
    kind: 'given',
  },
  {
    name: 'tenant_id',
    summary: 'The tenant of Entra ID that holds the application of Access',
    kind: 'given',
    shape: 'uuid',
  },
  {
    name: 'key_vault_name',
    summary: 'The name of the vault of the deployment',
    kind: 'given',
  },
  {
    name: 'registry_name',
    summary: 'The name of the registry of the images of the deployment',
    kind: 'given',
  },
  {
    name: 'gateway_hostname',
    summary: 'The public name of the gateway, for example api.example.com',
    kind: 'required',
  },
  {
    name: 'access_hostname',
    summary: 'The public name of the issuer of Access, for example access.example.com',
    kind: 'required',
  },
  {
    name: 'console_hostname',
    summary: 'The public name of the console, for example console.example.com',
    kind: 'required',
  },
  {
    name: 'gateway_client_id',
    summary: 'The identifier of the gateway as a client of Access',
    kind: 'given',
  },
  {
    name: 'console_client_id',
    summary: 'The identifier of the console as a client of Access',
    kind: 'given',
  },
  {
    name: 'route_id',
    summary: 'The identifier of the route that forwards to Data',
    kind: 'given',
  },
  {
    name: 'workspace_path_prefix',
    summary: 'The path prefix of the workspace, as the route table names it',
    kind: 'given',
  },
  {
    name: 'access_tenant_id',
    summary: 'The identifier of the tenant of Access',
    kind: 'required',
    shape: 'uuid',
  },
  {
    name: 'data_workspace_id',
    summary: 'The identifier of the workspace of Data',
    kind: 'required',
    shape: 'uuid',
  },
  {
    name: 'data_workspace_slug',
    summary: 'The slug of the workspace of Data',
    kind: 'given',
  },
  {
    name: 'gateway_image',
    summary: 'The image of the gateway, by digest',
    kind: 'required',
    shape: 'digest',
  },
  {
    name: 'access_image',
    summary: 'The image of Access, by digest',
    kind: 'required',
    shape: 'digest',
  },
  {
    name: 'data_image',
    summary: 'The image of Data, by digest',
    kind: 'required',
    shape: 'digest',
  },
  {
    name: 'console_image',
    summary: 'The image of the console, by digest',
    kind: 'required',
    shape: 'digest',
  },
  {
    name: 'postgres_client_image',
    summary: 'The image of the client of PostgreSQL, by digest',
    kind: 'required',
    shape: 'digest',
  },
  {
    name: 'postgresql_version',
    summary: 'The version of PostgreSQL the deployment runs',
    kind: 'given',
  },
  {
    name: 'postgresql_sku_name',
    summary: 'The size of the server of PostgreSQL',
    kind: 'given',
  },
  {
    name: 'postgresql_storage_mb',
    summary: 'The storage of the server of PostgreSQL, in megabytes',
    kind: 'given',
  },
  {
    name: 'postgresql_high_availability',
    summary: 'Whether the server of PostgreSQL is zone redundant',
    kind: 'given',
  },
  {
    name: 'postgresql_backup_retention_days',
    summary: 'The number of days the backups of the deployment are kept',
    kind: 'given',
  },
  {
    name: 'redis_sku_name',
    summary: 'The size of the cache of Redis',
    kind: 'given',
  },
  {
    name: 'redis_capacity',
    summary: 'The number of shards of the cache of Redis',
    kind: 'given',
  },
  {
    name: 'redis_version',
    summary: 'The version of Redis the deployment runs',
    kind: 'given',
  },
  {
    name: 'frontdoor_sku_name',
    summary: 'The size of the profile of Front Door',
    kind: 'given',
  },
  {
    name: 'trusted_proxy_cidrs',
    summary: 'The addresses of the proxies the gateway trusts',
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
  return {
    facts,
    message: `signed in to Azure as ${chosen.name}`,
    account: chosen.name,
  }
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
  }
}
