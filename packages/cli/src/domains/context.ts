/**
 * The context of the commands.
 *
 * A command of the CLI works on a deployment, and a deployment is named
 * by a profile: the addresses of its services, the workspace the data
 * commands work on and the client the CLI signs in with. The profile is
 * read from a file, and the environment of the shell overrides it: the
 * environment wins, because a shell that names a deployment is a shell
 * that means it.
 *
 * The resolution is a pure function of the profiles and of the
 * environment, and it is the function the tests of the CLI prove.
 */

import { CliFailure } from './failure'
import type { Profile, Profiles } from './contracts'

/** The environment of the CLI, as the shell hands it over. */
export type Environment = Readonly<Record<string, string | undefined>>

/**
 * The variables of the environment that name a deployment.
 *
 * The prefix is the name of the CLI, and it is not the prefix of a
 * service: the CLI reads no variable of a service, and a deployment that
 * sets one of them does not configure the CLI with it.
 */
export const ENVIRONMENT_VARIABLES = {
  profile: 'PLATFORMCTL_PROFILE',
  gatewayUrl: 'PLATFORMCTL_GATEWAY_URL',
  controlUrl: 'PLATFORMCTL_CONTROL_URL',
  accessUrl: 'PLATFORMCTL_ACCESS_URL',
  workspaceId: 'PLATFORMCTL_WORKSPACE_ID',
  tenantId: 'PLATFORMCTL_TENANT_ID',
  clientId: 'PLATFORMCTL_CLIENT_ID',
  clientSecret: 'PLATFORMCTL_CLIENT_SECRET',
  redirectUri: 'PLATFORMCTL_REDIRECT_URI',
  controlToken: 'PLATFORMCTL_CONTROL_TOKEN',
  adminToken: 'PLATFORMCTL_ADMIN_TOKEN',
  token: 'PLATFORMCTL_TOKEN',
} as const

/** The context a command works on. */
export interface ResolvedContext {
  /** The name of the profile the context comes from. */
  readonly name: string
  /** The address of the gateway. */
  readonly gatewayUrl?: string
  /** The address of the control plane of the gateway. */
  readonly controlUrl?: string
  /** The address of Access. */
  readonly accessUrl?: string
  /** The workspace the commands of the data work on. */
  readonly workspaceId?: string
  /** The tenant the commands of the access work on. */
  readonly tenantId?: string
  /** The client the CLI signs in with. */
  readonly clientId?: string
  /** The secret of the client. */
  readonly clientSecret?: string
  /** The address the identity provider sends the caller back to. */
  readonly redirectUri?: string
  /** The credential of the control plane. */
  readonly controlToken?: string
  /** The credential of the administration of Access. */
  readonly adminToken?: string
  /** The credential of the caller. */
  readonly token?: string
}

/**
 * The profile of a deployment, resolved.
 *
 * A value of the environment is a value of the profile: the file holds
 * the defaults of a deployment, and the shell holds the exceptions.
 *
 * @param profiles the profiles of the file.
 * @param environment the environment of the shell.
 * @param requested the profile a command named, when it named one.
 */
export function resolveContext(
  profiles: Profiles,
  environment: Environment,
  requested?: string
): ResolvedContext {
  const name =
    requested ?? environment[ENVIRONMENT_VARIABLES.profile] ?? profiles.current ?? 'default'
  const profile: Profile = profiles.profiles[name] ?? {}
  const pick = (key: keyof Profile, variable: string): string | undefined => {
    const fromEnvironment = environment[variable]
    if (fromEnvironment !== undefined && fromEnvironment !== '') return fromEnvironment
    return profile[key]
  }
  return {
    name,
    gatewayUrl: pick('gatewayUrl', ENVIRONMENT_VARIABLES.gatewayUrl),
    controlUrl: pick('controlUrl', ENVIRONMENT_VARIABLES.controlUrl),
    accessUrl: pick('accessUrl', ENVIRONMENT_VARIABLES.accessUrl),
    workspaceId: pick('workspaceId', ENVIRONMENT_VARIABLES.workspaceId),
    tenantId: pick('tenantId', ENVIRONMENT_VARIABLES.tenantId),
    clientId: pick('clientId', ENVIRONMENT_VARIABLES.clientId),
    clientSecret: pick('clientSecret', ENVIRONMENT_VARIABLES.clientSecret),
    redirectUri: pick('redirectUri', ENVIRONMENT_VARIABLES.redirectUri),
    controlToken: environment[ENVIRONMENT_VARIABLES.controlToken],
    adminToken: environment[ENVIRONMENT_VARIABLES.adminToken],
    token: environment[ENVIRONMENT_VARIABLES.token],
  }
}

/**
 * The address of a service of the deployment.
 *
 * A command that needs an address and has none cannot answer: it is a
 * usage error, and the reader is told which variable names it.
 *
 * @param context the context of the command.
 * @param key the address the command needs.
 * @param variable the variable that names it in the environment.
 */
export function addressOf(
  context: ResolvedContext,
  key: 'gatewayUrl' | 'controlUrl' | 'accessUrl',
  variable: string
): string {
  const address = context[key]
  if (!address) {
    throw new CliFailure(
      `the profile "${context.name}" names no ${key}: set ${variable} or add it to the profile`,
      2,
      'not_configured'
    )
  }
  return address.replace(/\/+$/, '')
}

/**
 * The workspace a command works on.
 *
 * @param context the context of the command.
 * @param workspace the workspace the command named, when it named one.
 */
export function workspaceOf(context: ResolvedContext, workspace?: string): string {
  const id = workspace ?? context.workspaceId
  if (!id) {
    throw new CliFailure(
      'no workspace is named: pass --workspace or set PLATFORMCTL_WORKSPACE_ID',
      2,
      'not_configured'
    )
  }
  return id
}
