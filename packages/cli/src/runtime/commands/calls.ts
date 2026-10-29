/**
 * The calls of the commands.
 *
 * Every command of the CLI needs the same three things: the address of
 * a service, the credential of the caller, and the workspace it works
 * on. They are gathered here, and the gathering is where the CLI says
 * what it misses: a command that cannot reach a service says which
 * variable names it.
 */

import { addressOf, workspaceOf, type ResolvedContext } from '../../domains/context'
import { CliFailure } from '../../domains/failure'
import type { ControlCall } from '../../domains/gateway'
import type { AccessCall } from '../../domains/access'
import type { DataCall } from '../../domains/data'
import type { CommandInput } from '../../app/commands'
import { stringOf } from '../../app/commands'

/**
 * The credential of the caller.
 *
 * The environment comes first: a script authenticates itself with a
 * token, and the machine of a person holds the credential of the login.
 *
 * @param input what the command received.
 */
export async function callerToken(input: CommandInput): Promise<string> {
  const fromEnvironment = input.context.token
  if (fromEnvironment) return fromEnvironment
  const credential = await input.services.credentials.read()
  if (!credential) {
    throw new CliFailure(
      'the caller is not signed in: run platformctl login, or set PLATFORMCTL_TOKEN',
      3,
      'not_authenticated'
    )
  }
  if (credential.expiresAt !== undefined && credential.expiresAt <= Date.now()) {
    throw new CliFailure(
      'the credential of the caller is no longer valid: run platformctl login again',
      3,
      'expired'
    )
  }
  return credential.accessToken
}

/**
 * The call to the control plane of the gateway.
 *
 * @param input what the command received.
 */
export function controlCall(input: CommandInput): ControlCall {
  const context = input.context
  const token = context.controlToken
  if (!token) {
    throw new CliFailure(
      'the credential of the control plane is missing: set PLATFORMCTL_CONTROL_TOKEN',
      3,
      'not_authenticated'
    )
  }
  return {
    http: input.services.http,
    baseUrl: addressOf(context, 'controlUrl', 'PLATFORMCTL_CONTROL_URL'),
    token,
  }
}

/**
 * The call to Access.
 *
 * @param input what the command received.
 */
export function accessCall(input: CommandInput): AccessCall {
  const context = input.context
  const token = context.adminToken
  if (!token) {
    throw new CliFailure(
      'the credential of the administration is missing: set PLATFORMCTL_ADMIN_TOKEN',
      3,
      'not_authenticated'
    )
  }
  return {
    http: input.services.http,
    baseUrl: addressOf(context, 'accessUrl', 'PLATFORMCTL_ACCESS_URL'),
    token,
  }
}

/**
 * The call to the data API, through the gateway.
 *
 * @param input what the command received.
 */
export async function dataCall(input: CommandInput): Promise<DataCall> {
  const context = input.context
  const workspace = workspaceOf(context, stringOf(input.options, 'workspace'))
  const token = await callerToken(input)
  return {
    http: input.services.http,
    baseUrl: addressOf(context, 'gatewayUrl', 'PLATFORMCTL_GATEWAY_URL'),
    token,
    workspaceId: workspace,
  }
}

/**
 * The context of a deployment, as it is shown.
 *
 * @param context the context of the command.
 */
export function contextOf(context: ResolvedContext): Record<string, string> {
  return {
    profile: context.name,
    gatewayUrl: context.gatewayUrl ?? '',
    controlUrl: context.controlUrl ?? '',
    accessUrl: context.accessUrl ?? '',
    workspaceId: context.workspaceId ?? '',
    tenantId: context.tenantId ?? '',
    clientId: context.clientId ?? '',
  }
}
