import { describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run, type CliRuntime } from '../src/app/cli'
import type { Services } from '../src/app/commands'
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
import { deployCommand } from '../src/runtime/commands/deploy'
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
function servicesOf(): Services {
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
    infrastructure: new FakeInfrastructure(),
    files: { profiles: '/tmp/profiles.json', credentials: '/tmp/credentials.json' },
  }
}

/** The runtime of the tests. */
function runtimeOf(commands: Parameters<typeof deployCommand>[0][]): {
  runtime: CliRuntime
  out: string[]
  err: string[]
} {
  const out: string[] = []
  const err: string[] = []
  return {
    out,
    err,
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
      environment: {},
      services: () => servicesOf(),
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
      'gateway_image is not a digest: the deployment runs the bytes that the release proved',
    ])
  })

  test('an identifier that is not an identifier is refused', () => {
    expect(
      problemsOf(questions, {
        gateway_image: `ghcr.io/ggpwnkthx/gateway@sha256:${'1'.repeat(64)}`,
        access_tenant_id: 'acme',
      })
    ).toEqual(['access_tenant_id is not an identifier'])
  })

  test('a question that is needed and unanswered is refused', () => {
    expect(problemsOf(questions, {})).toEqual([
      'gateway_image is needed',
      'access_tenant_id is needed',
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

describe('the wizard of a deployment', () => {
  test('the wizard writes the file of the values and tells the operator what to do', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-wizard-'))
    try {
      const templates = join(directory, 'templates')
      const runtime = join(directory, 'runtime')
      await mkdir(templates, { recursive: true })
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
      const { runtime: cli, out } = runtimeOf([provider])
      const status = await run(cli, [
        'deploy',
        'azure',
        '--directory',
        templates,
        '--runtime',
        runtime,
        '--answers',
        await answersFileOf(
          directory,
          'name_prefix = "platform"\ngateway_hostname = "api.example.com"\n'
        ),
      ])
      expect(status).toBe(0)
      expect(out.join('\n')).toContain('signed in to Azure as the-subscription')

      const file = await readFile(join(runtime, 'terraform.tfvars'), 'utf8')
      expect(file).toContain('name_prefix = "platform"')
      expect(file).toContain('gateway_hostname = "api.example.com"')
      expect(file).toContain('tenant_id = "11111111-1111-4111-8111-111111111111"')

      expect(out.join('\n')).toContain('create the place where the state of the deployment lives')
      expect(out.join('\n')).toContain('platformctl infra plan')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('the files of the deployment live next to the templates, not next to the reader', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-wizard-'))
    try {
      const templates = join(directory, 'deploy', 'tofu', 'azure')
      await mkdir(templates, { recursive: true })
      await writeFile(join(templates, 'terraform.tfvars.example'), EXAMPLE)

      const provider = providerOf([
        { name: 'environment', summary: 'the environment', kind: 'chosen' },
      ])
      const { runtime: cli } = runtimeOf([provider])
      const status = await run(cli, [
        'deploy',
        'azure',
        '--directory',
        templates,
        '--answers',
        await answersFileOf(directory, 'environment = "staging"\n'),
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
      await mkdir(templates, { recursive: true })
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
})

/** A file of the answers of the operator. */
async function answersFileOf(directory: string, content: string): Promise<string> {
  const file = join(directory, `answers-${Math.random().toString(36).slice(2)}.tfvars`)
  await writeFile(file, content)
  return file
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
  "account show") echo '{"id":"sub-1","name":"the-subscription","tenantId":"11111111-1111-4111-8111-111111111111"}' ;;
  "account list") echo '[{"id":"sub-1","name":"the-subscription","tenantId":"11111111-1111-4111-8111-111111111111"}]' ;;
  *) exit 0 ;;
esac
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
})
