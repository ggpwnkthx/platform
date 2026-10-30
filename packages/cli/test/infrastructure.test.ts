import { describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run, type CliRuntime } from '../src/app/cli'
import type { Services } from '../src/app/commands'
import {
  actionOf,
  changesNothing,
  destroys,
  isTooOld,
  summaryOf,
} from '../src/domains/infrastructure'
import { isSensitive, redact, TofuInfrastructure } from '../src/platform/tofu'
import { infrastructureGroup } from '../src/runtime/commands/infrastructure'
import { FakeInfrastructure } from './support'

/**
 * The infrastructure of the deployment.
 *
 * The deployment is written in OpenTofu, and the CLI drives the tool.
 * The tests prove that the CLI decides nothing: it shows what the tool
 * decided, it applies the plan it showed, and it holds a credential
 * back.
 */

/** The services of the tests. */
function servicesOf(tool: FakeInfrastructure): Services {
  return {
    http: {
      send: async () => {
        throw new Error('the commands of the infrastructure do not talk to a service')
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
  }
}

/** The runtime of the tests. */
function runtimeOf(tool: FakeInfrastructure): {
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
      groups: [infrastructureGroup],
      environment: {},
      services: () => servicesOf(tool),
      contextOf: async () => ({ name: 'default' }),
      out: (text) => out.push(text),
      err: (text) => err.push(text),
    },
  }
}

/** A directory of the files of a deployment. */
async function runtimeDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'platformctl-infra-'))
  await mkdir(join(directory, 'templates'), { recursive: true })
  await writeFile(join(directory, 'terraform.tfvars'), 'name_prefix = "platform"\n')
  return directory
}

describe('the meaning of a plan', () => {
  test('the actions of the tool are read', () => {
    expect(actionOf(['create'])).toBe('create')
    expect(actionOf(['update'])).toBe('update')
    expect(actionOf(['delete'])).toBe('delete')
    expect(actionOf(['read'])).toBe('read')
    expect(actionOf(['no-op'])).toBe('no-op')
    expect(actionOf([])).toBe('no-op')
  })

  test('a change that destroys a resource and creates another one is a replacement', () => {
    expect(actionOf(['delete', 'create'])).toBe('replace')
    expect(actionOf(['create', 'delete'])).toBe('replace')
  })

  test('what a plan does is counted', () => {
    const summary = summaryOf([
      { address: 'a', action: 'create', kind: 'k', name: 'a', provider: 'p' },
      { address: 'b', action: 'update', kind: 'k', name: 'b', provider: 'p' },
      { address: 'c', action: 'delete', kind: 'k', name: 'c', provider: 'p' },
      { address: 'd', action: 'replace', kind: 'k', name: 'd', provider: 'p' },
    ])
    expect(summary).toEqual({ create: 1, update: 1, delete: 1, replace: 1 })
  })

  test('a plan that changes nothing is not a failure', () => {
    const plan = {
      directory: '/templates',
      changes: [],
      drift: [],
      summary: { create: 0, update: 0, delete: 0, replace: 0 },
      errored: false,
    }
    expect(changesNothing(plan)).toBe(true)
    expect(destroys(plan)).toBe(false)
  })

  test('a plan that destroys something is told apart', () => {
    const plan = {
      directory: '/templates',
      changes: [{ address: 'a', action: 'replace' as const, kind: 'k', name: 'a', provider: 'p' }],
      drift: [],
      summary: { create: 0, update: 0, delete: 0, replace: 1 },
      errored: false,
    }
    expect(destroys(plan)).toBe(true)
  })

  test('the version of the tool is read against the version the templates need', () => {
    expect(isTooOld('1.8.0', '1.9.0')).toBe(true)
    expect(isTooOld('1.9.0', '1.9.0')).toBe(false)
    expect(isTooOld('1.13.2', '1.9.0')).toBe(false)
    expect(isTooOld('2.0.0', '1.9.0')).toBe(false)
    expect(isTooOld('1.9.1', '1.9.0')).toBe(false)
  })
})

describe('the credentials of the outputs', () => {
  test('a name that carries a credential is held back', () => {
    expect(isSensitive('access_admin_token')).toBe(true)
    expect(isSensitive('gateway_client_secret')).toBe(true)
    expect(isSensitive('data_access_context_token')).toBe(true)
    expect(isSensitive('console_session_secret')).toBe(true)
  })

  test('a name that carries nothing is not held back', () => {
    expect(isSensitive('gateway_url')).toBe(false)
    expect(isSensitive('resource_group_name')).toBe(false)
    expect(isSensitive('identity_signing_public_key')).toBe(false)
    expect(isSensitive('postgres_host')).toBe(false)
  })

  test('the value of a credential never reaches the answer', () => {
    expect(
      redact({
        gateway_url: 'https://api.example.com',
        access_admin_token: 'the-token-of-the-deployment',
        nested: { console_client_secret: 'the-secret-of-the-console' },
      })
    ).toEqual({
      gateway_url: 'https://api.example.com',
      access_admin_token: '(sensitive value)',
      nested: { console_client_secret: '(sensitive value)' },
    })
  })
})

describe('the commands of the infrastructure', () => {
  test('the plan of the deployment is shown and nothing is applied', async () => {
    const tool = new FakeInfrastructure()
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
    const { runtime, out } = runtimeOf(tool)
    const directory = await runtimeDirectory()
    try {
      const status = await run(runtime, [
        'infra',
        'plan',
        '--directory',
        join(directory, 'templates'),
        '--runtime',
        directory,
      ])
      expect(status).toBe(0)
      expect(out.join('\n')).toContain('azurerm_resource_group.platform')
      expect(tool.applied).toEqual([])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a tool that is too old for the templates is refused', async () => {
    const tool = new FakeInfrastructure()
    tool.toolVersion = '1.8.0'
    const { runtime } = runtimeOf(tool)
    const directory = await runtimeDirectory()
    try {
      await expect(
        run(runtime, [
          'infra',
          'plan',
          '--directory',
          join(directory, 'templates'),
          '--runtime',
          directory,
        ])
      ).rejects.toThrow('the tool that writes the infrastructure is too old')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('the apply applies the plan that was shown', async () => {
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
      planFile: '/runtime/plan.bin',
    }
    const { runtime, out } = runtimeOf(tool)
    const directory = await runtimeDirectory()
    try {
      const status = await run(runtime, [
        'infra',
        'apply',
        '--yes',
        '--directory',
        join(directory, 'templates'),
        '--runtime',
        directory,
      ])
      expect(status).toBe(0)
      expect(out.join('\n')).toContain('azurerm_key_vault.platform')
      expect(tool.applied).toHaveLength(1)
      expect(tool.applied[0]?.planFile).toBe('/runtime/plan.bin')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a dry run writes the plan and applies nothing', async () => {
    const tool = new FakeInfrastructure()
    const { runtime } = runtimeOf(tool)
    const directory = await runtimeDirectory()
    try {
      const status = await run(runtime, [
        'infra',
        'apply',
        '--dry-run',
        '--yes',
        '--directory',
        join(directory, 'templates'),
        '--runtime',
        directory,
      ])
      expect(status).toBe(0)
      expect(tool.applied).toEqual([])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('the outputs of the deployment are shown and a credential is held back', async () => {
    const tool = new FakeInfrastructure()
    tool.outputs = {
      gateway_url: 'https://api.example.com',
      access_admin_token: 'the-token-of-the-deployment',
    }
    const { runtime, out } = runtimeOf(tool)
    const directory = await runtimeDirectory()
    try {
      const status = await run(runtime, [
        'infra',
        'output',
        '--directory',
        join(directory, 'templates'),
      ])
      expect(status).toBe(0)
      expect(out.join('\n')).toContain('gateway_url = https://api.example.com')
      expect(out.join('\n')).not.toContain('the-token-of-the-deployment')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('an output that the deployment does not have is refused', async () => {
    const tool = new FakeInfrastructure()
    const { runtime } = runtimeOf(tool)
    const directory = await runtimeDirectory()
    try {
      await expect(
        run(runtime, [
          'infra',
          'output',
          '--name',
          'nothing',
          '--directory',
          join(directory, 'templates'),
        ])
      ).rejects.toThrow('the deployment has no output named nothing')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('the templates that do not hold are reported', async () => {
    const tool = new FakeInfrastructure()
    tool.validation = {
      directory: '/templates',
      valid: false,
      errors: ['the variable location is not in the example of the values'],
    }
    const { runtime, out } = runtimeOf(tool)
    const directory = await runtimeDirectory()
    try {
      const status = await run(runtime, [
        'infra',
        'validate',
        '--directory',
        join(directory, 'templates'),
      ])
      expect(status).toBe(8)
      expect(out.join('\n')).toContain('the variable location is not in the example')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a directory of a deployment that is not there is refused', async () => {
    const tool = new FakeInfrastructure()
    const { runtime } = runtimeOf(tool)
    const directory = await runtimeDirectory()
    try {
      await expect(
        run(runtime, [
          'infra',
          'plan',
          '--directory',
          join(directory, 'templates'),
          '--runtime',
          join(directory, 'nowhere'),
        ])
      ).rejects.toThrow('the directory of the deployment is not there')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

/**
 * The tool the tests run.
 *
 * The tool of the deployment is a program of the machine of the
 * operator, and the CLI runs it. The double of the tool records the
 * words it was called with and answers with the json the real tool
 * answers with, so that the wiring of the CLI is proved and not only
 * its answers.
 */
const TOOL = `#!/bin/sh
echo "$@" >> "$ARGS_FILE"
case "$*" in
  *version*) echo "OpenTofu v1.13.2" ;;
  *show*) printf '%s' "$PLAN_JSON" ;;
  *output*) printf '%s' "$OUTPUT_JSON" ;;
  *validate*) echo '{"diagnostics":[]}' ;;
esac
exit 0
`

describe('the tool that writes the infrastructure', () => {
  test('the tool is found, it is asked for the plan, and the plan is read', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-tool-'))
    try {
      const binary = join(directory, 'tofu')
      const argumentsFile = join(directory, 'arguments.txt')
      const templates = join(directory, 'templates')
      const runtime = join(directory, 'runtime')
      await mkdir(templates, { recursive: true })
      await mkdir(runtime, { recursive: true })
      await writeFile(binary, TOOL)
      await chmod(binary, 0o755)
      await writeFile(join(runtime, 'terraform.tfvars'), 'name_prefix = "platform"\n')

      const plan = {
        resource_changes: [
          {
            address: 'azurerm_resource_group.platform',
            type: 'azurerm_resource_group',
            name: 'platform',
            provider_name: 'registry.opentofu.org/hashicorp/azurerm',
            change: { actions: ['create'] },
          },
          {
            address: 'azurerm_key_vault.platform',
            type: 'azurerm_key_vault',
            name: 'platform',
            provider_name: 'registry.opentofu.org/hashicorp/azurerm',
            change: { actions: ['delete', 'create'] },
          },
          {
            address: 'azurerm_log_analytics_workspace.platform',
            type: 'azurerm_log_analytics_workspace',
            name: 'platform',
            provider_name: 'registry.opentofu.org/hashicorp/azurerm',
            change: { actions: ['no-op'] },
          },
        ],
        resource_drift: [],
      }
      const tool = new TofuInfrastructure({
        PATH: process.env.PATH ?? '',
        TOFU_BINARY: binary,
        ARGS_FILE: argumentsFile,
        PLAN_JSON: JSON.stringify(plan),
        OUTPUT_JSON: JSON.stringify({
          gateway_url: 'https://api.example.com',
          access_admin_token: 'the-token-of-the-deployment',
        }),
      })

      expect(await tool.version()).toBe('1.13.2')

      const written = await tool.plan(templates, {
        varFile: join(runtime, 'terraform.tfvars'),
        planFile: join(runtime, 'plan.bin'),
      })
      expect(written.summary).toEqual({ create: 1, update: 0, delete: 0, replace: 1 })
      expect(written.changes.map((change) => change.address)).toEqual([
        'azurerm_resource_group.platform',
        'azurerm_key_vault.platform',
      ])
      expect(written.changes[1]?.action).toBe('replace')

      const words = await Bun.file(argumentsFile).text()
      expect(words).toContain(`-chdir=${templates}`)
      expect(words).toContain(`-var-file=${join(runtime, 'terraform.tfvars')}`)
      expect(words).toContain(`-out=${join(runtime, 'plan.bin')}`)
      expect(words).toContain('show -json')

      const outputs = await tool.output(templates, {})
      expect(outputs.gateway_url).toBe('https://api.example.com')
      expect(outputs.access_admin_token).toBe('(sensitive value)')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a tool that is not there is refused', async () => {
    const tool = new TofuInfrastructure({
      PATH: '',
      TOFU_BINARY: undefined,
      TOFU_DOWNLOAD: 'off',
    })
    await expect(tool.version()).rejects.toThrow(
      'the tool that writes the infrastructure is not on the path'
    )
  })
})
