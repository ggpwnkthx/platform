import { describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run, type CliRuntime } from '../src/app/cli'
import type { Services } from '../src/app/commands'
import {
  actionOf,
  appliedOf,
  changesNothing,
  destroys,
  isTooOld,
  questionOf,
  summaryOf,
} from '../src/domains/infrastructure'
import {
  hintOf,
  isBackendConfiguration,
  isSensitive,
  lockOf,
  redact,
  TofuInfrastructure,
  valuesOf,
} from '../src/platform/tofu'
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
function servicesOf(tool: FakeInfrastructure, progress: string[] = []): Services {
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
    progress: (text) => progress.push(text),
  }
}

/** The runtime of the tests. */
function runtimeOf(tool: FakeInfrastructure): {
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
      groups: [infrastructureGroup],
      environment: {},
      services: () => servicesOf(tool, progress),
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

describe('the outputs of the deployment', () => {
  test('the value of an output is read out of the metadata of the output', () => {
    // The tool answers with the metadata of every output: whether it
    // is sensitive and what its type is. The value of the output is
    // inside that metadata.
    expect(
      valuesOf({
        gateway_url: { sensitive: false, type: 'string', value: 'https://api.example.com' },
        container_apps: {
          sensitive: false,
          type: 'object',
          value: { gateway: 'platform-production-gateway' },
        },
      })
    ).toEqual({
      gateway_url: 'https://api.example.com',
      container_apps: { gateway: 'platform-production-gateway' },
    })
  })

  test('a value that is not the metadata of an output is the value', () => {
    expect(valuesOf({ gateway_url: 'https://api.example.com' })).toEqual({
      gateway_url: 'https://api.example.com',
    })
    expect(valuesOf({})).toEqual({})
    expect(valuesOf('not an answer')).toEqual({})
  })
})

describe('the configuration of the backend of the state', () => {
  test('a set of attributes is a configuration', () => {
    expect(
      isBackendConfiguration(
        'resource_group_name  = "platform-production-state"\nstorage_account_name = "platformproductionstate"'
      )
    ).toBe(true)
  })

  test('a value that is not a string is a value', () => {
    expect(isBackendConfiguration('use_azuread_auth = true')).toBe(true)
    expect(isBackendConfiguration('container_name       = "tfstate"')).toBe(true)
    expect(isBackendConfiguration('key                  = ""')).toBe(true)
  })

  test('a diagnostic of the tool is not a configuration', () => {
    expect(isBackendConfiguration('Warning: No outputs found')).toBe(false)
    expect(isBackendConfiguration('│ resource_group_name = "platform-production-state"')).toBe(
      false
    )
    expect(isBackendConfiguration('')).toBe(false)
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

  test('the question of an apply names what the plan does, counted', () => {
    expect(
      questionOf({
        directory: '/templates',
        changes: [],
        drift: [],
        summary: { create: 97, update: 0, delete: 0, replace: 0 },
        errored: false,
      })
    ).toBe('the plan creates 97, changes 0 and destroys 0: the deployment is applied?')
    expect(
      questionOf({
        directory: '/templates',
        changes: [],
        drift: [],
        summary: { create: 3, update: 1, delete: 0, replace: 2 },
        errored: false,
      })
    ).toBe('the plan creates 3, changes 1 and destroys 2: the deployment is applied?')
  })

  test('an apply is counted in the past, because it is an answer', () => {
    expect(appliedOf({ create: 5, update: 27, delete: 0, replace: 0 })).toBe(
      'the deployment created 5, changed 27 and destroyed 0'
    )
    expect(appliedOf({ create: 0, update: 0, delete: 0, replace: 0 })).toBe(
      'the deployment created 0, changed 0 and destroyed 0'
    )
    expect(appliedOf({ create: 1, update: 0, delete: 2, replace: 3 })).toBe(
      'the deployment created 1, changed 0 and destroyed 5'
    )
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

  test('the plan is shown before the apply, whatever the format of the answer is', async () => {
    const tool = new FakeInfrastructure()
    tool.plan_ = {
      directory: '/templates',
      changes: [
        {
          address: 'azurerm_key_vault.platform',
          action: 'delete',
          kind: 'azurerm_key_vault',
          name: 'platform',
          provider: 'hashicorp/azurerm',
        },
      ],
      drift: [],
      summary: { create: 0, update: 0, delete: 1, replace: 0 },
      errored: false,
    }
    const { runtime, out, progress } = runtimeOf(tool)
    const directory = await runtimeDirectory()
    try {
      const status = await run(runtime, [
        'infra',
        'apply',
        '--yes',
        '--output',
        'json',
        '--directory',
        join(directory, 'templates'),
        '--runtime',
        directory,
      ])
      expect(status).toBe(0)
      // The plan is shown before the apply, whatever the format of the
      // answer is: the plan that is applied is the plan that was read.
      expect(progress.join('\n')).toContain('the plan destroys:')
      expect(progress.join('\n')).toContain('azurerm_key_vault.platform')
      // The answer of the command is the json of the plan, and the
      // dialog did not touch it.
      expect(out.join('\n')).toContain('"azurerm_key_vault.platform"')
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

  test('a resource of the cloud is written in the state of the deployment', async () => {
    const tool = new FakeInfrastructure()
    const { runtime, out } = runtimeOf(tool)
    const directory = await runtimeDirectory()
    try {
      const status = await run(runtime, [
        'infra',
        'import',
        'azurerm_key_vault.platform',
        '/subscriptions/the-subscription/resourceGroups/the-group/providers/Microsoft.KeyVault/vaults/the-vault',
        '--directory',
        join(directory, 'templates'),
      ])
      expect(status).toBe(0)
      expect(tool.imported).toEqual([
        {
          address: 'azurerm_key_vault.platform',
          id: '/subscriptions/the-subscription/resourceGroups/the-group/providers/Microsoft.KeyVault/vaults/the-vault',
        },
      ])
      expect(out.join('\n')).toContain('azurerm_key_vault.platform is written in the state')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('an import without an address is a usage error', async () => {
    const tool = new FakeInfrastructure()
    const { runtime } = runtimeOf(tool)
    const directory = await runtimeDirectory()
    try {
      await expect(
        run(runtime, ['infra', 'import', '--directory', join(directory, 'templates')])
      ).rejects.toThrow('the argument <address> is needed')
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
  *-raw*) if [ -n "$RAW_OUTPUT" ]; then printf '%s' "$RAW_OUTPUT"; else printf '%s' 'resource_group_name = "platform-production-state"'; fi ;;
  *show*) printf '%s' "$PLAN_JSON" ;;
  *output*) printf '%s' "$OUTPUT_JSON" ;;
  *validate*) if [ -n "$CRASHES" ]; then echo '{"diagnostics":[{"severity":"error","summary":"Failed to read test directory","detail":"Test directory tests could not be read: readdirent tests: not a directory."}]}'; else echo '{"diagnostics":[]}'; fi ;;
esac
if [ -n "$APPLY_FAILS" ]; then
  case "$*" in
    *apply*) echo "Error: the resource group already exists" >&2; exit 1 ;;
  esac
fi
if [ -n "$INIT_FAILS" ]; then
  case "$*" in
    *init*)
      count=0
      if [ -f "$COUNT_FILE" ]; then count=$(cat "$COUNT_FILE"); fi
      count=$((count + 1))
      printf '%s' "$count" > "$COUNT_FILE"
      if [ "$count" -le "$INIT_FAILS" ]; then
        echo "Error: the state of the deployment is not reachable yet" >&2
        exit 1
      fi
      ;;
  esac
fi
if [ -n "$CRASHES" ]; then
  case "$*" in
    *init*)
      echo "!!!!!!!!!!!!!!!!!!!!!!!!!!! OPENTOFU CRASH !!!!!!!!!!!!!!!!!!!!!!!!!!!!" >&2
      echo "runtime error: invalid memory address or nil pointer dereference" >&2
      exit 1
      ;;
  esac
fi
if [ -n "$BACKEND_CHANGED" ]; then
  case "$*" in
    *init*)
      case "$*" in
        *-migrate-state*) echo "Error: the state to migrate is not there" >&2; exit 1 ;;
        *-reconfigure*) exit 0 ;;
        *) echo "Error: Backend configuration changed" >&2; exit 1 ;;
      esac
      ;;
  esac
fi
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
      // The tool reads the truth of the deployment: the wizard of the
      // deployment registers the tenant of the deployment with the
      // token of the administration, and a held-back value is a
      // refusal it cannot read.
      expect(outputs.access_admin_token).toBe('the-token-of-the-deployment')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('the tool is asked to write a resource in the state', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-tool-'))
    try {
      const binary = join(directory, 'tofu')
      const argumentsFile = join(directory, 'arguments.txt')
      const templates = join(directory, 'templates')
      await mkdir(templates, { recursive: true })
      await writeFile(binary, TOOL)
      await chmod(binary, 0o755)

      const tool = new TofuInfrastructure({
        PATH: process.env.PATH ?? '',
        TOFU_BINARY: binary,
        ARGS_FILE: argumentsFile,
      })

      await tool.import(
        templates,
        'azurerm_key_vault.platform',
        '/subscriptions/the-subscription/resourceGroups/the-group/providers/Microsoft.KeyVault/vaults/the-vault',
        { varFile: '/runtime/terraform.tfvars' }
      )
      const words = await Bun.file(argumentsFile).text()
      expect(words).toContain(`-chdir=${templates} import`)
      expect(words).toContain('-var-file=/runtime/terraform.tfvars')
      expect(words).toContain('azurerm_key_vault.platform')
      expect(words).toContain(
        '/subscriptions/the-subscription/resourceGroups/the-group/providers/Microsoft.KeyVault/vaults/the-vault'
      )
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

  test('the place where the state lives is created and the templates are initialized', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-tool-'))
    try {
      const binary = join(directory, 'tofu')
      const argumentsFile = join(directory, 'arguments.txt')
      const templates = join(directory, 'templates')
      const bootstrap = join(templates, 'bootstrap')
      const runtime = join(directory, 'runtime')
      await mkdir(bootstrap, { recursive: true })
      await mkdir(runtime, { recursive: true })
      await writeFile(binary, TOOL)
      await chmod(binary, 0o755)

      const tool = new TofuInfrastructure({
        PATH: process.env.PATH ?? '',
        TOFU_BINARY: binary,
        ARGS_FILE: argumentsFile,
      })

      const configuration = await tool.bootstrap(bootstrap, {
        name_prefix: 'platform',
        environment: 'development',
        location: 'centralus',
        resource_group_name: 'platform-development-state',
        operator_addresses: '["203.0.113.4/32"]',
      })
      expect(configuration.backendConfig).toContain('resource_group_name')
      expect(configuration.created).toBe(true)

      let words = await Bun.file(argumentsFile).text()
      expect(words).toContain(`-chdir=${bootstrap} init`)
      expect(words).toContain(`-chdir=${bootstrap} apply`)
      expect(words).toContain('-var=name_prefix=platform')
      expect(words).toContain('-var=environment=development')
      expect(words).toContain('-var=operator_addresses=["203.0.113.4/32"]')
      expect(words).toContain('output -raw backend_config_hcl')

      const backend = join(runtime, 'backend.hcl')
      await tool.initialize(templates, { backendConfig: backend })
      words = await Bun.file(argumentsFile).text()
      expect(words).toContain(`-chdir=${templates} init`)
      expect(words).toContain(`-backend-config=${backend}`)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a bootstrap that fails is the failure of the tool', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-tool-'))
    try {
      const binary = join(directory, 'tofu')
      const argumentsFile = join(directory, 'arguments.txt')
      const bootstrap = join(directory, 'templates', 'bootstrap')
      await mkdir(bootstrap, { recursive: true })
      await writeFile(binary, TOOL)
      await chmod(binary, 0o755)

      const tool = new TofuInfrastructure({
        PATH: process.env.PATH ?? '',
        TOFU_BINARY: binary,
        ARGS_FILE: argumentsFile,
        APPLY_FAILS: '1',
        RAW_OUTPUT: 'Warning: No outputs found',
      })

      await expect(tool.bootstrap(bootstrap, { name_prefix: 'platform' })).rejects.toThrow(
        'the place where the state of the deployment lives was not created: Error: the resource group already exists'
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a tool that answers with a diagnostic is refused', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-tool-'))
    try {
      const binary = join(directory, 'tofu')
      const argumentsFile = join(directory, 'arguments.txt')
      const bootstrap = join(directory, 'templates', 'bootstrap')
      await mkdir(bootstrap, { recursive: true })
      await writeFile(binary, TOOL)
      await chmod(binary, 0o755)

      const tool = new TofuInfrastructure({
        PATH: process.env.PATH ?? '',
        TOFU_BINARY: binary,
        ARGS_FILE: argumentsFile,
        RAW_OUTPUT: 'Warning: No outputs found\n\nThe state file either has no outputs defined',
      })

      await expect(tool.bootstrap(bootstrap, { name_prefix: 'platform' })).rejects.toThrow(
        'the configuration of the backend of the state cannot be read'
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a resource that is already there is told how to be written in the state', () => {
    expect(hintOf('Error: VaultAlreadyExists: The vault name is already in use')).toContain(
      'platformctl infra import'
    )
    expect(hintOf('Error: something else entirely')).toBe('')
  })

  test('the lock of the state of the deployment is read', () => {
    // A run that was killed leaves the lock of the state behind it,
    // and the tool names the lock, the one who holds it and the moment
    // it was taken.
    const lock = lockOf(
      [
        'Error: Error acquiring the state lock',
        '',
        'Error message: state blob is already locked',
        'Lock Info:',
        '  ID:        74e078e2-ccfa-a2ef-6a45-0ac061764254',
        '  Path:      https://the-account.blob.core.windows.net/tfstate/the.tfstate',
        '  Operation: OperationTypeInvalid',
        '  Who:       isaac@isaac-gaming',
        '  Version:   1.13.1',
        '  Created:   2026-11-04 21:55:29.404365078 +0000 UTC',
      ].join('\n')
    )
    expect(lock).toEqual({
      id: '74e078e2-ccfa-a2ef-6a45-0ac061764254',
      who: 'isaac@isaac-gaming',
      created: '2026-11-04 21:55:29.404365078 +0000 UTC',
    })
    expect(lockOf('Error: something else entirely')).toBeUndefined()
  })

  test('a place that is already there is a failure of the tool', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-tool-'))
    try {
      const binary = join(directory, 'tofu')
      const argumentsFile = join(directory, 'arguments.txt')
      const bootstrap = join(directory, 'templates', 'bootstrap')
      await mkdir(bootstrap, { recursive: true })
      await writeFile(binary, TOOL)
      await chmod(binary, 0o755)

      const tool = new TofuInfrastructure({
        PATH: process.env.PATH ?? '',
        TOFU_BINARY: binary,
        ARGS_FILE: argumentsFile,
        APPLY_FAILS: '1',
      })

      await expect(tool.bootstrap(bootstrap, { name_prefix: 'platform' })).rejects.toThrow(
        'the place where the state of the deployment lives was not created'
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('the state of the deployment is migrated when the backend changed', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-tool-'))
    try {
      const binary = join(directory, 'tofu')
      const argumentsFile = join(directory, 'arguments.txt')
      const templates = join(directory, 'templates')
      await mkdir(templates, { recursive: true })
      await writeFile(binary, TOOL)
      await chmod(binary, 0o755)

      const tool = new TofuInfrastructure(
        {
          PATH: process.env.PATH ?? '',
          TOFU_BINARY: binary,
          ARGS_FILE: argumentsFile,
          BACKEND_CHANGED: '1',
        },
        { retries: 0, waitMs: 0 }
      )

      // The migration of the state fails, and the state stays where it
      // is: the templates are initialized again with the configuration
      // the CLI wrote, and the CLI is told that the state was not
      // read.
      const state = await tool.initialize(templates, {
        backendConfig: join(directory, 'backend.hcl'),
      })
      expect(state.read).toBe(false)
      expect(state.reason).toContain('the state to migrate is not there')
      const words = await Bun.file(argumentsFile).text()
      expect(words).toContain('-migrate-state')
      expect(words).toContain('-reconfigure')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('the templates are initialized again while the state is not reachable', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-tool-'))
    try {
      const binary = join(directory, 'tofu')
      const argumentsFile = join(directory, 'arguments.txt')
      const countFile = join(directory, 'count.txt')
      const templates = join(directory, 'templates')
      await mkdir(templates, { recursive: true })
      await writeFile(binary, TOOL)
      await chmod(binary, 0o755)

      const tool = new TofuInfrastructure(
        {
          PATH: process.env.PATH ?? '',
          TOFU_BINARY: binary,
          ARGS_FILE: argumentsFile,
          COUNT_FILE: countFile,
          INIT_FAILS: '2',
        },
        { retries: 3, waitMs: 0 }
      )

      // The state of the deployment is not reachable yet: the templates
      // are initialized again, and the init that answers is the one
      // that is kept.
      await tool.initialize(templates, { backendConfig: join(directory, 'backend.hcl') })
      const words = await Bun.file(argumentsFile).text()
      expect(words.split('\n').filter((line) => line.includes('init')).length).toBe(3)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a crash of the tool is told with the reason the tool gives', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-tool-'))
    try {
      const binary = join(directory, 'tofu')
      const argumentsFile = join(directory, 'arguments.txt')
      const templates = join(directory, 'templates')
      await mkdir(templates, { recursive: true })
      await writeFile(binary, TOOL)
      await chmod(binary, 0o755)

      const tool = new TofuInfrastructure(
        {
          PATH: process.env.PATH ?? '',
          TOFU_BINARY: binary,
          ARGS_FILE: argumentsFile,
          CRASHES: '1',
        },
        { retries: 3, waitMs: 0 }
      )

      // The tool crashes when it cannot read the directory of the
      // templates, and the crash is a stack trace of the tool: the
      // operator is told what the tool cannot read, and the answer
      // names the file that is in the way.
      await expect(
        tool.initialize(templates, { backendConfig: join(directory, 'backend.hcl') })
      ).rejects.toThrow(
        'the templates of the deployment cannot be initialized: Failed to read test directory: Test directory tests could not be read: readdirent tests: not a directory.'
      )

      // A crash is not a state that becomes reachable: the tool is not
      // asked to initialize the templates again.
      const words = await Bun.file(argumentsFile).text()
      expect(words.split('\n').filter((line) => line.includes('init')).length).toBe(1)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
