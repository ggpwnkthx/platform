/**
 * The profiles of the deployments.
 *
 * A profile is the answer to the question "which deployment is this?":
 * the addresses of the services, the workspace and the client of the
 * CLI. The profile of a shell is named by an environment variable, and
 * the profiles of the machine live in a file.
 */

import type { GroupSpec } from '../../app/commands'
import { stringOf } from '../../app/commands'
import type { Profile, Profiles } from '../../domains/contracts'
import { resolveContext } from '../../domains/context'
import { CliFailure } from '../../domains/failure'
import { contextOf } from './calls'

/** The options of the command that writes a profile. */
const SET_OPTIONS = [
  { name: 'gateway-url', kind: 'string' as const, summary: 'the address of the gateway' },
  { name: 'control-url', kind: 'string' as const, summary: 'the address of the control plane' },
  { name: 'access-url', kind: 'string' as const, summary: 'the address of Access' },
  {
    name: 'workspace',
    kind: 'string' as const,
    summary: 'the workspace of the commands of the data',
  },
  { name: 'tenant', kind: 'string' as const, summary: 'the tenant of the commands of the access' },
  { name: 'client-id', kind: 'string' as const, summary: 'the client the CLI signs in with' },
  { name: 'client-secret', kind: 'string' as const, summary: 'the secret of the client' },
  {
    name: 'redirect-uri',
    kind: 'string' as const,
    summary: 'the address of the callback of a login',
  },
  { name: 'use', kind: 'boolean' as const, summary: 'make the profile the one of the shell' },
]

/**
 * The group of the profiles.
 */
export const contextGroup: GroupSpec = {
  name: 'context',
  summary: 'the profiles of the deployments',
  description:
    'A profile names a deployment: the addresses of its services, the workspace and the client of the CLI.',
  commands: [
    {
      name: 'list',
      summary: 'list the profiles of the machine',
      async run(input) {
        const profiles = await input.services.profiles.read()
        const names = Object.keys(profiles.profiles).sort()
        return {
          value: names.map((name) => ({
            name,
            current: name === (profiles.current ?? ''),
            gatewayUrl: profiles.profiles[name]?.gatewayUrl ?? '',
          })),
        }
      },
    },
    {
      name: 'show',
      summary: 'show the profile of a deployment',
      arguments: [{ name: 'name', summary: 'the name of the profile', required: false }],
      async run(input) {
        const profiles = await input.services.profiles.read()
        const name = input.args[0]
        const resolved = resolveContext(profiles, input.environment, name)
        return { value: contextOf(resolved) }
      },
    },
    {
      name: 'current',
      summary: 'show the profile the shell uses',
      async run(input) {
        return { value: { profile: input.context.name } }
      },
    },
    {
      name: 'set',
      summary: 'write a profile of a deployment',
      description:
        'The names that are not given are kept as they are. The secret of the client is written in the file of the profiles, and that file is read by its owner only.',
      arguments: [{ name: 'name', summary: 'the name of the profile', required: true }],
      options: SET_OPTIONS,
      examples: [
        'platformctl context set production --gateway-url https://api.example.com --workspace 11111111-1111-4111-8111-111111111111',
      ],
      async run(input) {
        const name = input.args[0]
        if (!name) {
          throw new CliFailure('the name of the profile is needed', 2, 'missing_argument')
        }
        const profiles = await input.services.profiles.read()
        const existing: Profile = profiles.profiles[name] ?? {}
        const written: Profile = {
          gatewayUrl: stringOf(input.options, 'gateway-url') ?? existing.gatewayUrl,
          controlUrl: stringOf(input.options, 'control-url') ?? existing.controlUrl,
          accessUrl: stringOf(input.options, 'access-url') ?? existing.accessUrl,
          workspaceId: stringOf(input.options, 'workspace') ?? existing.workspaceId,
          tenantId: stringOf(input.options, 'tenant') ?? existing.tenantId,
          clientId: stringOf(input.options, 'client-id') ?? existing.clientId,
          clientSecret: stringOf(input.options, 'client-secret') ?? existing.clientSecret,
          redirectUri: stringOf(input.options, 'redirect-uri') ?? existing.redirectUri,
        }
        const next: Profiles = {
          current: input.options.use === true ? name : profiles.current,
          profiles: { ...profiles.profiles, [name]: written },
        }
        await input.services.profiles.write(next)
        return {
          value: { profile: name, current: next.current === name },
          message: `the profile "${name}" is written`,
        }
      },
    },
    {
      name: 'remove',
      summary: 'remove a profile of the machine',
      arguments: [{ name: 'name', summary: 'the name of the profile', required: true }],
      async run(input) {
        const name = input.args[0]
        if (!name) {
          throw new CliFailure('the name of the profile is needed', 2, 'missing_argument')
        }
        const profiles = await input.services.profiles.read()
        if (!profiles.profiles[name]) {
          throw new CliFailure(`the profile "${name}" is not there`, 4, 'not_found')
        }
        const remaining: Record<string, Profile> = { ...profiles.profiles }
        delete remaining[name]
        const next: Profiles = {
          current: profiles.current === name ? undefined : profiles.current,
          profiles: remaining,
        }
        await input.services.profiles.write(next)
        return { value: { profile: name, removed: true } }
      },
    },
    {
      name: 'paths',
      summary: 'show the files of the CLI on this machine',
      async run(input) {
        return {
          value: {
            profiles: input.services.files.profiles,
            credentials: input.services.files.credentials,
          },
        }
      },
    },
  ],
}
