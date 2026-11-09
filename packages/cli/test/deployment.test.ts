import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
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
  ENVIRONMENTS,
  missingOf,
  problemOf,
  problemsOf,
  questionsOf,
  valuesFile,
} from '../src/domains/deployment'
import { azureProvider, importablesOf } from '../src/platform/azure'
import {
  deployCommand,
  addressesOf,
  existingOf,
  fallbackOf,
  offeredOf,
  recoverLeftover,
} from '../src/runtime/commands/deploy'
import { VERSION } from '../src/runtime/version'
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

/**
 * The dialog of a command: the questions on the input, and the words
 * of the CLI on the output.
 */
interface Dialogue {
  /** The stream the answers of the operator come on. */
  readonly input: NodeJS.ReadStream
  /** The stream the dialog is written on. */
  readonly output: NodeJS.WriteStream
  /** The words the CLI wrote in the dialog. */
  readonly words: string[]
}

/**
 * A terminal that answers the questions of the operator, one by one.
 *
 * The reader of a terminal answers the question that is asked: the
 * test answers a question when the CLI asks it, and never before.
 *
 * @param answers the answers of the operator.
 */
function dialogueOf(answers: readonly string[]): Dialogue {
  const input = new PassThrough() as unknown as NodeJS.ReadStream
  Object.assign(input, { isTTY: true })
  const output = new PassThrough() as unknown as NodeJS.WriteStream
  const words: string[] = []
  let index = 0
  output.write = ((chunk: string) => {
    words.push(chunk)
    // The question of the CLI ends with the marker of the answer: the
    // question of a value, or the question of a confirmation.
    if (chunk.endsWith('> ') || chunk.endsWith('[y/N] ')) {
      const answer = answers[index++]
      if (answer === undefined) {
        input.end()
        return true
      }
      setTimeout(() => input.write(`${answer}\n`), 5)
    }
    return true
  }) as unknown as NodeJS.WriteStream['write']
  return { input, output, words }
}

/**
 * Runs a command with a terminal that answers the questions.
 *
 * The dialog of a command is written on the standard error and read on
 * the standard input: the test holds both while the command runs.
 *
 * @param answers the answers of the operator.
 * @param body the command that runs.
 */
async function withDialogue<T>(
  answers: readonly string[],
  body: (dialogue: Dialogue) => Promise<T>
): Promise<T> {
  const dialogue = dialogueOf(answers)
  const before = { stdin: process.stdin, stderr: process.stderr }
  Object.defineProperty(process, 'stdin', { value: dialogue.input, configurable: true })
  Object.defineProperty(process, 'stderr', { value: dialogue.output, configurable: true })
  try {
    return await body(dialogue)
  } finally {
    Object.defineProperty(process, 'stdin', { value: before.stdin, configurable: true })
    Object.defineProperty(process, 'stderr', { value: before.stderr, configurable: true })
  }
}

/** The example of the values of the templates. */
const EXAMPLE = [
  '# The values of a deployment.',
  'name_prefix = "platform"',
  'environment = "production"',
  'location = "westeurope"',
  'dns_zone_name = "example.com"',
  'gateway_name = "api"',
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
    expect(values.dns_zone_name).toBe('example.com')
    expect(values.gateway_name).toBe('api')
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

describe('the environment of a deployment', () => {
  const question = {
    name: 'environment',
    summary: 'the environment of the deployment',
    kind: 'chosen' as const,
    choices: ENVIRONMENTS,
  }

  test('an environment the deployment cannot use is refused', () => {
    // The name of the environment is in the name of every resource of
    // the deployment, and the templates take three names and no
    // other: an environment that is not one of them is refused at the
    // question, and not by the tool after the minutes of the plan.
    expect(problemOf(question, 'dev')).toBe(
      'the environment of the deployment is not one of development, staging, production'
    )
  })

  test('the environments of the platform are accepted', () => {
    for (const environment of ENVIRONMENTS) {
      expect(problemOf(question, environment)).toBeUndefined()
    }
  })

  test('the provider of Azure asks for the environment of the platform', () => {
    const asked = azureProvider().questions.find((one) => one.name === 'environment')
    expect(asked?.choices).toEqual(['development', 'staging', 'production'])
  })

  test('the provider of Azure names the subscription of the deployment', () => {
    // The subscription of the session is the subscription of the
    // deployment: the templates write their resources in it, and the
    // wizard writes it in the values of the deployment.
    const asked = azureProvider().questions.find((one) => one.name === 'subscription_id')
    expect(asked?.kind).toBe('given')
  })

  test('the provider of Azure names the time the logs are kept', () => {
    const asked = azureProvider().questions.find(
      (one) => one.name === 'log_analytics_retention_days'
    )
    expect(asked?.kind).toBe('given')
  })

  test('the provider of Azure asks for the slug of the workspace', () => {
    // The tenant of the deployment is created with the slug of its
    // workspace, and the wizard writes the slug in the values of the
    // deployment: a question the wizard does not ask is a slug the
    // wizard does not know.
    const asked = azureProvider().questions.find((one) => one.name === 'data_workspace_slug')
    expect(asked?.kind).toBe('required')
  })

  test('a default the deployment cannot use is not offered', () => {
    // A deployment that is already there holds the answers of an
    // earlier run, and an answer of an earlier run that the templates
    // refuse is not an offer: it is a trap.
    expect(offeredOf(question, 'dev', { environment: 'production' })).toBe('production')
    expect(offeredOf(question, 'dev', { environment: 'dev' })).toBeUndefined()
    expect(offeredOf(question, 'development', { environment: 'production' })).toBe('development')
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
      // the answer of the command keeps what the apply did.
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
      // The bootstrap runs in the directory of the files of the
      // deployment: the state of the bootstrap is a local state, and a
      // local state is written in the directory the tool runs in. The
      // state of the bootstrap holds the credentials of the account of
      // the state, and the checkout of the templates is not the place
      // of a credential.
      expect(tool.bootstraps[0]?.directory).toBe(join(runtime, 'bootstrap'))
      expect(await readFile(join(runtime, 'bootstrap', 'main.tf'), 'utf8')).toBe(BOOTSTRAP)
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

  test('the wizard binds the certificate of the public names after the apply', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-wizard-'))
    try {
      const templates = join(directory, 'templates')
      const runtime = join(directory, 'runtime')
      await bootstrapOf(templates)
      await writeFile(join(templates, 'terraform.tfvars.example'), EXAMPLE)

      // The provider of the deployment binds what the templates cannot
      // write, and it reads the names of the deployment in the answers
      // of the templates.
      const bound: {
        values: Readonly<Record<string, string>>
        outputs: Readonly<Record<string, unknown>>
      }[] = []
      const provider: DeploymentProvider = {
        ...providerOf([
          { name: 'name_prefix', summary: 'the prefix of the names', kind: 'chosen' },
        ]),
        afterApply: async (context) => {
          bound.push({ values: context.values, outputs: context.outputs })
          return ['the certificate of the name api.example.com is bound to the gateway']
        },
      }
      const tool = new FakeInfrastructure()
      tool.outputs = {
        container_apps: { gateway: 'platform-production-gateway' },
        container_app_environment: 'platform-production-environment',
        resource_group_name: 'platform-production',
        public_names: { api: 'api.example.com' },
      }
      tool.plan_ = {
        directory: templates,
        changes: [
          {
            address: 'azurerm_container_app.gateway',
            action: 'create',
            kind: 'azurerm_container_app',
            name: 'platform-production-gateway',
            provider: 'hashicorp/azurerm',
          },
        ],
        drift: [],
        summary: { create: 1, update: 0, delete: 0, replace: 0 },
        errored: false,
        planFile: join(runtime, 'plan.bin'),
      }
      const { runtime: cli, out } = runtimeOf([provider], tool)
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

      // The binding is written after the apply, and not before: the
      // certificate of a name is bound to a gateway that is there.
      expect(bound).toHaveLength(1)
      expect(bound[0]?.values.name_prefix).toBe('platform')
      expect(bound[0]?.outputs.public_names).toEqual({ api: 'api.example.com' })
      expect(out.join('\n')).toContain(
        'the certificate of the name api.example.com is bound to the gateway'
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('the wizard binds the certificate of the public names when the deployment changes nothing', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-wizard-'))
    try {
      const templates = join(directory, 'templates')
      const runtime = join(directory, 'runtime')
      await bootstrapOf(templates)
      await writeFile(join(templates, 'terraform.tfvars.example'), EXAMPLE)

      // The binding of a name waits for the records of DNS of the
      // name: the wizard binds it again when the deployment changes
      // nothing.
      const bound: number[] = []
      const provider: DeploymentProvider = {
        ...providerOf([
          { name: 'name_prefix', summary: 'the prefix of the names', kind: 'chosen' },
        ]),
        afterApply: async () => {
          bound.push(1)
          return ['the certificate of the name api.example.com is bound to the gateway']
        },
      }
      const tool = new FakeInfrastructure()
      tool.outputs = {
        container_apps: { gateway: 'platform-production-gateway' },
        container_app_environment: 'platform-production-environment',
        resource_group_name: 'platform-production',
        public_names: { api: 'api.example.com' },
      }
      tool.plan_ = {
        directory: templates,
        changes: [],
        drift: [],
        summary: { create: 0, update: 0, delete: 0, replace: 0 },
        errored: false,
        planFile: join(runtime, 'plan.bin'),
      }
      const { runtime: cli, out } = runtimeOf([provider], tool)
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
      expect(bound).toHaveLength(1)
      expect(out.join('\n')).toContain(
        'the certificate of the name api.example.com is bound to the gateway'
      )
      // The plan changed nothing, and nothing was applied.
      expect(tool.applied).toHaveLength(0)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('the wizard names the subscription of the deployment and runs the bootstrap outside the checkout', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-wizard-'))
    try {
      const templates = join(directory, 'templates')
      const runtime = join(directory, 'runtime')
      const bootstrap = await bootstrapOf(templates)
      // The file of the lock of the providers is the file that pins the
      // version of the provider of Azure, and the copy of the
      // bootstrap carries it.
      await writeFile(
        join(bootstrap, '.terraform.lock.hcl'),
        'provider "registry.opentofu.org/hashicorp/azurerm" { version = "4.81.0" }\n'
      )
      await writeFile(join(templates, 'terraform.tfvars.example'), EXAMPLE)

      const provider: DeploymentProvider = {
        ...providerOf([
          { name: 'name_prefix', summary: 'the prefix of the names', kind: 'chosen' },
          { name: 'subscription_id', summary: 'the subscription', kind: 'given' },
        ]),
        signIn: async () => ({
          facts: {
            tenant_id: '11111111-1111-4111-8111-111111111111',
            subscription_id: 'the-subscription',
          },
          message: 'signed in to Azure as the-subscription',
          account: 'the-subscription',
        }),
      }
      const tool = new FakeInfrastructure()
      tool.plan_ = {
        directory: templates,
        changes: [],
        drift: [],
        summary: { create: 0, update: 0, delete: 0, replace: 0 },
        errored: false,
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

      // The subscription of the session is the subscription of the
      // deployment, and the values of the deployment name it: the
      // templates write their resources in that subscription.
      const file = await readFile(join(runtime, 'terraform.tfvars'), 'utf8')
      expect(file).toContain('subscription_id = "the-subscription"')

      // The bootstrap runs in the directory of the files of the
      // deployment: its state is local, and it holds the name of the
      // account of the state of the deployment.
      expect(tool.bootstraps[0]?.directory).toBe(join(runtime, 'bootstrap'))
      expect(tool.bootstraps[0]?.variables.subscription_id).toBe('the-subscription')
      expect(await readFile(join(runtime, 'bootstrap', 'main.tf'), 'utf8')).toBe(BOOTSTRAP)
      expect(await readFile(join(runtime, 'bootstrap', '.terraform.lock.hcl'), 'utf8')).toContain(
        '4.81.0'
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('the state of the place is taken out of the checkout of the templates', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-wizard-'))
    try {
      const templates = join(directory, 'templates')
      const runtime = join(directory, 'runtime')
      const bootstrap = await bootstrapOf(templates)
      await writeFile(join(templates, 'terraform.tfvars.example'), EXAMPLE)
      // The state of a bootstrap that ran before the deployment moved
      // it is in the checkout of the templates, and it holds the name
      // of the account of the state of the deployment.
      await writeFile(join(bootstrap, 'terraform.tfstate'), '{"version": 4}\n')

      const provider = providerOf([
        { name: 'name_prefix', summary: 'the prefix of the names', kind: 'chosen' },
      ])
      const tool = new FakeInfrastructure()
      tool.plan_ = {
        directory: templates,
        changes: [],
        drift: [],
        summary: { create: 0, update: 0, delete: 0, replace: 0 },
        errored: false,
      }
      const { runtime: cli, progress } = runtimeOf([provider], tool)
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

      // The state is in the directory of the files of the deployment,
      // and it is not in the checkout of the templates any more.
      expect(await readFile(join(runtime, 'bootstrap', 'terraform.tfstate'), 'utf8')).toBe(
        '{"version": 4}\n'
      )
      expect(existsSync(join(bootstrap, 'terraform.tfstate'))).toBe(false)
      expect(progress.join('\n')).toContain(
        'the state of the place where the state of the deployment lives was in the checkout of the templates'
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('the wizard asks the zone of the names and writes it in the values of the deployment', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-wizard-'))
    try {
      const templates = join(directory, 'templates')
      const runtime = join(directory, 'runtime')
      await bootstrapOf(templates)
      await writeFile(join(templates, 'terraform.tfvars.example'), EXAMPLE)

      const provider = providerOf([
        { name: 'name_prefix', summary: 'the prefix of the names', kind: 'chosen' },
        {
          name: 'dns_zone_name',
          summary: 'the zone of DNS that holds the public names of the deployment',
          kind: 'required',
        },
        {
          name: 'gateway_name',
          summary: 'the name of the gateway in the zone of the deployment',
          kind: 'required',
        },
      ])
      const { runtime: cli } = runtimeOf([provider])
      const status = await withDialogue(
        [],
        async () =>
          await run(cli, [
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
              'name_prefix = "platform"\ndns_zone_name = "platform.example.com"\ngateway_name = "api"\noperator_addresses = "203.0.113.4/32"\n'
            ),
          ])
      )
      expect(status).toBe(0)
      // The zone of the names of the deployment is in the values of the
      // deployment: the deployment writes the records of the names in
      // the zone, and the operator delegates the zone.
      const file = await readFile(join(runtime, 'terraform.tfvars'), 'utf8')
      expect(file).toContain('dns_zone_name = "platform.example.com"')
      expect(file).toContain('gateway_name = "api"')
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

  test('the place where the state of the deployment lives is taken over when it is there', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-wizard-'))
    try {
      const templates = join(directory, 'templates')
      await bootstrapOf(templates)
      await writeFile(join(templates, 'terraform.tfvars.example'), EXAMPLE)

      const tool = new FakeInfrastructure()
      tool.plan_ = {
        directory: '/templates',
        changes: [],
        drift: [],
        summary: { create: 0, update: 0, delete: 0, replace: 0 },
        errored: false,
      }
      // The state of the place is a file of the machine of the
      // operator, and the file is lost: the resources of the place are
      // there and the state does not know them.
      tool.bootstrapFailure = new CliFailure(
        'the place where the state of the deployment lives was not created: Error: a resource with the ID "/subscriptions/the-subscription/resourceGroups/platform-production-state" already exists - to be managed via Terraform this resource needs to be imported into the State.\n\n  with azurerm_resource_group.state,\n  on main.tf line 95'
      )
      const provider = {
        ...providerOf([
          { name: 'name_prefix', summary: 'the prefix of the names', kind: 'chosen' },
        ]),
        importablesOf: (reason: string) => importablesOf(reason),
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
      // The resource of the place is written in the state of the place,
      // and the place is created again.
      expect(tool.imported).toEqual([
        {
          address: 'azurerm_resource_group.state',
          id: '/subscriptions/the-subscription/resourceGroups/platform-production-state',
        },
      ])
      // The resource is written in the state of the place, and the tool
      // is told the values of the place: a resource that is written
      // with other values than the ones of the apply is a resource the
      // next apply wants to change.
      expect(tool.importedRuns[0]?.directory).toBe(
        join(directory, 'runtime', 'production', 'bootstrap')
      )
      expect(tool.importedRuns[0]?.run.variables?.resource_group_name).toBe(
        'platform-production-state'
      )
      expect(tool.bootstraps).toHaveLength(2)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('the resources a failed apply left behind are written in the state', async () => {
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
            address: 'azurerm_key_vault_secret.platform["the-secret"]',
            action: 'create',
            kind: 'azurerm_key_vault_secret',
            name: 'the-secret',
            provider: 'hashicorp/azurerm',
          },
        ],
        drift: [],
        summary: { create: 1, update: 0, delete: 0, replace: 0 },
        errored: false,
      }
      // The tool refuses to create a secret of a vault that is already
      // there, and it names the secret and its identifier.
      tool.failure = new CliFailure(
        'the deployment was not applied: Error: a resource with the ID "https://the-vault.vault.azure.net/secrets/the-secret/a398d93c5bfe4a0dbf76361f05caf4e6" already exists - to be managed via Terraform this resource needs to be imported into the State.\n\n  with azurerm_key_vault_secret.platform["the-secret"],\n  on keyvault.tf line 76'
      )
      const provider = {
        ...providerOf([
          { name: 'name_prefix', summary: 'the prefix of the names', kind: 'chosen' },
        ]),
        importablesOf: (reason: string) => importablesOf(reason),
      }
      const { runtime: cli, progress } = runtimeOf([provider], tool)
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
      // The secret is written in the state, and the plan is run again:
      // the plan that holds one secret of a hundred refuses the
      // hundredth one.
      expect(tool.imported).toEqual([
        {
          address: 'azurerm_key_vault_secret.platform["the-secret"]',
          id: 'https://the-vault.vault.azure.net/secrets/the-secret',
        },
      ])
      expect(tool.applied).toHaveLength(1)
      // The recovery writes one resource at a time, and there may be a
      // hundred of them: the operator is told about each one.
      expect(progress.join('\n')).toContain(
        '1 resources that a failed apply left in the cloud are written in the state of the deployment, this takes a moment'
      )
      expect(progress.join('\n')).toContain(
        'azurerm_key_vault_secret.platform["the-secret"] is written in the state of the deployment'
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a state that could not be read is named in the question of the plan', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-wizard-'))
    try {
      const templates = join(directory, 'templates')
      await bootstrapOf(templates)
      await writeFile(join(templates, 'terraform.tfvars.example'), EXAMPLE)

      const tool = new FakeInfrastructure()
      tool.state = { read: false, reason: 'error listing blobs: tls: failed to verify certificate' }
      tool.plan_ = {
        directory: '/templates',
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
      }
      const provider = providerOf([
        { name: 'name_prefix', summary: 'the prefix of the names', kind: 'chosen' },
      ])
      const { runtime: cli, progress } = runtimeOf([provider], tool)
      const words = await withDialogue(['y'], async (dialogue) => {
        const status = await run(cli, [
          'deploy',
          'azure',
          '--directory',
          templates,
          '--answers',
          await answersFileOf(
            directory,
            'name_prefix = "platform"\noperator_addresses = "203.0.113.4/32"\n'
          ),
        ])
        expect(status).toBe(0)
        return dialogue.words.join('')
      })
      // The state of the deployment could not be read: the plan that
      // follows is the plan of a deployment whose state is empty, and
      // the operator is told before the plan is written and again in
      // the question the operator answers.
      expect(progress.join('\n')).toContain('the state of the deployment could not be read')
      expect(words).toContain('the state of the deployment is empty:')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a state that is locked is unlocked when the operator says so', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-wizard-'))
    try {
      const templates = join(directory, 'templates')
      await bootstrapOf(templates)
      await writeFile(join(templates, 'terraform.tfvars.example'), EXAMPLE)

      const tool = new FakeInfrastructure()
      // A run that was killed leaves the lock of the state behind it,
      // and the tool refuses to write the plan at all.
      tool.planFailure = new CliFailure(
        'the plan of the deployment was not written: Error: Error acquiring the state lock\n\nError message: state blob is already locked\nLock Info:\n  ID:        74e078e2-ccfa-a2ef-6a45-0ac061764254\n  Path:      https://the-account.blob.core.windows.net/tfstate/the.tfstate\n  Operation: OperationTypeInvalid\n  Who:       isaac@isaac-gaming\n  Version:   1.13.1\n  Created:   2026-11-04 21:55:29.404365078 +0000 UTC'
      )
      const provider = providerOf([
        { name: 'name_prefix', summary: 'the prefix of the names', kind: 'chosen' },
      ])
      const { runtime: cli, progress } = runtimeOf([provider], tool)
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
      // The lock is freed, and the plan is written again.
      expect(tool.unlocked).toEqual(['74e078e2-ccfa-a2ef-6a45-0ac061764254'])
      expect(progress.join('\n')).toContain(
        'the lock of the state of the deployment is freed: 74e078e2-ccfa-a2ef-6a45-0ac061764254'
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a state that is locked is not unlocked when the operator says no', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-wizard-'))
    try {
      const templates = join(directory, 'templates')
      await bootstrapOf(templates)
      await writeFile(join(templates, 'terraform.tfvars.example'), EXAMPLE)

      const tool = new FakeInfrastructure()
      tool.planFailure = new CliFailure(
        'the plan of the deployment was not written: Error: Error acquiring the state lock\n\nError message: state blob is already locked\nLock Info:\n  ID:        74e078e2-ccfa-a2ef-6a45-0ac061764254\n  Who:       isaac@isaac-gaming\n  Created:   2026-11-04 21:55:29.404365078 +0000 UTC'
      )
      const provider = providerOf([
        { name: 'name_prefix', summary: 'the prefix of the names', kind: 'chosen' },
      ])
      const { runtime: cli } = runtimeOf([provider], tool)
      // The operator says no: the lock stays, and the refusal names
      // the command that frees it.
      await expect(
        withDialogue(
          ['n'],
          async () =>
            await run(cli, [
              'deploy',
              'azure',
              '--directory',
              templates,
              '--answers',
              await answersFileOf(
                directory,
                'name_prefix = "platform"\noperator_addresses = "203.0.113.4/32"\n'
              ),
            ])
        )
      ).rejects.toThrow('force-unlock -force 74e078e2-ccfa-a2ef-6a45-0ac061764254')
      expect(tool.unlocked).toEqual([])
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
            tell: () => undefined,
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
          tell: () => undefined,
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

  test('the wizard refuses a tool that is too old before it asks anything', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-wizard-'))
    try {
      const templates = join(directory, 'templates')
      await bootstrapOf(templates)
      await writeFile(join(templates, 'terraform.tfvars.example'), EXAMPLE)

      const tool = new FakeInfrastructure()
      tool.toolVersion = '1.8.0'
      let signedIn = false
      const provider: DeploymentProvider = {
        ...providerOf([
          { name: 'name_prefix', summary: 'the prefix of the names', kind: 'chosen' },
        ]),
        signIn: async () => {
          signedIn = true
          return { facts: {}, message: 'signed in to Azure', account: 'the-subscription' }
        },
      }
      const { runtime: cli } = runtimeOf([provider], tool)
      await expect(
        run(cli, [
          'deploy',
          'azure',
          '--directory',
          templates,
          '--runtime',
          join(directory, 'runtime'),
        ])
      ).rejects.toThrow('the tool that writes the infrastructure is too old')
      // The wizard refused before it signed the operator in, and
      // before it asked a single question: the answers of the reader
      // would have been answers for nothing.
      expect(signedIn).toBe(false)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('the wizard refuses an identity it cannot read before it asks anything', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-wizard-'))
    try {
      const templates = join(directory, 'templates')
      await bootstrapOf(templates)
      await writeFile(join(templates, 'terraform.tfvars.example'), EXAMPLE)
      // The templates of the deployment write the secrets of the
      // deployment with the identity of the operator.
      await writeFile(
        join(templates, 'main.tf'),
        'variable "operator_principal_id" {}\nvariable "name_prefix" {}\n'
      )

      const provider = providerOf([
        { name: 'name_prefix', summary: 'the prefix of the names', kind: 'chosen' },
      ])
      const { runtime: cli } = runtimeOf([provider])
      // The wizard refuses before it asks anything: the refusal names
      // the identity, and not the question of a wizard that waits for
      // an answer nobody can give.
      await expect(
        run(cli, [
          'deploy',
          'azure',
          '--directory',
          templates,
          '--runtime',
          join(directory, 'runtime'),
        ])
      ).rejects.toThrow('the identity of the operator could not be read')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('an answer the deployment cannot use is asked again', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-wizard-'))
    try {
      const templates = join(directory, 'templates')
      const runtime = join(directory, 'runtime')
      await bootstrapOf(templates)
      await writeFile(join(templates, 'terraform.tfvars.example'), EXAMPLE)

      const provider = providerOf([
        {
          name: 'access_tenant_id',
          summary: 'the tenant of Access',
          kind: 'required',
          shape: 'uuid',
        },
      ])
      const { runtime: cli, progress } = runtimeOf([provider])
      const status = await withDialogue(
        ['not-an-identifier', '11111111-1111-4111-8111-111111111111'],
        async () =>
          await run(cli, [
            'deploy',
            'azure',
            '--yes',
            '--directory',
            templates,
            '--runtime',
            runtime,
            '--answers',
            await answersFileOf(directory, 'operator_addresses = "203.0.113.4/32"\n'),
          ])
      )
      expect(status).toBe(0)
      // The answer that the deployment cannot use is refused at the
      // question, and the question is asked again: the interview is
      // not thrown away over one mistyped character.
      expect(progress.join('\n')).toContain('that answer cannot be used')
      const file = await readFile(join(runtime, 'terraform.tfvars'), 'utf8')
      expect(file).toContain('access_tenant_id = "11111111-1111-4111-8111-111111111111"')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('an environment the deployment cannot use is asked again', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-wizard-'))
    try {
      const templates = join(directory, 'templates')
      const runtime = join(directory, 'runtime')
      await bootstrapOf(templates)
      await writeFile(join(templates, 'terraform.tfvars.example'), EXAMPLE)

      const provider = providerOf([
        {
          name: 'environment',
          summary: 'the environment of the deployment',
          kind: 'chosen',
          choices: ENVIRONMENTS,
        },
      ])
      const { runtime: cli } = runtimeOf([provider])
      const words = await withDialogue(['dev', '1'], async (dialogue) => {
        const status = await run(cli, [
          'deploy',
          'azure',
          '--yes',
          '--directory',
          templates,
          '--runtime',
          runtime,
          '--answers',
          await answersFileOf(directory, 'operator_addresses = "203.0.113.4/32"\n'),
        ])
        expect(status).toBe(0)
        return dialogue.words.join('')
      })
      // The environment is a selection: the operator picks one of the
      // three names the templates take, and an answer that is not one
      // of them is not an answer at all.
      expect(words).toContain('"dev" is not one of the choices')
      expect(words).toContain('[1] development')
      const file = await readFile(join(runtime, 'terraform.tfvars'), 'utf8')
      expect(file).toContain('environment = "development"')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('an address that is not a range is asked again', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-wizard-'))
    try {
      const templates = join(directory, 'templates')
      const runtime = join(directory, 'runtime')
      await bootstrapOf(templates)
      await writeFile(join(templates, 'terraform.tfvars.example'), EXAMPLE)

      const provider = providerOf([
        { name: 'name_prefix', summary: 'the prefix of the names', kind: 'chosen' },
      ])
      const { runtime: cli, progress } = runtimeOf([provider])
      const status = await withDialogue(
        ['here', '203.0.113.4/32'],
        async () =>
          await run(cli, [
            'deploy',
            'azure',
            '--yes',
            '--directory',
            templates,
            '--runtime',
            runtime,
            '--answers',
            await answersFileOf(directory, 'name_prefix = "platform"\n'),
          ])
      )
      expect(status).toBe(0)
      // The address that is not a range is refused at the question,
      // and the question is asked again.
      expect(progress.join('\n')).toContain('that answer cannot be used')
      const values = await readFile(join(runtime, 'terraform.tfvars'), 'utf8')
      expect(values).toContain('name_prefix = "platform"')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a dry run writes nothing and signs nobody in', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-wizard-'))
    try {
      const templates = join(directory, 'templates')
      const runtime = join(directory, 'runtime')
      await bootstrapOf(templates)
      await writeFile(join(templates, 'terraform.tfvars.example'), EXAMPLE)

      let signedIn = false
      const provider: DeploymentProvider = {
        ...providerOf([
          { name: 'name_prefix', summary: 'the prefix of the names', kind: 'chosen' },
        ]),
        signIn: async () => {
          signedIn = true
          return { facts: {}, message: 'signed in to Azure', account: 'the-subscription' }
        },
      }
      const { runtime: cli, out } = runtimeOf([provider])
      const status = await run(cli, [
        'deploy',
        'azure',
        '--dry-run',
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
      // The dry run signs nobody in: a dry run that opens a browser is
      // not a dry run.
      expect(signedIn).toBe(false)
      // The dry run writes nothing: not the directory of the
      // deployment, and not the file of its values.
      expect(existsSync(runtime)).toBe(false)
      expect(existsSync(join(runtime, 'terraform.tfvars'))).toBe(false)
      // The dry run tells what the deployment would do.
      expect(out.join('\n')).toContain('create the place where the state of the deployment lives')
      expect(out.join('\n')).toContain('the values of the deployment would be written in')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a deployment whose values are already there and are the same goes on', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-wizard-'))
    try {
      const templates = join(directory, 'templates')
      const runtime = join(directory, 'runtime')
      await bootstrapOf(templates)
      await writeFile(join(templates, 'terraform.tfvars.example'), EXAMPLE)
      await mkdir(runtime, { recursive: true })
      const values = 'name_prefix = "platform"\n'
      await writeFile(join(runtime, 'terraform.tfvars'), values)

      const provider = providerOf([
        { name: 'name_prefix', summary: 'the prefix of the names', kind: 'chosen' },
      ])
      const { runtime: cli, progress } = runtimeOf([provider])
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
      // The values are the ones that are there: the file is left
      // alone, and the deployment goes on.
      expect(await readFile(join(runtime, 'terraform.tfvars'), 'utf8')).toBe(values)
      expect(progress.join('\n')).toContain('the values of the deployment are already there')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a deployment whose values differ asks before it writes them again', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-wizard-'))
    try {
      const templates = join(directory, 'templates')
      const runtime = join(directory, 'runtime')
      await bootstrapOf(templates)
      await writeFile(join(templates, 'terraform.tfvars.example'), EXAMPLE)
      await mkdir(runtime, { recursive: true })
      await writeFile(join(runtime, 'terraform.tfvars'), 'name_prefix = "other"\n')

      const provider = providerOf([
        { name: 'name_prefix', summary: 'the prefix of the names', kind: 'chosen' },
      ])
      const { runtime: cli } = runtimeOf([provider])
      // The operator says no: the values that are there are kept, and
      // the refusal says what to do.
      const refusal = await withDialogue(
        ['n'],
        async () =>
          await run(cli, [
            'deploy',
            'azure',
            '--directory',
            templates,
            '--runtime',
            runtime,
            '--answers',
            await answersFileOf(directory, 'name_prefix = "platform"\n'),
          ])
      ).catch((error: unknown) => error)
      expect(refusal).toBeInstanceOf(CliFailure)
      expect((refusal as CliFailure).message).toContain(
        'the values of the deployment are already there'
      )
      expect((refusal as CliFailure).exit).toBe(5)
      // The values that are there are the ones that are still there.
      expect(await readFile(join(runtime, 'terraform.tfvars'), 'utf8')).toBe(
        'name_prefix = "other"\n'
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('the answers of the operator are told before the deployment goes on', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-wizard-'))
    try {
      const templates = join(directory, 'templates')
      const runtime = join(directory, 'runtime')
      await bootstrapOf(templates)
      await writeFile(join(templates, 'terraform.tfvars.example'), EXAMPLE)

      const provider = providerOf([
        { name: 'name_prefix', summary: 'the prefix of the names', kind: 'chosen' },
      ])
      const { runtime: cli, progress } = runtimeOf([provider])
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
      // The answers of the operator are told before the deployment
      // takes its minutes: an answer that is wrong is caught before
      // them and not after them.
      expect(progress.join('\n')).toContain('the deployment goes on with these answers:')
      expect(progress.join('\n')).toContain('name_prefix')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a recovery that does not free the name carries what the tool said', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-wizard-'))
    try {
      const templates = join(directory, 'templates')
      await bootstrapOf(templates)
      await writeFile(join(templates, 'terraform.tfvars.example'), EXAMPLE)

      const tool = new FakeInfrastructure()
      tool.plan_ = {
        directory: templates,
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
      // The tool refuses every apply, and the recovery writes the
      // resource in the state every time: the plan is run again, and
      // the tool refuses it again.
      tool.alwaysFails = true
      tool.failure = new CliFailure(
        'the deployment was not applied: Error: creating Key Vault (Subscription: "the-sub"): the vault name is already in use'
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
      const refusal = await run(cli, [
        'deploy',
        'azure',
        '--yes',
        '--directory',
        templates,
        '--runtime',
        join(directory, 'runtime'),
        '--answers',
        await answersFileOf(
          directory,
          'name_prefix = "platform"\noperator_addresses = "203.0.113.4/32"\n'
        ),
      ]).catch((error: unknown) => error)
      expect(refusal).toBeInstanceOf(CliFailure)
      // The refusal carries what the tool said, and not the summary of
      // the recovery: the reason of the failure is the reason the tool
      // gave.
      expect((refusal as CliFailure).message).toContain('the vault name is already in use')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('the plan is shown before the confirmation, whatever the format of the answer is', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-wizard-'))
    try {
      const templates = join(directory, 'templates')
      const runtime = join(directory, 'runtime')
      await bootstrapOf(templates)
      await writeFile(join(templates, 'terraform.tfvars.example'), EXAMPLE)

      const tool = new FakeInfrastructure()
      tool.plan_ = {
        directory: templates,
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
      const provider = providerOf([
        { name: 'name_prefix', summary: 'the prefix of the names', kind: 'chosen' },
      ])
      const { runtime: cli, out, progress } = runtimeOf([provider], tool)
      const status = await withDialogue(
        [],
        async () =>
          await run(cli, [
            'deploy',
            'azure',
            '--yes',
            '--output',
            'json',
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
      )
      expect(status).toBe(0)
      // The plan is shown before the apply, whatever the format of the
      // answer is: the plan that is applied is the plan that was read.
      expect(progress.join('\n')).toContain('the plan creates 1, changes 0 and destroys 0')
      // The dialog did not touch the answer of the command.
      expect(out.join('\n')).toContain('azurerm_key_vault.platform')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('the answer of the wizard says what the apply did, and not what the plan still holds', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-wizard-'))
    try {
      const templates = join(directory, 'templates')
      const runtime = join(directory, 'runtime')
      await bootstrapOf(templates)
      await writeFile(join(templates, 'terraform.tfvars.example'), EXAMPLE)

      const tool = new FakeInfrastructure()
      tool.plan_ = {
        directory: templates,
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
      const provider = providerOf([
        { name: 'name_prefix', summary: 'the prefix of the names', kind: 'chosen' },
      ])
      const { runtime: cli, out } = runtimeOf([provider], tool)
      const status = await withDialogue(
        [],
        async () =>
          await run(cli, [
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
      )
      expect(status).toBe(0)
      // The answer of the command is what the apply did: a plan that
      // is told after the apply reads as a plan that is still to come.
      expect(out.join('\n')).toContain('the deployment created 1, changed 0 and destroyed 0')
      expect(out.join('\n')).not.toContain('the plan creates 1, changes 0 and destroys 0')
      // The resources the apply changed are named all the same.
      expect(out.join('\n')).toContain('azurerm_key_vault.platform')
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
  'variable "subscription_id" {}',
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
 * The client of Azure, when the provider refuses a role assignment that
 * is already there.
 *
 * The provider names the identifier of the assignment, and the client
 * of Azure answers with the identifier of the assignment in the cloud.
 */
const CLIENT_WITH_ASSIGNMENT = `#!/bin/sh
case "$1 $2" in
  "account show") echo '{"id":"sub-1","name":"the-subscription","tenantId":"11111111-1111-4111-8111-111111111111"}' ;;
  "account list") echo '[{"id":"sub-1","name":"the-subscription","tenantId":"11111111-1111-4111-8111-111111111111"}]' ;;
  "role assignment") echo '[{"id":"/subscriptions/sub-1/resourceGroups/the-group/providers/Microsoft.Authorization/roleAssignments/a674fb9f-ae2f-8e44-74d8-7fe96527edf6","name":"a674fb9f-ae2f-8e44-74d8-7fe96527edf6","principalId":"the-principal","roleDefinitionName":"Storage Blob Data Contributor"}]' ;;
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
  test('the resources the tool named are taken over', async () => {
    const provider = azureProvider([{ name: 'tenant_id', summary: 'the tenant', kind: 'given' }], {
      PATH: '',
    })
    // The tool refuses to create a secret of a vault that is already
    // there, and it names the secret and its identifier: the state of
    // the deployment has to learn about it.
    const importables = provider.importablesOf?.(
      [
        'Error: a resource with the ID "https://platform-development-kv2.vault.azure.net/secrets/access-encryption-key/a398d93c5bfe4a0dbf76361f05caf4e6" already exists - to be managed via Terraform this resource needs to be imported into the State.',
        '',
        '  with azurerm_key_vault_secret.platform["access-encryption-key"],',
        '  on keyvault.tf line 76, in resource "azurerm_key_vault_secret" "platform":',
        '  76: resource "azurerm_key_vault_secret" "platform" {',
      ].join('\n')
    )
    expect(importables).toEqual([
      {
        address: 'azurerm_key_vault_secret.platform["access-encryption-key"]',
        ids: [
          'https://platform-development-kv2.vault.azure.net/secrets/access-encryption-key',
          'https://platform-development-kv2.vault.azure.net/secrets/access-encryption-key/a398d93c5bfe4a0dbf76361f05caf4e6',
        ],
      },
    ])
  })

  test('every resource the tool named is taken over', async () => {
    const provider = azureProvider([{ name: 'tenant_id', summary: 'the tenant', kind: 'given' }], {
      PATH: '',
    })
    // A plan that holds one resource of a hundred refuses the
    // hundredth one: every resource the tool named is taken over.
    const importables = provider.importablesOf?.(
      [
        'Error: a resource with the ID "https://the-vault.vault.azure.net/secrets/the-first/a398d93c5bfe4a0dbf76361f05caf4e6" already exists - to be managed via Terraform this resource needs to be imported into the State.',
        '',
        '  with azurerm_key_vault_secret.platform["the-first"],',
        '  on keyvault.tf line 76, in resource "azurerm_key_vault_secret" "platform":',
        '',
        'Error: a resource with the ID "https://the-vault.vault.azure.net/secrets/the-second/6f8b4c2d1e0a9b8c7d6e5f4a3b2c1d0e" already exists - to be managed via Terraform this resource needs to be imported into the State.',
        '',
        '  with azurerm_key_vault_secret.platform["the-second"],',
        '  on keyvault.tf line 76, in resource "azurerm_key_vault_secret" "platform":',
      ].join('\n')
    )
    expect(importables?.map((one) => one.address)).toEqual([
      'azurerm_key_vault_secret.platform["the-first"]',
      'azurerm_key_vault_secret.platform["the-second"]',
    ])
  })

  test('a failure that names no resource takes nothing over', async () => {
    const provider = azureProvider([{ name: 'tenant_id', summary: 'the tenant', kind: 'given' }], {
      PATH: '',
    })
    expect(provider.importablesOf?.('Error: something else went wrong')).toEqual([])
  })

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

  test('a role assignment that is already there is taken over', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-azure-'))
    try {
      const binary = join(directory, 'az')
      await writeFile(binary, CLIENT_WITH_ASSIGNMENT)
      await chmod(binary, 0o755)
      const provider = azureProvider(
        [{ name: 'tenant_id', summary: 'the tenant', kind: 'given' }],
        { PATH: process.env.PATH ?? '', AZURE_CLI: binary }
      )
      // The provider refuses to create a role assignment that is
      // already there, and it names the identifier of the assignment:
      // the assignment is found in the directory of the assignments of
      // the subscription, and the state of the deployment takes it
      // over.
      const leftover = await provider.leftoverOf?.(
        'Error: unexpected status 409 (409 Conflict) with error: RoleAssignmentExists: The role assignment already exists. The ID of the existing role assignment is a674fb9fae2f8e4474d87fe96527edf6.\n\n  with azurerm_role_assignment.state_data_owner[0],\n  on main.tf line 160'
      )
      expect(leftover?.name).toBe('azurerm_role_assignment.state_data_owner[0]')
      // The identifier of the assignment in the cloud carries the
      // dashes that the refusal of the provider does not, and it is the
      // identifier the import of the assignment takes.
      expect(leftover?.ids).toEqual([
        '/subscriptions/sub-1/resourceGroups/the-group/providers/Microsoft.Authorization/roleAssignments/a674fb9f-ae2f-8e44-74d8-7fe96527edf6',
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

/**
 * The certificate of the public names.
 *
 * The templates of the deployment write the public names as custom
 * domains of the gateway, and the provider of the infrastructure of
 * Azure writes them without a certificate: the certificate of a name
 * is bound by the client of Azure, and the environment of the container
 * apps issues it.
 */
describe('the certificate of the public names', () => {
  test('the provider binds the certificate of every public name of the deployment', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-certificate-'))
    try {
      const binary = join(directory, 'az')
      const calls = join(directory, 'calls')
      await writeFile(binary, CLIENT_BINDING(calls))
      await chmod(binary, 0o755)
      const provider = azureProvider([], { PATH: process.env.PATH ?? '', AZURE_CLI: binary })
      const notes = await provider.afterApply?.({
        values: { public_names_enabled: 'true' },
        outputs: {
          container_apps: { gateway: 'platform-production-gateway' },
          container_app_environment: 'platform-production-environment',
          resource_group_name: 'platform-production',
          public_names: { api: 'api.example.com', access: 'access.example.com' },
        },
      })
      expect(notes?.join('\n')).toContain(
        'the certificate of the name api.example.com is bound to the gateway'
      )
      expect(notes?.join('\n')).toContain(
        'the certificate of the name access.example.com is bound to the gateway'
      )

      // The client of Azure is told the names of the deployment and the
      // names of the resources of the deployment: the names are read in
      // the answers of the templates and not written in the code.
      const written = await readFile(calls, 'utf8')
      expect(written).toContain('--hostname api.example.com')
      expect(written).toContain('--hostname access.example.com')
      expect(written).toContain('--name platform-production-gateway')
      expect(written).toContain('--resource-group platform-production')
      expect(written).toContain('--environment platform-production-environment')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a deployment without public names binds no certificate', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-certificate-'))
    try {
      const binary = join(directory, 'az')
      const calls = join(directory, 'calls')
      await writeFile(binary, CLIENT_BINDING(calls))
      await chmod(binary, 0o755)
      const provider = azureProvider([], { PATH: process.env.PATH ?? '', AZURE_CLI: binary })
      const notes = await provider.afterApply?.({
        values: { public_names_enabled: 'false' },
        outputs: { public_names: { api: 'api.example.com' } },
      })
      // No name is bound, and the client of Azure is not asked for
      // anything: the deployment has no public name and no job of the
      // migration in its answers.
      expect(notes?.join('\n')).not.toContain('the certificate of the name')
      expect(notes?.join('\n')).toContain('the migration of the schema is not started')
      expect(existsSync(calls)).toBe(false)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('the provider reads the names of the deployment in the answers of the templates', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-certificate-'))
    try {
      const binary = join(directory, 'az')
      const calls = join(directory, 'calls')
      await writeFile(binary, CLIENT_BINDING(calls))
      await chmod(binary, 0o755)
      const provider = azureProvider([], { PATH: process.env.PATH ?? '', AZURE_CLI: binary })
      const notes = await provider.afterApply?.({
        // The values of the wizard hold no setting: the settings of the
        // deployment are the values of the templates, and the wizard
        // reads them in the answers of the templates.
        values: {},
        outputs: {
          container_apps: { gateway: 'platform-production-gateway' },
          container_app_environment: 'platform-production-environment',
          resource_group_name: 'platform-production',
          public_names: { api: 'api.example.com' },
          public_names_enabled: true,
        },
      })
      expect(notes?.join('\n')).toContain(
        'the certificate of the name api.example.com is bound to the gateway'
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a client that refuses is told what it refused', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-certificate-'))
    try {
      const binary = join(directory, 'az')
      await writeFile(binary, CLIENT_THAT_REFUSES)
      await chmod(binary, 0o755)
      const provider = azureProvider([], { PATH: process.env.PATH ?? '', AZURE_CLI: binary })
      const notes = await provider.afterApply?.({
        values: { public_names_enabled: 'true' },
        outputs: {
          container_apps: { gateway: 'platform-production-gateway' },
          container_app_environment: 'platform-production-environment',
          resource_group_name: 'platform-production',
          public_names: { api: 'api.example.com' },
        },
      })
      // The deployment is applied, and the binding is written again the
      // next time the deployment goes on: the refusal is told and not
      // thrown.
      expect(notes?.join('\n')).toContain(
        'the certificate of the name api.example.com is not bound'
      )
      expect(notes?.join('\n')).toContain(
        'Please configure the DNS records before adding the hostname.'
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

/**
 * The migration of the schema.
 *
 * The job of the migration creates the roles of the deployment, and the
 * services that read the database of the deployment do not start without
 * them: the provider starts the job when the deployment is applied.
 */
describe('the migration of the schema', () => {
  test('the provider starts the job of the migration of the deployment', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-migration-'))
    try {
      const binary = join(directory, 'az')
      const calls = join(directory, 'calls')
      await writeFile(binary, CLIENT_BINDING(calls))
      await chmod(binary, 0o755)
      const provider = azureProvider([], { PATH: process.env.PATH ?? '', AZURE_CLI: binary })
      const notes = await provider.afterApply?.({
        values: { public_names_enabled: 'true' },
        outputs: {
          container_apps: { gateway: 'platform-production-gateway' },
          container_app_environment: 'platform-production-environment',
          resource_group_name: 'platform-production',
          public_names: { api: 'api.example.com' },
          migration_job: 'platform-production-migrate',
        },
      })
      expect(notes?.join('\n')).toContain('the migration of the schema is started')

      // The client of Azure is told the name of the job and the name of
      // the group of the deployment: the names are read in the answers
      // of the templates and not written in the code.
      const written = await readFile(calls, 'utf8')
      expect(written).toContain('job start')
      expect(written).toContain('--name platform-production-migrate')
      expect(written).toContain('--resource-group platform-production')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a deployment without a job of the migration starts no job', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-migration-'))
    try {
      const binary = join(directory, 'az')
      const calls = join(directory, 'calls')
      await writeFile(binary, CLIENT_BINDING(calls))
      await chmod(binary, 0o755)
      const provider = azureProvider([], { PATH: process.env.PATH ?? '', AZURE_CLI: binary })
      const notes = await provider.afterApply?.({
        values: { public_names_enabled: 'false' },
        outputs: { resource_group_name: 'platform-production' },
      })
      expect(notes?.join('\n')).toContain('the migration of the schema is not started')
      expect(existsSync(calls)).toBe(false)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a client that refuses the job is told what it refused', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-migration-'))
    try {
      const binary = join(directory, 'az')
      await writeFile(binary, CLIENT_THAT_REFUSES_THE_JOB)
      await chmod(binary, 0o755)
      const provider = azureProvider([], { PATH: process.env.PATH ?? '', AZURE_CLI: binary })
      const notes = await provider.afterApply?.({
        values: { public_names_enabled: 'true' },
        outputs: {
          resource_group_name: 'platform-production',
          migration_job: 'platform-production-migrate',
        },
      })
      // The deployment is applied, and the job is started by hand: the
      // refusal is told and not thrown.
      expect(notes?.join('\n')).toContain('the migration of the schema is not started')
      expect(notes?.join('\n')).toContain('the job is not there')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

/**
 * The tenant of the deployment.
 *
 * The templates create the application of Access at Entra ID and its
 * secret, and they cannot register the tenant: the registration is a
 * call to the administration API of Access, and Access is a service of
 * the deployment that has to be up.
 */
describe('the tenant of the deployment', () => {
  test('the provider registers the tenant with the application of Entra ID', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-tenant-'))
    const real = globalThis.fetch
    try {
      const binary = join(directory, 'az')
      await writeFile(binary, CLIENT_BINDING(join(directory, 'calls')))
      await chmod(binary, 0o755)
      const calls: { url: string; body: unknown }[] = []
      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString()
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
        calls.push({ url, body })
        if (init?.method === 'POST') {
          return new Response(JSON.stringify({ id: '11111111-1111-4111-8111-111111111111' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        return new Response(
          JSON.stringify({
            tenants: [
              {
                id: '11111111-1111-4111-8111-111111111111',
                slug: 'acme',
                displayName: 'Acme Inc',
                emailDomain: 'acme.example',
                autoProvision: true,
                sharedClient: false,
                default: false,
                enabled: true,
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }) as typeof globalThis.fetch
      const provider = azureProvider([], { PATH: process.env.PATH ?? '', AZURE_CLI: binary })
      const notes = await provider.afterApply?.({
        values: {
          public_names_enabled: 'false',
          entra_tenant_enabled: 'true',
          access_tenant_id: '11111111-1111-4111-8111-111111111111',
          data_workspace_slug: 'acme',
        },
        outputs: {
          resource_group_name: 'platform-production',
          access_issuer: 'https://access.example.com',
          access_admin_token: 'the-token-of-the-administration',
          client_id: 'platform',
          client_secret: 'the-secret-of-the-client',
          client_redirect_uris: [
            'https://api.example.com/auth/callback',
            'https://console.example.com/auth/callback',
          ],
          entra_issuer:
            'https://login.microsoftonline.com/00000000-0000-0000-0000-000000000000/v2.0',
          entra_client_id: 'the-client-of-access-at-entra',
          entra_client_secret: 'the-secret-of-the-client-at-entra',
          entra_redirect_uri: 'https://access.example.com/oauth/tenant/callback',
        },
      })
      expect(notes?.join('\n')).toContain(
        'the tenant acme of the deployment is registered with the application of Access at Entra ID as its provider'
      )

      // The registration carries the application of Entra ID as the
      // provider of the tenant, and it keeps the flags of the tenant:
      // the auto-provisioning of the principals and the default of the
      // platform are the work of the operator of the platform.
      const written = calls.find((call) => call.body !== undefined)
      expect(written?.url).toBe('https://access.example.com/v1/admin/tenants')
      expect(written?.body).toMatchObject({
        slug: 'acme',
        displayName: 'Acme Inc',
        issuer: 'https://login.microsoftonline.com/00000000-0000-0000-0000-000000000000/v2.0',
        idpClientId: 'the-client-of-access-at-entra',
        idpClientSecret: 'the-secret-of-the-client-at-entra',
        idpRedirectUri: 'https://access.example.com/oauth/tenant/callback',
        idpScopes: ['openid', 'profile', 'email'],
        clientId: 'platform',
        clientSecret: 'the-secret-of-the-client',
        clientRedirectUris: [
          'https://api.example.com/auth/callback',
          'https://console.example.com/auth/callback',
        ],
        autoProvision: true,
        sharedClient: false,
        default: false,
        enabled: true,
      })
    } finally {
      globalThis.fetch = real
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a tenant that has a provider of its own keeps it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-tenant-'))
    const real = globalThis.fetch
    try {
      const binary = join(directory, 'az')
      await writeFile(binary, CLIENT_BINDING(join(directory, 'calls')))
      await chmod(binary, 0o755)
      const calls: { url: string; body: unknown }[] = []
      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString()
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
        calls.push({ url, body })
        if (init?.method === 'POST') {
          return new Response(JSON.stringify({ id: '11111111-1111-4111-8111-111111111111' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        return new Response(
          JSON.stringify({
            tenants: [
              {
                id: '11111111-1111-4111-8111-111111111111',
                slug: 'acme',
                displayName: 'Acme Inc',
                issuer: 'https://login.acme.example',
                emailDomain: 'acme.example',
                autoProvision: true,
                sharedClient: false,
                default: false,
                enabled: true,
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }) as typeof globalThis.fetch
      const provider = azureProvider([], { PATH: process.env.PATH ?? '', AZURE_CLI: binary })
      const notes = await provider.afterApply?.({
        values: {
          public_names_enabled: 'false',
          entra_tenant_enabled: 'true',
          access_tenant_id: '11111111-1111-4111-8111-111111111111',
          data_workspace_slug: 'acme',
        },
        outputs: {
          resource_group_name: 'platform-production',
          access_issuer: 'https://access.example.com',
          access_admin_token: 'the-token-of-the-administration',
          client_id: 'platform',
          client_secret: 'the-secret-of-the-client',
          client_redirect_uris: ['https://api.example.com/auth/callback'],
          entra_issuer:
            'https://login.microsoftonline.com/00000000-0000-0000-0000-000000000000/v2.0',
          entra_client_id: 'the-client-of-access-at-entra',
          entra_client_secret: 'the-secret-of-the-client-at-entra',
          entra_redirect_uri: 'https://access.example.com/oauth/tenant/callback',
        },
      })
      // The provider of the deployment belongs to the tenant the
      // deployment creates: a tenant that has a provider of its own
      // keeps it, and the deployment takes no provider back.
      expect(notes?.join('\n')).toContain(
        'the tenant acme of the deployment keeps the provider of its identity it has: https://login.acme.example'
      )
      const written = calls.find((call) => call.body !== undefined)
      expect(written?.body).not.toHaveProperty('issuer')
      expect(written?.body).not.toHaveProperty('idpClientId')
      expect(written?.body).not.toHaveProperty('idpClientSecret')
      expect(written?.body).not.toHaveProperty('idpRedirectUri')
      expect(written?.body).not.toHaveProperty('idpScopes')
      // The client of the tenant is the work of the deployment, and it
      // is written again.
      expect(written?.body).toMatchObject({
        slug: 'acme',
        displayName: 'Acme Inc',
        clientId: 'platform',
        clientSecret: 'the-secret-of-the-client',
        clientRedirectUris: ['https://api.example.com/auth/callback'],
      })
    } finally {
      globalThis.fetch = real
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a deployment whose tenant has another provider registers no tenant', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-tenant-'))
    const real = globalThis.fetch
    try {
      const binary = join(directory, 'az')
      await writeFile(binary, CLIENT_BINDING(join(directory, 'calls')))
      await chmod(binary, 0o755)
      let asked = false
      globalThis.fetch = (async (_input: string | URL | Request, _init?: RequestInit) => {
        asked = true
        return new Response('{}', { status: 200 })
      }) as typeof globalThis.fetch
      const provider = azureProvider([], { PATH: process.env.PATH ?? '', AZURE_CLI: binary })
      const notes = await provider.afterApply?.({
        values: { public_names_enabled: 'false', entra_tenant_enabled: 'false' },
        outputs: {
          resource_group_name: 'platform-production',
          access_issuer: 'https://access.example.com',
          access_admin_token: 'the-token-of-the-administration',
          entra_issuer:
            'https://login.microsoftonline.com/00000000-0000-0000-0000-000000000000/v2.0',
          entra_client_id: 'the-client-of-access-at-entra',
          entra_client_secret: 'the-secret-of-the-client-at-entra',
          entra_redirect_uri: 'https://access.example.com/oauth/tenant/callback',
        },
      })
      // The application of Entra ID is not there, and the tenant is
      // the work of the operator.
      expect(asked).toBe(false)
      expect(notes?.join('\n')).not.toContain('is registered with the application of Access')
    } finally {
      globalThis.fetch = real
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a tenant that is not there is created, and its identifier is written in the values', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-tenant-'))
    const real = globalThis.fetch
    try {
      const binary = join(directory, 'az')
      await writeFile(binary, CLIENT_BINDING(join(directory, 'calls')))
      await chmod(binary, 0o755)
      const file = join(directory, 'terraform.tfvars')
      await writeFile(
        file,
        '# The values of the deployment.\n\naccess_tenant_id = "11111111-1111-4111-8111-111111111111"\n'
      )
      const calls: { body: unknown }[] = []
      globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
        if (init?.method === 'POST') {
          calls.push({ body })
          return new Response(
            JSON.stringify({ id: '22222222-2222-4222-8222-222222222222', slug: 'acme' }),
            { status: 201, headers: { 'content-type': 'application/json' } }
          )
        }
        return new Response(JSON.stringify({ tenants: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }) as typeof globalThis.fetch
      const provider = azureProvider([], { PATH: process.env.PATH ?? '', AZURE_CLI: binary })
      const notes = await provider.afterApply?.({
        values: {
          public_names_enabled: 'false',
          entra_tenant_enabled: 'true',
          access_tenant_id: '11111111-1111-4111-8111-111111111111',
          data_workspace_slug: 'acme',
        },
        outputs: {
          resource_group_name: 'platform-production',
          access_issuer: 'https://access.example.com',
          access_admin_token: 'the-token-of-the-administration',
          client_id: 'platform',
          client_secret: 'the-secret-of-the-client',
          client_redirect_uris: ['https://api.example.com/auth/callback'],
          entra_issuer:
            'https://login.microsoftonline.com/00000000-0000-0000-0000-000000000000/v2.0',
          entra_client_id: 'the-client-of-access-at-entra',
          entra_client_secret: 'the-secret-of-the-client-at-entra',
          entra_redirect_uri: 'https://access.example.com/oauth/tenant/callback',
        },
        file,
      })
      expect(notes?.join('\n')).toContain(
        'the tenant acme of the deployment is registered with the application of Access at Entra ID as its provider'
      )

      // The tenant of a deployment is created with the slug of the
      // workspace of the deployment, and it is created with the
      // provider of the deployment.
      expect(calls[0]?.body).toMatchObject({
        slug: 'acme',
        displayName: 'acme',
        issuer: 'https://login.microsoftonline.com/00000000-0000-0000-0000-000000000000/v2.0',
        idpClientId: 'the-client-of-access-at-entra',
      })

      // The identifier of the tenant is the scope of the access context
      // of the deployment, and the values of the deployment name it.
      const values = await readFile(file, 'utf8')
      expect(values).toContain('access_tenant_id = "22222222-2222-4222-8222-222222222222"')
      expect(notes?.join('\n')).toContain(
        'the identifier of the tenant 22222222-2222-4222-8222-222222222222 is written in the file of the values'
      )
    } finally {
      globalThis.fetch = real
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('the provider reads the slug of the workspace in the answers of the templates', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-tenant-'))
    const real = globalThis.fetch
    try {
      const binary = join(directory, 'az')
      await writeFile(binary, CLIENT_BINDING(join(directory, 'calls')))
      await chmod(binary, 0o755)
      const calls: { body: unknown; authorization: string }[] = []
      globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
        const headers = (init?.headers ?? {}) as Record<string, string>
        if (init?.method === 'POST') {
          calls.push({ body, authorization: headers.authorization ?? '' })
          return new Response(
            JSON.stringify({ id: '22222222-2222-4222-8222-222222222222', slug: 'esquire' }),
            { status: 201, headers: { 'content-type': 'application/json' } }
          )
        }
        return new Response(JSON.stringify({ tenants: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }) as typeof globalThis.fetch
      const provider = azureProvider([], { PATH: process.env.PATH ?? '', AZURE_CLI: binary })
      const notes = await provider.afterApply?.({
        // The values of the wizard hold no slug: the wizard collects the
        // values it asks for, and the slug of the workspace is a value
        // of the templates.
        values: { public_names_enabled: 'false' },
        outputs: {
          resource_group_name: 'platform-production',
          access_issuer: 'https://access.example.com',
          access_admin_token: 'the-token-of-the-administration',
          client_id: 'platform',
          client_secret: 'the-secret-of-the-client',
          client_redirect_uris: ['https://api.example.com/auth/callback'],
          access_tenant_id: '11111111-1111-4111-8111-111111111111',
          data_workspace_slug: 'esquire',
          tenant_auto_provision: true,
          entra_tenant_enabled: true,
          entra_issuer:
            'https://login.microsoftonline.com/00000000-0000-0000-0000-000000000000/v2.0',
          entra_client_id: 'the-client-of-access-at-entra',
          entra_client_secret: 'the-secret-of-the-client-at-entra',
          entra_redirect_uri: 'https://access.example.com/oauth/tenant/callback',
        },
      })
      expect(notes?.join('\n')).toContain(
        'the tenant esquire of the deployment is registered with the application of Access at Entra ID as its provider'
      )
      expect(calls[0]?.body).toMatchObject({ slug: 'esquire' })
      // The tenant of the deployment provisions the identities that sign
      // in: the operator of the deployment is the first one to sign in,
      // and the principal it needs is created at that login.
      expect(calls[0]?.body).toMatchObject({ autoProvision: true })
      // The wizard presents the token of the administration of Access:
      // the outputs of the deployment carry the credentials it needs,
      // and a credential that is held back is a refusal it cannot read.
      expect(calls[0]?.authorization).toBe('Bearer the-token-of-the-administration')
    } finally {
      globalThis.fetch = real
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a deployment whose tenant provisions no identity registers no principal', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-tenant-'))
    const real = globalThis.fetch
    try {
      const binary = join(directory, 'az')
      await writeFile(binary, CLIENT_BINDING(join(directory, 'calls')))
      await chmod(binary, 0o755)
      const calls: { body: unknown }[] = []
      globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
        if (init?.method === 'POST') {
          calls.push({ body })
          return new Response(
            JSON.stringify({ id: '22222222-2222-4222-8222-222222222222', slug: 'esquire' }),
            { status: 201, headers: { 'content-type': 'application/json' } }
          )
        }
        return new Response(JSON.stringify({ tenants: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }) as typeof globalThis.fetch
      const provider = azureProvider([], { PATH: process.env.PATH ?? '', AZURE_CLI: binary })
      await provider.afterApply?.({
        values: { public_names_enabled: 'false' },
        outputs: {
          resource_group_name: 'platform-production',
          access_issuer: 'https://access.example.com',
          access_admin_token: 'the-token-of-the-administration',
          client_id: 'platform',
          client_secret: 'the-secret-of-the-client',
          client_redirect_uris: ['https://api.example.com/auth/callback'],
          access_tenant_id: '11111111-1111-4111-8111-111111111111',
          data_workspace_slug: 'esquire',
          // The deployment says the tenant provisions no identity: the
          // people of the tenant are registered by hand.
          tenant_auto_provision: false,
          entra_tenant_enabled: true,
          entra_issuer:
            'https://login.microsoftonline.com/00000000-0000-0000-0000-000000000000/v2.0',
          entra_client_id: 'the-client-of-access-at-entra',
          entra_client_secret: 'the-secret-of-the-client-at-entra',
          entra_redirect_uri: 'https://access.example.com/oauth/tenant/callback',
        },
      })
      expect(calls[0]?.body).toMatchObject({ autoProvision: false })
    } finally {
      globalThis.fetch = real
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a deployment whose tenant hands its administration to its first identity says so', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-tenant-'))
    const real = globalThis.fetch
    try {
      const binary = join(directory, 'az')
      await writeFile(binary, CLIENT_BINDING(join(directory, 'calls')))
      await chmod(binary, 0o755)
      const calls: { body: unknown }[] = []
      globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
        if (init?.method === 'POST') {
          calls.push({ body })
          return new Response(
            JSON.stringify({ id: '22222222-2222-4222-8222-222222222222', slug: 'esquire' }),
            { status: 201, headers: { 'content-type': 'application/json' } }
          )
        }
        return new Response(JSON.stringify({ tenants: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }) as typeof globalThis.fetch
      const provider = azureProvider([], { PATH: process.env.PATH ?? '', AZURE_CLI: binary })
      await provider.afterApply?.({
        values: { public_names_enabled: 'false' },
        outputs: {
          resource_group_name: 'platform-production',
          access_issuer: 'https://access.example.com',
          access_admin_token: 'the-token-of-the-administration',
          client_id: 'platform',
          client_secret: 'the-secret-of-the-client',
          client_redirect_uris: ['https://api.example.com/auth/callback'],
          access_tenant_id: '11111111-1111-4111-8111-111111111111',
          data_workspace_slug: 'esquire',
          // The deployment says the first identity that signs in
          // administers the tenant of the deployment.
          tenant_auto_provision: true,
          tenant_auto_provision_admin: true,
          entra_tenant_enabled: true,
          entra_issuer:
            'https://login.microsoftonline.com/00000000-0000-0000-0000-000000000000/v2.0',
          entra_client_id: 'the-client-of-access-at-entra',
          entra_client_secret: 'the-secret-of-the-client-at-entra',
          entra_redirect_uri: 'https://access.example.com/oauth/tenant/callback',
        },
      })
      expect(calls[0]?.body).toMatchObject({
        autoProvision: true,
        autoProvisionAdmin: true,
      })
    } finally {
      globalThis.fetch = real
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a deployment whose templates name no tenant of Entra ID registers no tenant', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-tenant-'))
    const real = globalThis.fetch
    try {
      const binary = join(directory, 'az')
      await writeFile(binary, CLIENT_BINDING(join(directory, 'calls')))
      await chmod(binary, 0o755)
      let asked = false
      globalThis.fetch = (async (_input: string | URL | Request, _init?: RequestInit) => {
        asked = true
        return new Response('{}', { status: 200 })
      }) as typeof globalThis.fetch
      const provider = azureProvider([], { PATH: process.env.PATH ?? '', AZURE_CLI: binary })
      const notes = await provider.afterApply?.({
        values: { public_names_enabled: 'false' },
        outputs: {
          resource_group_name: 'platform-production',
          access_issuer: 'https://access.example.com',
          access_admin_token: 'the-token-of-the-administration',
          client_id: 'platform',
          client_secret: 'the-secret-of-the-client',
          client_redirect_uris: ['https://api.example.com/auth/callback'],
          access_tenant_id: '11111111-1111-4111-8111-111111111111',
          data_workspace_slug: 'esqads',
          // The application of Access at Entra ID is not there: the
          // tenant is the work of the operator.
          entra_tenant_enabled: false,
        },
      })
      expect(asked).toBe(false)
      expect(notes?.join('\n')).not.toContain('is registered with the application of Access')
    } finally {
      globalThis.fetch = real
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('an administration of Access that does not answer is waited for', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-tenant-'))
    const real = globalThis.fetch
    try {
      const binary = join(directory, 'az')
      await writeFile(binary, CLIENT_BINDING(join(directory, 'calls')))
      await chmod(binary, 0o755)
      let asked = 0
      globalThis.fetch = (async (_input: string | URL | Request, _init?: RequestInit) => {
        asked++
        return new Response('the gateway timed out', { status: 504 })
      }) as typeof globalThis.fetch
      const provider = azureProvider(
        [],
        { PATH: process.env.PATH ?? '', AZURE_CLI: binary },
        { attempts: 3, intervalMs: 1, callMs: 1 }
      )
      const notes = await provider.afterApply?.({
        values: {
          public_names_enabled: 'false',
          entra_tenant_enabled: 'true',
          access_tenant_id: '11111111-1111-4111-8111-111111111111',
          data_workspace_slug: 'acme',
        },
        outputs: {
          resource_group_name: 'platform-production',
          access_issuer: 'https://access.example.com',
          access_admin_token: 'the-token-of-the-administration',
          entra_issuer:
            'https://login.microsoftonline.com/00000000-0000-0000-0000-000000000000/v2.0',
          entra_client_id: 'the-client-of-access-at-entra',
          entra_client_secret: 'the-secret-of-the-client-at-entra',
          entra_redirect_uri: 'https://access.example.com/oauth/tenant/callback',
        },
      })
      // The wizard waits for Access: Access is a service of the
      // deployment, and it cannot answer before the job of the
      // migration has created the roles of the deployment.
      expect(asked).toBe(3)
      expect(notes?.join('\n')).toContain(
        'the administration of Access did not answer, and the tenant is registered by hand'
      )
    } finally {
      globalThis.fetch = real
      await rm(directory, { recursive: true, force: true })
    }
  })
})

/**
 * The client of Azure, as the tests answer with it.
 *
 * The client writes the words of the commands it is given in a file of
 * the test: the test reads them and knows what the provider told the
 * client of Azure to do.
 *
 * @param calls the file the client writes its commands in.
 */
const CLIENT_BINDING = (calls: string) => `#!/bin/sh
case "$1 $2" in
  "containerapp hostname"|"containerapp job") echo "$@" >> "${calls}" ;;
esac
exit 0
`

/**
 * The client of Azure, when it refuses to bind the certificate of a
 * name.
 *
 * The client refuses the way it refuses when the records of DNS of the
 * name are not in place yet.
 */
const CLIENT_THAT_REFUSES = `#!/bin/sh
case "$1 $2" in
  "containerapp hostname")
    echo "Please configure the DNS records before adding the hostname." >&2
    exit 1
    ;;
esac
exit 0
`

/**
 * The client of Azure, when it refuses to start the job of the
 * migration.
 *
 * The client refuses the way it refuses when the job of the migration
 * is not there.
 */
const CLIENT_THAT_REFUSES_THE_JOB = `#!/bin/sh
case "$1 $2" in
  "containerapp job")
    echo "the job is not there" >&2
    exit 1
    ;;
esac
exit 0
`

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

/**
 * The templates of the checkout and the images of the release.
 *
 * The images of a release read the documents the templates write, and
 * the wizard refuses to run the images of a release with the templates
 * of another commit. The refusal is right when the documents changed:
 * the images would read a document they do not know. A commit that
 * writes the same documents is a commit the images know.
 */

/** The templates of a deployment, with the documents the images read. */
const DOCUMENTS = [
  '# The route table of the deployment.',
  'locals {',
  '  gateway_route_table = {',
  '    version = 2',
  '    hosts   = [local.gateway_hostname]',
  '    routes  = [',
  '      {',
  '        id       = var.route_id',
  `        upstream = "http://\${local.data_fqdn}"`,
  '      }',
  '    ]',
  '  }',
  '}',
  '',
  '# The secrets of the deployment.',
  'locals {',
  '  secret_names = toset([',
  '    "gateway-routes",',
  '  ])',
  '}',
  '',
].join('\n')

/** The environment of the services, with the documents the images read. */
const ENVIRONMENT = [
  'locals {',
  '  gateway_secret_files = [',
  '    "gateway-routes",',
  '  ]',
  '',
  '  gateway_env_secrets = {',
  '    GATEWAY_SESSION_SECRET = "gateway-session-secret"',
  '  }',
  '}',
  '',
].join('\n')

/**
 * A repository with the templates of a deployment and the tag of the
 * release of the platform.
 *
 * @param directory the directory of the repository.
 */
async function repositoryOf(directory: string): Promise<string> {
  const templates = join(directory, 'deploy', 'tofu', 'azure')
  await mkdir(templates, { recursive: true })
  await bootstrapOf(templates)
  await writeFile(join(templates, 'terraform.tfvars.example'), EXAMPLE)
  await writeFile(join(templates, 'locals.tf'), DOCUMENTS)
  await writeFile(join(templates, 'containerapps.tf'), ENVIRONMENT)
  const git = (...args: string[]): void => {
    const answer = spawnSync('git', args, { cwd: directory, stdio: 'ignore' })
    if (answer.status !== 0) throw new Error(`git ${args.join(' ')} failed`)
  }
  git('init', '--quiet')
  git('config', 'user.email', 'operator@example.com')
  git('config', 'user.name', 'the operator')
  git('add', '.')
  git('commit', '--quiet', '--message', 'the templates')
  git('tag', `v${VERSION}`)
  return templates
}

/**
 * The release of the platform, as the tests answer with it.
 *
 * The release the wizard reads is the release of the line of the CLI:
 * the wizard pairs the images of a release with the templates of a
 * release, and a release of another line is a release it cannot prove
 * anything about. The answer is the release of the version of the CLI,
 * and the version moves with the commit: the tests do not read the
 * release of the repository, and they do not fail when a release is
 * published.
 *
 * @returns the fetch that answers with the release.
 */
function releasing(): typeof globalThis.fetch {
  const tag = `v${VERSION}`
  const digests = {
    version: VERSION,
    tag,
    registry: 'ghcr.io/ggpwnkthx',
    images: {
      gateway: `ghcr.io/ggpwnkthx/gateway@sha256:${'1'.repeat(64)}`,
      access: `ghcr.io/ggpwnkthx/access@sha256:${'2'.repeat(64)}`,
      data: `ghcr.io/ggpwnkthx/data@sha256:${'3'.repeat(64)}`,
      console: `ghcr.io/ggpwnkthx/console@sha256:${'4'.repeat(64)}`,
    },
  }
  return (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString()
    if (url.endsWith('/releases/latest')) {
      return new Response(JSON.stringify({ tag_name: tag }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (url.endsWith(`/${tag}/digests.json`)) {
      return new Response(JSON.stringify(digests), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response('not found', { status: 404 })
  }) as typeof globalThis.fetch
}

/**
 * The release of the platform, as the tests answer with it.
 *
 * The wizard reads the release of the platform from the repository of
 * the releases, and the tests do not read the repository: they answer
 * with the release of the line of the CLI. The wizard pairs the images
 * of a release with the templates of a release, and a release of
 * another line is a release it cannot prove anything about: a test
 * that read the repository would fail the day a release is published,
 * and the day before it.
 */
const realFetch = globalThis.fetch

beforeAll(() => {
  globalThis.fetch = releasing()
})

afterAll(() => {
  globalThis.fetch = realFetch
})

describe('the templates of the checkout and the images of the release', () => {
  test('the deployment runs when the documents the images read did not change', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-templates-'))
    const real = globalThis.fetch
    try {
      const templates = await repositoryOf(directory)
      const runtime = join(directory, 'runtime')
      // The templates of the checkout are ahead of the tag of the
      // release, and they write the documents of the release: the
      // deployment runs the images of the release with them.
      await writeFile(join(templates, 'locals.tf'), `${DOCUMENTS}\n# A comment.\n`)
      globalThis.fetch = releasing()
      const provider = providerOf([
        { name: 'name_prefix', summary: 'the prefix of the names', kind: 'chosen' },
      ])
      const tool = new FakeInfrastructure()
      tool.plan_ = {
        directory: templates,
        changes: [],
        drift: [],
        summary: { create: 0, update: 0, delete: 0, replace: 0 },
        errored: false,
        planFile: join(runtime, 'plan.bin'),
      }
      const { runtime: cli, progress } = runtimeOf([provider], tool)
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
      expect(progress.join('\n')).toContain(
        `the templates of the checkout are ahead of the release v${VERSION}`
      )
    } finally {
      globalThis.fetch = real
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('the deployment is refused when the documents the images read changed', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-templates-'))
    const real = globalThis.fetch
    try {
      const templates = await repositoryOf(directory)
      const runtime = join(directory, 'runtime')
      await writeFile(join(templates, 'locals.tf'), DOCUMENTS.replace('version = 2', 'version = 3'))
      globalThis.fetch = releasing()
      const provider = providerOf([
        { name: 'name_prefix', summary: 'the prefix of the names', kind: 'chosen' },
      ])
      const { runtime: cli } = runtimeOf([provider])
      const refusal = await run(cli, [
        'deploy',
        'azure',
        '--yes',
        '--directory',
        templates,
        '--runtime',
        runtime,
        '--answers',
        await answersFileOf(directory, 'name_prefix = "platform"\n'),
      ]).catch((error: unknown) => error)
      expect(refusal).toBeInstanceOf(CliFailure)
      expect((refusal as CliFailure).message).toContain(
        'the route table the templates write is not the one of the release'
      )
      expect((refusal as CliFailure).exit).toBe(5)
    } finally {
      globalThis.fetch = real
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('the deployment runs when the address of a service changed', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-templates-'))
    const real = globalThis.fetch
    try {
      const templates = await repositoryOf(directory)
      const runtime = join(directory, 'runtime')
      // The address of a service is a value of the deployment: the
      // templates of the checkout write another address and the same
      // document, and the images of the release read the address they
      // are given.
      await writeFile(
        join(templates, 'locals.tf'),
        DOCUMENTS.replace('local.data_fqdn', 'local.data_address')
      )
      globalThis.fetch = releasing()
      const provider = providerOf([
        { name: 'name_prefix', summary: 'the prefix of the names', kind: 'chosen' },
      ])
      const tool = new FakeInfrastructure()
      tool.plan_ = {
        directory: templates,
        changes: [],
        drift: [],
        summary: { create: 0, update: 0, delete: 0, replace: 0 },
        errored: false,
        planFile: join(runtime, 'plan.bin'),
      }
      const { runtime: cli, progress } = runtimeOf([provider], tool)
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
      expect(progress.join('\n')).toContain(
        `the templates of the checkout are ahead of the release v${VERSION}`
      )
    } finally {
      globalThis.fetch = real
      await rm(directory, { recursive: true, force: true })
    }
  })
})
