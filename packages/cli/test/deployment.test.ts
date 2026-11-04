import { describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { run, type CliRuntime } from '../src/app/cli'
import type { Services } from '../src/app/commands'
import { CliFailure } from '../src/domains/failure'
import {
  answerOf,
  defaultsOf,
  type DeploymentProvider,
  missingOf,
  problemsOf,
  questionsOf,
  valuesFile,
} from '../src/domains/deployment'
import { azureProvider } from '../src/platform/azure'
import {
  deployCommand,
  addressesOf,
  existingOf,
  fallbackOf,
  recoverLeftover,
} from '../src/runtime/commands/deploy'
import { FakeInfrastructure } from './support'

/**
 * The wizard of a deployment.
 *
 * The wizard signs the operator in, asks the questions the deployment
 * needs, and writes the file of the values. The tests prove that it
 * asks what it cannot answer itself, that it refuses an answer the
 * deployment cannot use, and that it writes nothing else.
 */

/** The services of the tests. */
function servicesOf(tool: FakeInfrastructure, progress: string[] = []): Services {
  return {
    http: {
      send: async () => {
        throw new Error('the wizard does not talk to a service')
      },
    },
    profiles: { read: async () => ({ profiles: {} }), write: async () => undefined },
    credentials: {
      read: async () => null,
      write: async () => undefined,
      clear: async () => undefined,
    },
    browser: { open: async () => undefined },
    callback: {
      start: async () => ({
        redirectUri: 'http://127.0.0.1:8765/callback',
        wait: async () => ({ code: 'the-code', state: 'the-state' }),
      }),
    },
    crypto: {
      randomBytes: (size: number) => new Uint8Array(size).fill(7),
      sha256: (value: Uint8Array) => new Uint8Array(value.length).fill(9),
    },
    infrastructure: tool,
    files: { profiles: '/tmp/profiles.json', credentials: '/tmp/credentials.json' },
    progress: (text) => progress.push(text),
  }
}

/** The runtime of the tests. */
function runtimeOf(
  commands: Parameters<typeof deployCommand>[0][],
  tool: FakeInfrastructure = new FakeInfrastructure(),
  environment: Readonly<Record<string, string | undefined>> = {}
): {
  runtime: CliRuntime
  out: string[]
  err: string[]
  progress: string[]
} {
  const out: string[] = []
  const err: string[] = []
  const progress: string[] = []
  return {
    out,
    err,
    progress,
    runtime: {
      name: 'platformctl',
      commands: [],
      groups: [
        {
          name: 'deploy',
          summary: 'the deployment of the platform',
          commands: commands.map((provider) => deployCommand(provider)),
        },
      ],
      environment: { PLATFORMCTL_ADDRESS_LOOKUP: 'off', ...environment },
      services: () => servicesOf(tool, progress),
      contextOf: async () => ({ name: 'default' }),
      out: (text) => out.push(text),
      err: (text) => err.push(text),
    },
  }
}

/** A provider that answers without a system of its own. */
function providerOf(questions: DeploymentProvider['questions']): DeploymentProvider {
  return {
    name: 'azure',
    summary: 'Microsoft Azure',
    questions,
    signIn: async () => ({
      facts: { tenant_id: '11111111-1111-4111-8111-111111111111' },
      message: 'signed in to Azure as the-subscription',
      account: 'the-subscription',
    }),
  }
}

/**
 * A terminal that answers what the test wants it to answer.
 *
 * The wizard asks the operator to confirm the plan, and the operator
 * answers it: the test gives the answers, in the order they are
 * asked for.
 *
 * @param answers the answers of the operator.
 */
function terminalOf(answers: readonly string[]): NodeJS.ReadStream {
  const stream = new PassThrough() as unknown as NodeJS.ReadStream
  Object.assign(stream, { isTTY: true })
  for (const answer of answers) stream.write(`${answer}\n`)
  stream.end()
  return stream
}

/** The example of the values of the templates. */
const EXAMPLE = [
  '# The values of a deployment.',
  'name_prefix = "platform"',
  'environment = "production"',
  'location = "westeurope"',
  'gateway_hostname = "api.example.com"',
  'gateway_image = "ghcr.io/ggpwnkthx/gateway@sha256:0000000000000000000000000000000000000000000000000000000000000000"',
  'services = {',
  '  gateway = { min_replicas = 2 }',
  '}',
  '',
].join('\n')

describe('the values of the example of the templates', () => {
  test('the values of the example are read', () => {
    const values = defaultsOf(EXAMPLE)
    expect(values.name_prefix).toBe('platform')
    expect(values.environment).toBe('production')
    expect(values.gateway_hostname).toBe('api.example.com')
  })

  test('a value that spans several lines is not read', () => {
    const values = defaultsOf(EXAMPLE)
    expect(values.services).toBeUndefined()
  })

  test('a line that is a comment holds no value', () => {
    expect(defaultsOf('# name_prefix = "other"').name_prefix).toBeUndefined()
  })
})

describe('the questions of the wizard', () => {
  const questions = [
    { name: 'name_prefix', summary: 'the prefix', kind: 'chosen' as const },
    { name: 'tenant_id', summary: 'the tenant', kind: 'given' as const },
    { name: 'gateway_hostname', summary: 'the name of the gateway', kind: 'required' as const },
  ]

  test('a question the provider answered is not asked again', () => {
    const asked = questionsOf(providerOf(questions), { tenant_id: 'the-tenant' })
    expect(asked.map((question) => question.name)).toEqual(['name_prefix', 'gateway_hostname'])
  })

  test('a question that is given is not asked', () => {
    const asked = questionsOf(providerOf(questions), {})
    expect(asked.map((question) => question.name)).toEqual(['name_prefix', 'gateway_hostname'])
  })

  test('a fact answers a question', () => {
    expect(answerOf(questions[1]!, { tenant_id: 'the-tenant' }, {}, undefined)).toBe('the-tenant')
  })

  test('what the operator typed answers a question', () => {
    expect(answerOf(questions[0]!, {}, { name_prefix: 'platform' }, 'other')).toBe('other')
  })

  test('an empty answer takes the default of the example', () => {
    expect(answerOf(questions[0]!, {}, { name_prefix: 'platform' }, '')).toBe('platform')
  })

  test('a question that is needed and unanswered is missing', () => {
    expect(missingOf(questions, { name_prefix: 'platform' })).toEqual(['gateway_hostname'])
  })
})

describe('the answers of the wizard', () => {
  const questions = [
    {
      name: 'gateway_image',
      summary: 'the image of the gateway',
      kind: 'required' as const,
      shape: 'digest' as const,
    },
    {
      name: 'access_tenant_id',
      summary: 'the tenant of Access',
      kind: 'required' as const,
      shape: 'uuid' as const,
    },
  ]

  test('an image that is not a digest is refused', () => {
    const problems = problemsOf(questions, {
      gateway_image: 'ghcr.io/ggpwnkthx/gateway:1.0.0',
      access_tenant_id: '11111111-1111-4111-8111-111111111111',
    })
    expect(problems).toEqual([
      'the image of the gateway is not a digest: the deployment runs the bytes that the release proved',
    ])
  })

  test('an identifier that is not an identifier is refused', () => {
    expect(
      problemsOf(questions, {
        gateway_image: `ghcr.io/ggpwnkthx/gateway@sha256:${'1'.repeat(64)}`,
        access_tenant_id: 'acme',
      })
    ).toEqual([
      'the tenant of Access is not an identifier like 11111111-1111-4111-8111-111111111111',
    ])
  })

  test('a question that is needed and unanswered is refused', () => {
    expect(problemsOf(questions, {})).toEqual([
      'the image of the gateway is needed',
      'the tenant of Access is needed',
    ])
  })
})

describe('the file of the values of the deployment', () => {
  test('the file holds the values and the questions they answer', () => {
    const provider = providerOf([
      { name: 'name_prefix', summary: 'the prefix of the names', kind: 'chosen' },
    ])
    const file = valuesFile(provider, { name_prefix: 'platform' })
    expect(file).toContain('# the prefix of the names')
    expect(file).toContain('name_prefix = "platform"')
  })

  test('the file holds no value the wizard did not collect', () => {
    const provider = providerOf([
      { name: 'name_prefix', summary: 'the prefix of the names', kind: 'chosen' },
      { name: 'location', summary: 'the region', kind: 'given' },
    ])
    const file = valuesFile(provider, { name_prefix: 'platform' })
    expect(file).not.toContain('location')
  })
})

describe('the values of the deployments that are already there', () => {
  test('the values of a deployment that is already there are read', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-wizard-'))
    try {
      const templates = join(directory, 'deploy', 'tofu', 'azure')
      await mkdir(join(directory, 'deploy', 'tofu', 'runtime', 'development'), { recursive: true })
      await writeFile(
        join(directory, 'deploy', 'tofu', 'runtime', 'development', 'terraform.tfvars'),
        'environment = "development"\ngateway_hostname = "api.example.com"\n'
      )
      const existing = await existingOf(undefined, templates)
      expect(existing.get('development')?.gateway_hostname).toBe('api.example.com')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('the values of the deployment the reader names are read', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-wizard-'))
    try {
      const runtime = join(directory, 'runtime')
      await mkdir(runtime, { recursive: true })
      await writeFile(
        join(runtime, 'terraform.tfvars'),
        'environment = "staging"\ngateway_hostname = "api.staging.example.com"\n'
      )
      const existing = await existingOf(runtime, join(directory, 'templates'))
      expect(existing.get('staging')?.gateway_hostname).toBe('api.staging.example.com')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a machine that holds no deployment holds no values', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-wizard-'))
    try {
      const existing = await existingOf(undefined, join(directory, 'templates'))
      expect(existing.size).toBe(0)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('the values of the deployment are the defaults of the questions', () => {
    const example = { environment: 'production', gateway_hostname: 'api.example.com' }
    const existing = new Map([
      [
        'development',
        { environment: 'development', gateway_hostname: 'api.development.example.com' },
      ],
    ])
    expect(fallbackOf('gateway_hostname', { environment: 'development' }, example, existing)).toBe(
      'api.development.example.com'
    )
    expect(fallbackOf('gateway_hostname', { environment: 'production' }, example, existing)).toBe(
      'api.example.com'
    )
  })

  test('the environment of the deployment that is already there is the default of the environment', () => {
    const example = { environment: 'production' }
    const existing = new Map([['development', { environment: 'development' }]])
    expect(fallbackOf('environment', {}, example, existing)).toBe('development')
  })

  test('the environment of the deployment that is already there wins over the example', () => {
    const example = { environment: 'production' }
    const existing = new Map([['production', { environment: 'production' }]])
    expect(fallbackOf('environment', {}, example, existing)).toBe('production')
  })

  test('a machine that holds several deployments keeps the environment of the example', () => {
    const example = { environment: 'production' }
    const existing = new Map([
      ['development', { environment: 'development' }],
      ['staging', { environment: 'staging' }],
    ])
    expect(fallbackOf('environment', {}, example, existing)).toBe('production')
  })
})

describe('the addresses that reach the account of the state', () => {
  test('an answer that is empty takes the address that was read', () => {
    expect(addressesOf('', '159.96.225.84/30')).toEqual({
      ranges: ['159.96.225.84/30'],
      widened: [],
    })
  })

  test('the operator changes the address that was read', () => {
    expect(addressesOf('198.51.100.4/30', '159.96.225.84/30').ranges).toEqual(['198.51.100.4/30'])
  })

  test('an address that carries no mask is the range that holds it', () => {
    expect(addressesOf('198.51.100.7').ranges).toEqual(['198.51.100.4/30'])
  })

  test('a range of one address is widened to the range that holds it', () => {
    const widened = addressesOf('159.96.225.85/32')
    expect(widened.ranges).toEqual(['159.96.225.84/30'])
    expect(widened.widened).toEqual(['159.96.225.85/32'])
  })

  test('several addresses are the ranges of the machines', () => {
    expect(addressesOf('198.51.100.7, 203.0.113.4/30').ranges).toEqual([
      '198.51.100.4/30',
      '203.0.113.4/30',
    ])
  })

  test('an answer that is empty and no address that was read is refused', () => {
    expect(() => addressesOf('', undefined)).toThrow(
      'the addresses that reach the account of the state of the deployment are needed'
    )
  })

  test('an address that is not a range is refused', () => {
    expect(() => addressesOf('here', undefined)).toThrow('the address here is not a range')
  })
})

describe('the wizard of a deployment', () => {
  test('the wizard writes the file of the values and goes on with the deployment', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-wizard-'))
    try {
      const templates = join(directory, 'templates')
      const runtime = join(directory, 'runtime')
      await bootstrapOf(templates)
      await writeFile(join(templates, 'terraform.tfvars.example'), EXAMPLE)

      const provider = providerOf([
        { name: 'name_prefix', summary: 'the prefix of the names', kind: 'chosen' },
        { name: 'tenant_id', summary: 'the tenant', kind: 'given' },
        {
          name: 'gateway_hostname',
          summary: 'the public name of the gateway',
          kind: 'required',
        },
      ])
      const tool = new FakeInfrastructure()
      tool.plan_ = {
        directory: templates,
        changes: [
          {
            address: 'azurerm_resource_group.platform',
            action: 'create',
            kind: 'azurerm_resource_group',
            name: 'platform',
            provider: 'hashicorp/azurerm',
          },
        ],
        drift: [],
        summary: { create: 1, update: 0, delete: 0, replace: 0 },
        errored: false,
        planFile: join(runtime, 'plan.bin'),
      }
      const { runtime: cli, out, progress } = runtimeOf([provider], tool)
      const status = await run(cli, [
        'deploy',
        'azure',
        '--yes',
        '--directory',
        templates,
        '--runtime',
        runtime,
        '--answers',
        await answersFileOf(
          directory,
          'name_prefix = "platform"\ngateway_hostname = "api.example.com"\noperator_addresses = "203.0.113.4/32"\n'
        ),
      ])
      expect(status).toBe(0)
      expect(progress.join('\n')).toContain('signed in to Azure as the-subscription')

      const file = await readFile(join(runtime, 'terraform.tfvars'), 'utf8')
      expect(file).toContain('name_prefix = "platform"')
      expect(file).toContain('gateway_hostname = "api.example.com"')
      expect(file).toContain('tenant_id = "11111111-1111-4111-8111-111111111111"')

      // The deployment goes on: the place where the state lives, the
      // configuration of the backend, the templates, the plan and the
      // apply. The progress of the wizard is told as it happens, and
      // the answer of the command keeps the plan it applied.
      expect(progress.join('\n')).toContain(
        'the place where the state of the deployment lives is created'
      )
      expect(progress.join('\n')).toContain('the templates of the deployment are initialized')
      expect(out.join('\n')).toContain('azurerm_resource_group.platform')
      expect(out.join('\n')).toContain('the deployment is applied')

      // The configuration of the backend is written in the runtime
      // directory of the deployment.
      expect(await readFile(join(runtime, 'backend.hcl'), 'utf8')).toContain(
        'resource_group_name = "platform-production-state"'
      )

      // The bootstrap is run with the values of the deployment and with
      // the addresses that reach the account of the state.
      expect(tool.bootstraps).toHaveLength(1)
      expect(tool.bootstraps[0]?.directory).toBe(join(templates, 'bootstrap'))
      expect(tool.bootstraps[0]?.variables.name_prefix).toBe('platform')
      expect(tool.bootstraps[0]?.variables.environment).toBe('production')
      expect(tool.bootstraps[0]?.variables.operator_addresses).toBe('["203.0.113.4/30"]')
      // The identity of the operator is empty when the provider knows
      // none: the bootstrap then grants the permission to nobody.
      expect(tool.bootstraps[0]?.variables.operator_principal_id).toBe('')

      // The templates are initialized against the backend of the state.
      expect(tool.initialized).toHaveLength(1)
      expect(tool.initialized[0]?.run.backendConfig).toBe(join(runtime, 'backend.hcl'))

      // The plan that was shown is the plan that was applied.
      expect(tool.applied).toHaveLength(1)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('the files of the deployment live next to the templates, not next to the reader', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-wizard-'))
    try {
      const templates = join(directory, 'deploy', 'tofu', 'azure')
      await bootstrapOf(templates)
      await writeFile(join(templates, 'terraform.tfvars.example'), EXAMPLE)

      const provider = providerOf([
        { name: 'environment', summary: 'the environment', kind: 'chosen' },
      ])
      const { runtime: cli } = runtimeOf([provider])
      const status = await run(cli, [
        'deploy',
        'azure',
        '--yes',
        '--directory',
        templates,
        '--answers',
        await answersFileOf(
          directory,
          'environment = "staging"\noperator_addresses = "203.0.113.4/32"\n'
        ),
      ])
      expect(status).toBe(0)
      const file = join(directory, 'deploy', 'tofu', 'runtime', 'staging', 'terraform.tfvars')
      expect(await readFile(file, 'utf8')).toContain('environment = "staging"')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('an answer the deployment cannot use is refused', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-wizard-'))
    try {
      const templates = join(directory, 'templates')
      await bootstrapOf(templates)
      await writeFile(join(templates, 'terraform.tfvars.example'), EXAMPLE)

      const provider = providerOf([
        {
          name: 'gateway_image',
          summary: 'the image of the gateway',
          kind: 'required',
          shape: 'digest',
        },
      ])
      const { runtime: cli } = runtimeOf([provider])
      await expect(
        run(cli, [
          'deploy',
          'azure',
          '--directory',
          templates,
          '--runtime',
          join(directory, 'runtime'),
          '--answers',
          await answersFileOf(directory, 'gateway_image = "ghcr.io/ggpwnkthx/gateway:1.0.0"\n'),
        ])
      ).rejects.toThrow('the deployment is not ready')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a wizard without the example of the values is refused', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-wizard-'))
    try {
      const templates = join(directory, 'templates')
      await mkdir(templates, { recursive: true })
      const { runtime: cli } = runtimeOf([providerOf([])])
      await expect(run(cli, ['deploy', 'azure', '--directory', templates])).rejects.toThrow(
        'the example of the values of the templates is not there'
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('templates without a bootstrap cannot hold the state of the deployment', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-wizard-'))
    try {
      const templates = join(directory, 'templates')
      await mkdir(templates, { recursive: true })
      await writeFile(join(templates, 'terraform.tfvars.example'), EXAMPLE)

      const provider = providerOf([
        { name: 'name_prefix', summary: 'the prefix of the names', kind: 'chosen' },
      ])
      const { runtime: cli } = runtimeOf([provider])
      await expect(
        run(cli, [
          'deploy',
          'azure',
          '--yes',
          '--directory',
          templates,
          '--answers',
          await answersFileOf(
            directory,
            'name_prefix = "platform"\noperator_addresses = "203.0.113.4/32"\n'
          ),
        ])
      ).rejects.toThrow('the templates of the deployment hold no bootstrap')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a resource that a failed apply left behind is written in the state', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-wizard-'))
    try {
      const templates = join(directory, 'templates')
      await bootstrapOf(templates)
      await writeFile(join(templates, 'terraform.tfvars.example'), EXAMPLE)

      const tool = new FakeInfrastructure()
      tool.plan_ = {
        directory: '/templates',
        changes: [
          {
            address: 'azurerm_key_vault.platform',
            action: 'create',
            kind: 'azurerm_key_vault',
            name: 'platform',
            provider: 'hashicorp/azurerm',
          },
        ],
        drift: [],
        summary: { create: 1, update: 0, delete: 0, replace: 0 },
        errored: false,
      }
      tool.failure = new CliFailure(
        'the deployment was not applied: Error: creating Key Vault (Subscription: "the-sub"\nResource Group Name: "the-group"\nKey Vault Name: "the-vault"): performing CreateOrUpdate: unexpected status 409 with error: VaultAlreadyExists: The vault name is already in use\n\n  with azurerm_key_vault.platform,\n  on keyvault.tf line 12'
      )
      const provider = {
        ...providerOf([
          { name: 'name_prefix', summary: 'the prefix of the names', kind: 'chosen' },
        ]),
        leftoverOf: async () => ({
          name: 'the-vault',
          ids: [
            '/subscriptions/the-sub/resourceGroups/the-group/providers/Microsoft.KeyVault/vaults/the-vault',
          ],
        }),
      }
      const { runtime: cli } = runtimeOf([provider], tool)
      const status = await run(cli, [
        'deploy',
        'azure',
        '--yes',
        '--directory',
        templates,
        '--answers',
        await answersFileOf(
          directory,
          'name_prefix = "platform"\noperator_addresses = "203.0.113.4/32"\n'
        ),
      ])
      expect(status).toBe(0)
      // The resource is written in the state, and the plan is run again.
      expect(tool.imported).toEqual([
        {
          address: 'azurerm_key_vault.platform',
          id: '/subscriptions/the-sub/resourceGroups/the-group/providers/Microsoft.KeyVault/vaults/the-vault',
        },
      ])
      expect(tool.applied).toHaveLength(1)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a resource that lives in another group is not taken over', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-wizard-'))
    try {
      const templates = join(directory, 'templates')
      await bootstrapOf(templates)
      await writeFile(join(templates, 'terraform.tfvars.example'), EXAMPLE)

      const tool = new FakeInfrastructure()
      tool.plan_ = {
        directory: '/templates',
        changes: [
          {
            address: 'azurerm_key_vault.platform',
            action: 'create',
            kind: 'azurerm_key_vault',
            name: 'platform',
            provider: 'hashicorp/azurerm',
          },
        ],
        drift: [],
        summary: { create: 1, update: 0, delete: 0, replace: 0 },
        errored: false,
      }
      tool.failure = new CliFailure(
        'the deployment was not applied: Error: creating Key Vault (Subscription: "the-sub"\nResource Group Name: "the-group"\nKey Vault Name: "the-vault"): performing CreateOrUpdate: unexpected status 409 with error: VaultAlreadyExists: The vault name is already in use\n\n  with azurerm_key_vault.platform,\n  on keyvault.tf line 12'
      )
      const provider = {
        ...providerOf([
          { name: 'name_prefix', summary: 'the prefix of the names', kind: 'chosen' },
        ]),
        leftoverOf: async () => ({
          name: 'the-vault',
          ids: [],
          place: 'the group the-other-group of the subscription the-sub',
        }),
      }
      const { runtime: cli } = runtimeOf([provider], tool)
      // The deployment is refused, and the refusal says where the name is held.
      await expect(
        run(cli, [
          'deploy',
          'azure',
          '--yes',
          '--directory',
          templates,
          '--answers',
          await answersFileOf(
            directory,
            'name_prefix = "platform"\noperator_addresses = "203.0.113.4/32"\n'
          ),
        ])
      ).rejects.toThrow(
        'the-vault already exists in the group the-other-group of the subscription the-sub'
      )
      expect(tool.imported).toEqual([])
      expect(tool.applied).toHaveLength(0)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a resource that was deleted and not purged is purged', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-wizard-'))
    try {
      const templates = join(directory, 'templates')
      await bootstrapOf(templates)
      await writeFile(join(templates, 'terraform.tfvars.example'), EXAMPLE)

      const tool = new FakeInfrastructure()
      tool.plan_ = {
        directory: '/templates',
        changes: [
          {
            address: 'azurerm_key_vault.platform',
            action: 'create',
            kind: 'azurerm_key_vault',
            name: 'platform',
            provider: 'hashicorp/azurerm',
          },
        ],
        drift: [],
        summary: { create: 1, update: 0, delete: 0, replace: 0 },
        errored: false,
      }
      tool.failure = new CliFailure(
        'the deployment was not applied: Error: creating Key Vault (Subscription: "the-sub"\nResource Group Name: "the-group"\nKey Vault Name: "the-vault"): performing CreateOrUpdate: unexpected status 409 with error: VaultAlreadyExists: The vault name is already in use\n\n  with azurerm_key_vault.platform,\n  on keyvault.tf line 12'
      )
      const released: string[] = []
      const provider = {
        ...providerOf([
          { name: 'name_prefix', summary: 'the prefix of the names', kind: 'chosen' },
        ]),
        leftoverOf: async () => ({
          name: 'the-vault',
          ids: [],
          location: 'the-region',
        }),
        release: async (leftover: { name: string }) => {
          released.push(leftover.name)
        },
      }
      const { runtime: cli } = runtimeOf([provider], tool)
      const status = await run(cli, [
        'deploy',
        'azure',
        '--yes',
        '--directory',
        templates,
        '--answers',
        await answersFileOf(
          directory,
          'name_prefix = "platform"\noperator_addresses = "203.0.113.4/32"\n'
        ),
      ])
      expect(status).toBe(0)
      // The resource is purged, and the plan is run again.
      expect(released).toEqual(['the-vault'])
      expect(tool.applied).toHaveLength(1)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a resource that was deleted and not purged is not purged when the operator says no', async () => {
    const tool = new FakeInfrastructure()
    const released: string[] = []
    const provider = {
      ...providerOf([]),
      leftoverOf: async () => ({
        name: 'the-vault',
        ids: [],
        location: 'the-region',
      }),
      release: async (leftover: { name: string }) => {
        released.push(leftover.name)
      },
    }
    const refusal = new CliFailure(
      'the deployment was not applied: Error: creating Key Vault (Subscription: "the-sub"\nResource Group Name: "the-group"\nKey Vault Name: "the-vault"): performing CreateOrUpdate: unexpected status 409 with error: VaultAlreadyExists: The vault name is already in use\n\n  with azurerm_key_vault.platform,\n  on keyvault.tf line 12'
    )
    // The operator says no: the name is not freed, and the refusal says
    // what has to be done.
    const before = process.stdin
    Object.defineProperty(process, 'stdin', {
      value: terminalOf(['n']),
      configurable: true,
    })
    try {
      await expect(
        recoverLeftover(
          {
            provider,
            port: tool,
            directory: '/templates',
            file: '/values.tfvars',
            region: 'the-region',
            yes: false,
            purged: [],
          },
          refusal
        )
      ).rejects.toThrow('the-vault was deleted and not purged')
    } finally {
      Object.defineProperty(process, 'stdin', { value: before, configurable: true })
    }
    expect(released).toEqual([])
  })

  test('a name that was purged is not purged again', async () => {
    const tool = new FakeInfrastructure()
    const released: string[] = []
    const provider = {
      ...providerOf([]),
      leftoverOf: async () => ({
        name: 'the-vault',
        ids: [],
        location: 'the-region',
      }),
      release: async (leftover: { name: string }) => {
        released.push(leftover.name)
      },
    }
    const refusal = new CliFailure(
      'the deployment was not applied: Error: creating Key Vault (Subscription: "the-sub"\nResource Group Name: "the-group"\nKey Vault Name: "the-vault"): performing CreateOrUpdate: unexpected status 409 with error: VaultAlreadyExists: The vault name is already in use\n\n  with azurerm_key_vault.platform,\n  on keyvault.tf line 12'
    )
    // The name was freed, and the cloud has not freed it yet: the
    // resource is not purged again.
    await expect(
      recoverLeftover(
        {
          provider,
          port: tool,
          directory: '/templates',
          file: '/values.tfvars',
          region: 'the-region',
          yes: true,
          purged: ['the-vault'],
        },
        refusal
      )
    ).rejects.toThrow('the-vault was purged, and the cloud has not freed the name yet')
    expect(released).toEqual([])
  })

  test('a name that is held is freed by naming the resource of the deployment', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-wizard-'))
    try {
      const templates = join(directory, 'templates')
      await bootstrapOf(templates)
      await writeFile(join(templates, 'terraform.tfvars.example'), EXAMPLE)

      const tool = new FakeInfrastructure()
      tool.plan_ = {
        directory: '/templates',
        changes: [
          {
            address: 'azurerm_key_vault.platform',
            action: 'create',
            kind: 'azurerm_key_vault',
            name: 'platform',
            provider: 'hashicorp/azurerm',
          },
        ],
        drift: [],
        summary: { create: 1, update: 0, delete: 0, replace: 0 },
        errored: false,
      }
      tool.failure = new CliFailure(
        'the deployment was not applied: Error: creating Key Vault (Subscription: "the-sub"\nResource Group Name: "the-group"\nKey Vault Name: "the-vault"): performing CreateOrUpdate: unexpected status 409 with error: VaultAlreadyExists: The vault name is already in use\n\n  with azurerm_key_vault.platform,\n  on keyvault.tf line 12'
      )
      const provider = {
        ...providerOf([
          { name: 'name_prefix', summary: 'the prefix of the names', kind: 'chosen' },
          { name: 'key_vault_name', summary: 'the name of the vault', kind: 'given' },
        ]),
        leftoverOf: async () => ({
          name: 'the-vault',
          ids: [],
          searched: 'the resource was not alive in the subscription the-sub',
          values: { key_vault_name: 'the-vault2' },
        }),
      }
      const { runtime: cli } = runtimeOf([provider], tool)
      const status = await run(cli, [
        'deploy',
        'azure',
        '--yes',
        '--directory',
        templates,
        '--answers',
        await answersFileOf(
          directory,
          'name_prefix = "platform"\noperator_addresses = "203.0.113.4/32"\n'
        ),
      ])
      expect(status).toBe(0)
      // The values are written again with the name that is free, and
      // the plan is run again with them.
      const values = await readFile(
        join(directory, 'runtime', 'production', 'terraform.tfvars'),
        'utf8'
      )
      expect(values).toContain('key_vault_name = "the-vault2"')
      expect(tool.applied).toHaveLength(1)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('the name of a resource of a deployment that is already there is kept', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-wizard-'))
    try {
      const templates = join(directory, 'templates')
      const runtime = join(directory, 'runtime')
      await bootstrapOf(templates)
      await writeFile(join(templates, 'terraform.tfvars.example'), EXAMPLE)
      await mkdir(join(runtime, 'production'), { recursive: true })
      await writeFile(
        join(runtime, 'production', 'terraform.tfvars'),
        'name_prefix = "platform"\nenvironment = "production"\nkey_vault_name = "the-vault2"\n'
      )

      const tool = new FakeInfrastructure()
      const provider = {
        ...providerOf([
          { name: 'name_prefix', summary: 'the prefix of the names', kind: 'chosen' },
          { name: 'key_vault_name', summary: 'the name of the vault', kind: 'given' },
        ]),
      }
      const { runtime: cli } = runtimeOf([provider], tool)
      const status = await run(cli, [
        'deploy',
        'azure',
        '--yes',
        '--directory',
        templates,
        '--runtime',
        runtime,
        '--answers',
        await answersFileOf(
          directory,
          'name_prefix = "platform"\noperator_addresses = "203.0.113.4/32"\n'
        ),
      ])
      expect(status).toBe(0)
      // The name the operator gave to the vault of the deployment is
      // kept: the wizard does not ask it, and it does not throw it away.
      const values = await readFile(join(runtime, 'production', 'terraform.tfvars'), 'utf8')
      expect(values).toContain('key_vault_name = "the-vault2"')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a failure that is not a leftover is the failure of the apply', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-wizard-'))
    try {
      const templates = join(directory, 'templates')
      await bootstrapOf(templates)
      await writeFile(join(templates, 'terraform.tfvars.example'), EXAMPLE)

      const tool = new FakeInfrastructure()
      tool.plan_ = {
        directory: '/templates',
        changes: [
          {
            address: 'azurerm_key_vault.platform',
            action: 'create',
            kind: 'azurerm_key_vault',
            name: 'platform',
            provider: 'hashicorp/azurerm',
          },
        ],
        drift: [],
        summary: { create: 1, update: 0, delete: 0, replace: 0 },
        errored: false,
      }
      tool.failure = new CliFailure('the deployment was not applied: Error: something else')
      const provider = providerOf([
        { name: 'name_prefix', summary: 'the prefix of the names', kind: 'chosen' },
      ])
      const { runtime: cli } = runtimeOf([provider], tool)
      await expect(
        run(cli, [
          'deploy',
          'azure',
          '--yes',
          '--directory',
          templates,
          '--answers',
          await answersFileOf(
            directory,
            'name_prefix = "platform"\noperator_addresses = "203.0.113.4/32"\n'
          ),
        ])
      ).rejects.toThrow('something else')
      expect(tool.imported).toEqual([])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('the addresses are asked when the reading of the address is refused', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-wizard-'))
    try {
      const templates = join(directory, 'templates')
      await bootstrapOf(templates)
      await writeFile(join(templates, 'terraform.tfvars.example'), EXAMPLE)

      const provider = providerOf([
        { name: 'name_prefix', summary: 'the prefix of the names', kind: 'chosen' },
      ])
      const tool = new FakeInfrastructure()
      const { runtime: cli } = runtimeOf([provider], tool, { PLATFORMCTL_ADDRESS_LOOKUP: 'off' })
      await expect(
        run(cli, [
          'deploy',
          'azure',
          '--yes',
          '--directory',
          templates,
          '--answers',
          await answersFileOf(directory, 'name_prefix = "platform"\n'),
        ])
      ).rejects.toThrow('nobody can answer it')
      expect(tool.bootstraps).toHaveLength(0)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('an address that is not a range is refused', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-wizard-'))
    try {
      const templates = join(directory, 'templates')
      await bootstrapOf(templates)
      await writeFile(join(templates, 'terraform.tfvars.example'), EXAMPLE)

      const provider = providerOf([
        { name: 'name_prefix', summary: 'the prefix of the names', kind: 'chosen' },
      ])
      const { runtime: cli } = runtimeOf([provider])
      await expect(
        run(cli, [
          'deploy',
          'azure',
          '--yes',
          '--directory',
          templates,
          '--answers',
          await answersFileOf(directory, 'name_prefix = "platform"\noperator_addresses = "here"\n'),
        ])
      ).rejects.toThrow('the address here is not a range')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a dry run tells the steps and changes nothing', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-wizard-'))
    try {
      const templates = join(directory, 'templates')
      await bootstrapOf(templates)
      await writeFile(join(templates, 'terraform.tfvars.example'), EXAMPLE)

      const provider = providerOf([
        { name: 'name_prefix', summary: 'the prefix of the names', kind: 'chosen' },
      ])
      const tool = new FakeInfrastructure()
      const { runtime: cli, out } = runtimeOf([provider], tool)
      const status = await run(cli, [
        'deploy',
        'azure',
        '--dry-run',
        '--yes',
        '--directory',
        templates,
        '--answers',
        await answersFileOf(
          directory,
          'name_prefix = "platform"\noperator_addresses = "203.0.113.4/32"\n'
        ),
      ])
      expect(status).toBe(0)
      expect(out.join('\n')).toContain('create the place where the state of the deployment lives')
      expect(tool.bootstraps).toHaveLength(0)
      expect(tool.applied).toHaveLength(0)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

/** A file of the answers of the operator. */
async function answersFileOf(directory: string, content: string): Promise<string> {
  const file = join(directory, `answers-${Math.random().toString(36).slice(2)}.tfvars`)
  await writeFile(file, content)
  return file
}

/** The bootstrap of the templates, as the tests answer with it. */
const BOOTSTRAP = [
  'variable "name_prefix" {}',
  'variable "environment" {}',
  'variable "location" {}',
  'variable "resource_group_name" {}',
  'variable "operator_addresses" {}',
  'variable "operator_principal_id" {}',
  '',
].join('\n')

/**
 * The bootstrap of the templates of a deployment.
 *
 * The bootstrap declares the variables it takes, and the wizard passes
 * only what the bootstrap declares.
 *
 * @param templates the directory of the templates.
 */
async function bootstrapOf(templates: string): Promise<string> {
  const bootstrap = join(templates, 'bootstrap')
  await mkdir(bootstrap, { recursive: true })
  await writeFile(join(bootstrap, 'main.tf'), BOOTSTRAP)
  return bootstrap
}

/**
 * The client of Azure, as the tests answer with it.
 *
 * The client of Azure is a program of the machine of the operator, and
 * the provider runs it: the double of the client answers with the json
 * the real client writes, so that the sign in is proved and not only
 * its answers.
 */
const CLIENT = `#!/bin/sh
case "$1 $2" in
  "account show") echo '{"id":"sub-1","name":"the-subscription","tenantId":"11111111-1111-4111-8111-111111111111","user":{"name":"operator@example.com","id":"operator-1"}}' ;;
  "account list") echo '[{"id":"sub-1","name":"the-subscription","tenantId":"11111111-1111-4111-8111-111111111111"}]' ;;
  *) exit 0 ;;
esac
`

/**
 * The client of Azure, as the tests answer with it.
 *
 * The account of this one names no identity, and the directory of Entra
 * ID does.
 */
const CLIENT_WITHOUT_IDENTITY = `#!/bin/sh
case "$1 $2" in
  "account show") echo '{"id":"sub-1","name":"the-subscription","tenantId":"11111111-1111-4111-8111-111111111111"}' ;;
  "account list") echo '[{"id":"sub-1","name":"the-subscription","tenantId":"11111111-1111-4111-8111-111111111111"}]' ;;
  "ad signed-in-user") echo "operator-2" ;;
  *) exit 0 ;;
esac
`

/**
 * The client of Azure, as the tests answer with the resources of a
 * subscription.
 *
 * The client answers with the resources of the group that the refusal
 * names, and the refusal of the tests names both the group and the
 * resource: the two names are not to be mixed.
 */
const CLIENT_WITH_RESOURCES = `#!/bin/sh
case "$1 $2" in
  "account show") echo '{"id":"sub-1","name":"the-subscription","tenantId":"11111111-1111-4111-8111-111111111111"}' ;;
  "account list") echo '[{"id":"sub-1","name":"the-subscription","tenantId":"11111111-1111-4111-8111-111111111111"}]' ;;
  "resource list") echo '[{"id":"/subscriptions/sub-1/resourceGroups/the-group/providers/Microsoft.KeyVault/vaults/the-vault","name":"the-vault","type":"Microsoft.KeyVault/vaults"}]' ;;
  *) exit 0 ;;
esac
`

/**
 * The client of Azure, when the resource was deleted and not purged.
 *
 * The client does not list the resources that were deleted, and the
 * directory of Azure does: it lists them region by region.
 */
const CLIENT_WITH_DELETED = `#!/bin/sh
if [ "$1" = "rest" ]; then
  case "$5" in
    */locations/the-region/deletedVaults*)
      echo '{"value":[{"id":"/x","name":"the-vault","location":"the-region","properties":{"vaultName":"the-vault","deletedDate":"2026-01-01"}}]}' ;;
    *) echo '{"value":[]}' ;;
  esac
  exit 0
fi
case "$1 $2" in
  "account show") echo '{"id":"sub-1","name":"the-subscription","tenantId":"11111111-1111-4111-8111-111111111111"}' ;;
  "account list") echo '[{"id":"sub-1","name":"the-subscription","tenantId":"11111111-1111-4111-8111-111111111111"}]' ;;
  "account list-locations") printf 'the-region\nthe-other-region\n' ;;
  "resource list") echo '[]' ;;
  "keyvault purge") printf '%s in %s' "$4" "$6" > "$(dirname "$0")/purged" ;;
  *) exit 0 ;;
esac
`

/**
 * The client of Azure, when the vault cannot be found.
 *
 * The client answers that there is no vault, and the directory of the
 * deleted vaults refuses the question.
 */
const CLIENT_WITHOUT_VAULT = `#!/bin/sh
if [ "$1" = "rest" ]; then
  echo 'the directory of the deleted vaults is not readable' >&2
  exit 1
fi
case "$1 $2" in
  "account show") echo '{"id":"sub-1","name":"the-subscription","tenantId":"11111111-1111-4111-8111-111111111111"}' ;;
  "account list") echo '[{"id":"sub-1","name":"the-subscription","tenantId":"11111111-1111-4111-8111-111111111111"}]' ;;
  "account list-locations") printf 'the-region\n' ;;
  "resource list") echo '[]' ;;
  *) exit 0 ;;
esac
`

describe('the leftover of a failed apply', () => {
  test('the provider reads the name of the resource and not the name of the group', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-azure-'))
    try {
      const binary = join(directory, 'az')
      await writeFile(binary, CLIENT_WITH_RESOURCES)
      await chmod(binary, 0o755)
      const provider = azureProvider(
        [{ name: 'tenant_id', summary: 'the tenant', kind: 'given' }],
        { PATH: process.env.PATH ?? '', AZURE_CLI: binary }
      )
      // The refusal of Azure names the subscription, the group of the
      // resources, and the resource: the name of the resource is the
      // one that carries the kind of the resource.
      const leftover = await provider.leftoverOf?.(
        'Error: creating Key Vault (Subscription: "sub-1"\nResource Group Name: "the-group"\nKey Vault Name: "the-vault"): performing CreateOrUpdate: unexpected status 409'
      )
      expect(leftover?.name).toBe('the-vault')
      expect(leftover?.ids).toEqual([
        '/subscriptions/sub-1/resourceGroups/the-group/providers/Microsoft.KeyVault/vaults/the-vault',
      ])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a refusal that names no resource leaves nothing to take over', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-azure-'))
    try {
      const binary = join(directory, 'az')
      await writeFile(binary, CLIENT_WITH_RESOURCES)
      await chmod(binary, 0o755)
      const provider = azureProvider(
        [{ name: 'tenant_id', summary: 'the tenant', kind: 'given' }],
        { PATH: process.env.PATH ?? '', AZURE_CLI: binary }
      )
      const leftover = await provider.leftoverOf?.('Error: something else went wrong')
      expect(leftover).toBeUndefined()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a resource that was deleted and not purged is found in the region of the deployment', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-azure-'))
    try {
      const binary = join(directory, 'az')
      await writeFile(binary, CLIENT_WITH_DELETED)
      await chmod(binary, 0o755)
      const provider = azureProvider(
        [{ name: 'tenant_id', summary: 'the tenant', kind: 'given' }],
        { PATH: process.env.PATH ?? '', AZURE_CLI: binary }
      )
      // The client of Azure cannot see the resource: the directory of
      // the deleted resources of Azure can.
      const leftover = await provider.leftoverOf?.(
        'Error: creating Key Vault (Subscription: "sub-1"\nResource Group Name: "the-group"\nKey Vault Name: "the-vault"): performing CreateOrUpdate: unexpected status 409',
        'the-region'
      )
      expect(leftover?.name).toBe('the-vault')
      expect(leftover?.ids).toEqual([])
      expect(leftover?.location).toBe('the-region')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a vault that cannot be found is named differently', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-azure-'))
    try {
      const binary = join(directory, 'az')
      await writeFile(binary, CLIENT_WITHOUT_VAULT)
      await chmod(binary, 0o755)
      const provider = azureProvider(
        [{ name: 'tenant_id', summary: 'the tenant', kind: 'given' }],
        { PATH: process.env.PATH ?? '', AZURE_CLI: binary }
      )
      const leftover = await provider.leftoverOf?.(
        'Error: creating Key Vault (Subscription: "sub-1"\nResource Group Name: "the-group"\nKey Vault Name: "the-vault"): performing CreateOrUpdate: unexpected status 409',
        'the-region'
      )
      // The vault is nowhere the client of Azure can see, and the
      // deployment names its vault differently.
      expect(leftover?.ids).toEqual([])
      expect(leftover?.values).toEqual({ key_vault_name: 'the-vault2' })
      expect(leftover?.searched).toContain('the directory of the deleted vaults is not readable')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('the name of a resource that was deleted and not purged is freed by purging it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-azure-'))
    try {
      const binary = join(directory, 'az')
      await writeFile(binary, CLIENT_WITH_DELETED)
      await chmod(binary, 0o755)
      const provider = azureProvider(
        [{ name: 'tenant_id', summary: 'the tenant', kind: 'given' }],
        { PATH: process.env.PATH ?? '', AZURE_CLI: binary }
      )
      const leftover = await provider.leftoverOf?.(
        'Error: creating Key Vault (Subscription: "sub-1"\nResource Group Name: "the-group"\nKey Vault Name: "the-vault"): performing CreateOrUpdate: unexpected status 409',
        'the-region'
      )
      await provider.release?.(leftover!)
      // The resource is purged, in the region it was in.
      const purged = await readFile(join(directory, 'purged'), 'utf8')
      expect(purged).toBe('the-vault in the-region')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

describe('the sign in to Azure', () => {
  test('the provider signs the operator in and reads the facts of the deployment', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-azure-'))
    try {
      const binary = join(directory, 'az')
      await writeFile(binary, CLIENT)
      await chmod(binary, 0o755)
      const provider = azureProvider(
        [{ name: 'tenant_id', summary: 'the tenant', kind: 'given' }],
        { PATH: process.env.PATH ?? '', AZURE_CLI: binary }
      )
      const signIn = await provider.signIn(async () => 'the-subscription')
      expect(signIn.account).toBe('the-subscription')
      expect(signIn.facts.tenant_id).toBe('11111111-1111-4111-8111-111111111111')
      expect(signIn.facts.subscription_id).toBe('sub-1')
      // The identity of the operator reads and writes the state of the
      // deployment, and the bootstrap needs its identifier.
      expect(signIn.facts.operator_principal_id).toBe('operator-1')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a client that is not there is refused', async () => {
    const provider = azureProvider([], { PATH: '' })
    await expect(provider.signIn(async () => 'the-subscription')).rejects.toThrow(
      'the client of Azure is not on the path'
    )
  })

  test('the identity of the operator is read from the directory of Entra ID', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-azure-'))
    try {
      const binary = join(directory, 'az')
      await writeFile(binary, CLIENT_WITHOUT_IDENTITY)
      await chmod(binary, 0o755)
      const provider = azureProvider(
        [{ name: 'tenant_id', summary: 'the tenant', kind: 'given' }],
        { PATH: process.env.PATH ?? '', AZURE_CLI: binary }
      )
      const signIn = await provider.signIn(async () => 'the-subscription')
      expect(signIn.facts.operator_principal_id).toBe('operator-2')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
