import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'bun'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assignmentsOf,
  BOOTSTRAP_FILES,
  checkCredentials,
  checkDeploy,
  checkConsoleProbes,
  checkFilesOfStack,
  checkInfrastructure,
  checkLayout,
  checkMinimumEnvironment,
  checkStacks,
  checkConsoleCredentials,
  checkConsoleTenantCredential,
  checkTrackedInfrastructure,
  credentialsOfTemplates,
  imagesOfTemplates,
  providerVersionsOf,
  TEMPLATE_FILES,
  valueOfAssignment,
  variablesOfTemplates,
} from '../scripts/check-deploy'

/**
 * The deployment of the platform.
 *
 * Every file of a deployment is in `deploy/`, and every service of the
 * platform is deployed on its own and as part of the composition of the
 * three. These tests prove that the directory of the repository holds
 * what it should hold, and that the check answers when it does not.
 */
const root = join(import.meta.dir, '..')

describe('the directory of the deployment', () => {
  test('it holds what it should hold', async () => {
    expect(await checkDeploy(root)).toEqual([])
  })

  test('a deployment file outside of the directory is reported', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platform-deploy-'))
    try {
      await mkdir(join(directory, 'packages', 'gateway', 'deploy'), { recursive: true })
      await mkdir(join(directory, 'deploy', 'compose'), { recursive: true })
      await mkdir(join(directory, 'deploy', 'kubernetes'), { recursive: true })
      await mkdir(join(directory, 'deploy', 'config'), { recursive: true })
      const findings = checkLayout(directory)
      expect(findings).toEqual([
        {
          file: 'packages/gateway/deploy',
          message: 'the deployment files are in the directory of the deployment',
        },
      ])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a stack that deploys another service is reported', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platform-deploy-'))
    try {
      await mkdir(join(directory, 'deploy', 'compose'), { recursive: true })
      await writeFile(
        join(directory, 'deploy', 'compose', 'gateway.compose.yaml'),
        'name: platform-gateway\nservices:\n  gateway:\n    image: gateway\n  access:\n    image: access\n'
      )
      const findings = await checkStacks(directory)
      expect(findings.some((finding) => finding.message.includes('deploys the access'))).toBe(true)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a stack that does not deploy a service is reported', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platform-deploy-'))
    try {
      await mkdir(join(directory, 'deploy', 'compose'), { recursive: true })
      await writeFile(
        join(directory, 'deploy', 'compose', 'gateway.compose.yaml'),
        'name: platform-gateway\nservices:\n  dex:\n    image: ghcr.io/dexidp/dex:v2.46.1\n'
      )
      const findings = await checkStacks(directory)
      expect(
        findings.some((finding) => finding.message.includes('the stack does not deploy'))
      ).toBe(true)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a variable that a stack requires and the minimum environment does not hold is reported', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platform-deploy-'))
    try {
      await mkdir(join(directory, 'deploy', 'compose'), { recursive: true })
      await writeFile(
        join(directory, 'deploy', 'compose', 'gateway.compose.yaml'),
        `name: platform-gateway
services:
  gateway:
    environment:
      GATEWAY_SESSION_SECRET: \${GATEWAY_SESSION_SECRET:?the secret of the sessions is required}
`
      )
      await writeFile(join(directory, '.env.min'), 'GATEWAY_OIDC_ISSUER=http://access:8081\n')
      const findings = await checkMinimumEnvironment(directory)
      expect(findings).toEqual([
        {
          file: '.env.min',
          message:
            'the variable GATEWAY_SESSION_SECRET is not set: the stack deploy/compose/gateway.compose.yaml refuses to start without it',
        },
      ])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('the minimum environment holds every variable a stack requires', async () => {
    const findings = await checkMinimumEnvironment(root)
    expect(findings).toEqual([])
  })
})

/**
 * The templates of the deployment.
 *
 * The templates are the platform's artifacts, and the values of one
 * deployment are not. The tests prove that the templates of the
 * repository hold what they should hold, and that the check answers
 * when they do not.
 */

/** The tree of the templates of a deployment that holds what it should hold. */
async function templatesOf(directory: string): Promise<string> {
  const templates = join(directory, 'deploy', 'tofu', 'azure')
  await mkdir(join(templates, 'bootstrap'), { recursive: true })
  for (const file of TEMPLATE_FILES) {
    await writeFile(join(templates, file), '')
  }
  for (const file of BOOTSTRAP_FILES) {
    await writeFile(join(templates, 'bootstrap', file), '')
  }
  await writeFile(join(directory, '.gitignore'), 'deploy/tofu/runtime/\n')
  return templates
}

/**
 * A repository that holds the templates.
 *
 * The check reads the index of the repository, and the index is what
 * tells a file of the repository from a file of the machine of the
 * operator.
 *
 * @param directory the root of the repository.
 */
async function repositoryOf(directory: string): Promise<void> {
  spawnSync(['git', 'init', '--quiet'], { cwd: directory })
  spawnSync(['git', 'add', '.'], { cwd: directory })
  spawnSync(
    [
      'git',
      '-c',
      'user.email=operator@example.com',
      '-c',
      'user.name=operator',
      'commit',
      '--quiet',
      '-m',
      'the templates',
    ],
    { cwd: directory }
  )
}

describe('the infrastructure as code of the deployment', () => {
  test('the templates of the repository hold what they should hold', async () => {
    expect(await checkInfrastructure(root)).toEqual([])
  })

  test('the tracked files of the templates are the files of the templates', () => {
    expect(checkTrackedInfrastructure(root)).toEqual([])
  })

  test('a variable that the example of the values does not name is reported', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platform-tofu-'))
    try {
      const templates = await templatesOf(directory)
      await writeFile(
        join(templates, 'variables.tf'),
        'variable "location" {\n  type = string\n}\n'
      )
      const findings = await checkInfrastructure(directory)
      expect(findings).toEqual([
        {
          file: 'deploy/tofu/azure/terraform.tfvars.example',
          message: 'the variable location is not in the example of the values',
        },
      ])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a name that the example of the values holds and the templates do not declare is reported', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platform-tofu-'))
    try {
      const templates = await templatesOf(directory)
      await writeFile(join(templates, 'terraform.tfvars.example'), 'region = "westeurope"\n')
      const findings = await checkInfrastructure(directory)
      expect(findings).toEqual([
        {
          file: 'deploy/tofu/azure/terraform.tfvars.example',
          message: 'the example names region, which the templates do not declare',
        },
      ])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('an image of the example of the values that is not a digest is reported', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platform-tofu-'))
    try {
      const templates = await templatesOf(directory)
      await writeFile(
        join(templates, 'variables.tf'),
        'variable "gateway_image" {\n  type = string\n}\n'
      )
      await writeFile(
        join(templates, 'terraform.tfvars.example'),
        'gateway_image = "ghcr.io/ggpwnkthx/gateway:1.0.0"\n'
      )
      const findings = await checkInfrastructure(directory)
      expect(findings).toEqual([
        {
          file: 'deploy/tofu/azure/terraform.tfvars.example',
          message:
            'the image gateway_image is not a digest: the deployment runs the bytes that the release proved',
        },
      ])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('an image that a template names down and that is not a digest is reported', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platform-tofu-'))
    try {
      const templates = await templatesOf(directory)
      await writeFile(
        join(templates, 'containerapps.tf'),
        'resource "azurerm_container_app" "gateway" {\n  image = "ghcr.io/ggpwnkthx/gateway:1.0.0"\n}\n'
      )
      const findings = await checkInfrastructure(directory)
      expect(findings).toEqual([
        {
          file: 'deploy/tofu/azure',
          message: 'the image ghcr.io/ggpwnkthx/gateway:1.0.0 is not a digest',
        },
      ])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('the state of a deployment in the templates is reported', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platform-tofu-'))
    try {
      const templates = await templatesOf(directory)
      await writeFile(join(templates, 'terraform.tfstate'), '{}\n')
      const findings = await checkInfrastructure(directory)
      expect(findings).toEqual([
        {
          file: 'deploy/tofu/azure/terraform.tfstate',
          message: 'the state of a deployment holds the credentials of the deployment',
        },
      ])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('the state of a deployment that is not committed is not reported', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platform-tofu-'))
    try {
      const templates = await templatesOf(directory)
      await repositoryOf(directory)
      await writeFile(join(templates, 'terraform.tfstate'), '{}\n')
      const findings = await checkInfrastructure(directory)
      expect(findings).toEqual([])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('the state of a deployment that is committed is reported', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platform-tofu-'))
    try {
      const templates = await templatesOf(directory)
      await repositoryOf(directory)
      await writeFile(join(templates, 'terraform.tfstate'), '{}\n')
      spawnSync(['git', 'add', 'deploy/tofu/azure/terraform.tfstate'], { cwd: directory })
      const findings = await checkInfrastructure(directory)
      expect(findings).toEqual([
        {
          file: 'deploy/tofu/azure/terraform.tfstate',
          message: 'the state of a deployment holds the credentials of the deployment',
        },
      ])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('the values of a deployment in the templates are reported', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platform-tofu-'))
    try {
      const templates = await templatesOf(directory)
      await writeFile(join(templates, 'terraform.tfvars'), 'location = "westeurope"\n')
      const findings = await checkInfrastructure(directory)
      expect(findings).toEqual([
        {
          file: 'deploy/tofu/azure/terraform.tfvars',
          message: 'the values of a deployment belong to one deployment and not to the repository',
        },
      ])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a plan of a deployment in the templates is reported', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platform-tofu-'))
    try {
      const templates = await templatesOf(directory)
      await writeFile(join(templates, 'plan.bin'), 'plan\n')
      const findings = await checkInfrastructure(directory)
      expect(findings).toEqual([
        {
          file: 'deploy/tofu/azure/plan.bin',
          message: 'a plan of a deployment is not a file of the repository',
        },
      ])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a provider that is not pinned is reported', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platform-tofu-'))
    try {
      const templates = await templatesOf(directory)
      await writeFile(
        join(templates, 'versions.tf'),
        'terraform {\n  required_providers {\n    azurerm = {\n      source = "hashicorp/azurerm"\n    }\n  }\n}\n'
      )
      const findings = await checkInfrastructure(directory)
      expect(findings).toEqual([
        {
          file: 'deploy/tofu/azure/versions.tf',
          message:
            'the provider azurerm is not pinned: a provider that changes changes the deployment',
        },
      ])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('the runtime directory that is not ignored is reported', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platform-tofu-'))
    try {
      await templatesOf(directory)
      await writeFile(join(directory, '.gitignore'), 'node_modules\n')
      const findings = await checkInfrastructure(directory)
      expect(findings).toEqual([
        {
          file: '.gitignore',
          message:
            'the directory deploy/tofu/runtime is not ignored: the files of a deployment are not files of the repository',
        },
      ])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a tracked file of the templates that is not a template is reported', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platform-tofu-'))
    try {
      const templates = await templatesOf(directory)
      await writeFile(join(templates, 'terraform.tfstate'), '{}\n')
      spawnSync(['git', 'init', '--quiet'], { cwd: directory })
      spawnSync(['git', 'add', '--all', 'deploy/tofu'], { cwd: directory })
      const findings = checkTrackedInfrastructure(directory)
      expect(findings).toEqual([
        {
          file: 'deploy/tofu/azure/terraform.tfstate',
          message: 'the file is not a file of the templates of the platform',
        },
      ])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

describe('the console of the deployment', () => {
  test('it names the address of every service it probes', async () => {
    expect(await checkConsoleProbes(root)).toEqual([])
  })

  test('a console that names no address of a service is reported', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platform-tofu-'))
    try {
      const templates = join(directory, 'deploy', 'tofu', 'azure')
      await mkdir(templates, { recursive: true })
      await writeFile(
        join(templates, 'containerapps.tf'),
        [
          'resource "azurerm_container_app" "console" {',
          '  template {',
          '    container {',
          '      env {',
          '        name  = "CONSOLE_ACCESS_URL"',
          '        value = "http://access"',
          '      }',
          '      env {',
          '        name  = "CONSOLE_GATEWAY_URL"',
          '        value = "https://api"',
          '      }',
          '    }',
          '  }',
          '}',
          '',
        ].join('\n')
      )
      const findings = await checkConsoleProbes(directory)
      expect(findings).toEqual([
        {
          file: join('deploy', 'tofu', 'azure', 'containerapps.tf'),
          message:
            'the console of the deployment does not name the variable CONSOLE_DATA_URL: the status board of the console shows the service as not configured',
        },
      ])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

describe('the credentials of the console of the deployment', () => {
  test('the console is the client of the tenant', async () => {
    expect(await checkConsoleCredentials(root)).toEqual([])
  })

  test('a console that is a client of its own is reported', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platform-tofu-'))
    try {
      const templates = join(directory, 'deploy', 'tofu', 'azure')
      await mkdir(templates, { recursive: true })
      await writeFile(
        join(templates, 'containerapps.tf'),
        [
          'resource "azurerm_container_app" "gateway" {',
          '  template {',
          '    container {',
          '      env {',
          '        name  = "GATEWAY_OIDC_CLIENT_ID"',
          '        value = var.client_id',
          '      }',
          '    }',
          '  }',
          '}',
          '',
          'resource "azurerm_container_app" "console" {',
          '  template {',
          '    container {',
          '      env {',
          '        name  = "CONSOLE_CLIENT_ID"',
          '        value = "console"',
          '      }',
          '    }',
          '  }',
          '}',
          '',
        ].join('\n')
      )
      const findings = await checkConsoleCredentials(directory)
      expect(findings).toEqual([
        {
          file: join('deploy', 'tofu', 'azure', 'containerapps.tf'),
          message:
            'the console of the deployment is a client of Access of its own ("console"), and the gateway is another one (var.client_id): Access holds one client for a tenant, and the sign-in of the console fails with a request that names no tenant',
        },
      ])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a console that reads a secret of its own is reported', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platform-tofu-'))
    try {
      const templates = join(directory, 'deploy', 'tofu', 'azure')
      await mkdir(templates, { recursive: true })
      await writeFile(
        join(templates, 'containerapps.tf'),
        [
          'locals {',
          '  gateway_env_secrets = {',
          '    GATEWAY_OIDC_CLIENT_SECRET = "client-secret"',
          '  }',
          '  console_env_secrets = {',
          '    CONSOLE_CLIENT_SECRET = "console-client-secret"',
          '  }',
          '}',
          '',
        ].join('\n')
      )
      const findings = await checkConsoleCredentials(directory)
      expect(findings).toEqual([
        {
          file: join('deploy', 'tofu', 'azure', 'containerapps.tf'),
          message:
            'the console of the deployment reads the secret console-client-secret of the vault and the gateway reads the secret client-secret, and the two of them are the one client of the tenant: the sign-in of the console fails with a request that is not valid',
        },
      ])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a console whose credential of the access context is not registered is reported', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platform-tofu-'))
    try {
      const templates = join(directory, 'deploy', 'tofu', 'azure')
      await mkdir(templates, { recursive: true })
      await writeFile(
        join(templates, 'locals.tf'),
        [
          'locals {',
          '  access_context_tokens = {',
          '    (random_bytes.access_context.hex) = [var.access_tenant_id]',
          '  }',
          '  secret_values = {',
          '    "console-access-context-token" = random_bytes.console_access_context.hex',
          '  }',
          '  console_env_secrets = {',
          '    CONSOLE_ACCESS_CONTEXT_TOKEN = "console-access-context-token"',
          '  }',
          '}',
          '',
        ].join('\n')
      )
      const findings = await checkConsoleCredentials(directory)
      expect(findings).toEqual([
        {
          file: join('deploy', 'tofu', 'azure', 'locals.tf'),
          message:
            'the console of the deployment reads the credential of the access context and that credential is not registered at Access: the console reads no scope for the people that sign in, and it opens nothing',
        },
      ])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a console that holds the token of the control plane is reported', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platform-tofu-'))
    try {
      const templates = join(directory, 'deploy', 'tofu', 'azure')
      await mkdir(templates, { recursive: true })
      await writeFile(
        join(templates, 'locals.tf'),
        [
          'locals {',
          '  control_tokens = {',
          '    (random_bytes.client_secret.hex) = {',
          '      operator = "the-operator-of-the-deployment"',
          '      scope    = "operate"',
          '    }',
          '  }',
          '  secret_values = {',
          '    "client-secret" = random_bytes.client_secret.hex',
          '  }',
          '  console_env_secrets = {',
          '    CONSOLE_CLIENT_SECRET = "client-secret"',
          '  }',
          '}',
          '',
        ].join('\n')
      )
      const findings = await checkConsoleCredentials(directory)
      expect(findings).toEqual([
        {
          file: join('deploy', 'tofu', 'azure', 'locals.tf'),
          message:
            'the console of the deployment reads the secret of the client, and that secret is the token of the control plane: the service that the browsers reach holds a credential of the control plane',
        },
      ])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

describe('the credential of the tenant of the deployment', () => {
  test('the console holds the credential of its tenant', async () => {
    expect(await checkConsoleTenantCredential(root)).toEqual([])
  })

  test('a console that holds no credential of its tenant is reported', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platform-tofu-'))
    try {
      const templates = join(directory, 'deploy', 'tofu', 'azure')
      await mkdir(templates, { recursive: true })
      await writeFile(
        join(templates, 'locals.tf'),
        [
          'locals {',
          '  access_env_secrets = {',
          '    ACCESS_ADMIN_TOKENS = "access-admin-tokens"',
          '  }',
          '  admin_tokens = {',
          '    (random_bytes.access_tenant_admin.hex) = {',
          '      tenant   = var.data_workspace_slug',
          '      operator = "the-console-of-the-deployment"',
          '    }',
          '  }',
          '  tenant_admin_tokens = {',
          '    (var.data_workspace_slug) = random_bytes.access_tenant_admin.hex',
          '  }',
          '}',
          '',
        ].join('\n')
      )
      const findings = await checkConsoleTenantCredential(directory)
      expect(findings).toEqual([
        {
          file: join('deploy', 'tofu', 'azure', 'containerapps.tf'),
          message:
            'the console of the deployment holds no credential of the administration of its tenant: it signs every change of the tenant with the token of the platform, and the audit of the change names nobody',
        },
      ])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a credential that Access does not know is reported', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platform-tofu-'))
    try {
      const templates = join(directory, 'deploy', 'tofu', 'azure')
      await mkdir(templates, { recursive: true })
      await writeFile(
        join(templates, 'locals.tf'),
        [
          'locals {',
          '  console_env_secrets = {',
          '    CONSOLE_TENANT_ADMIN_TOKENS = "console-tenant-admin-tokens"',
          '  }',
          '  admin_tokens = {',
          '    (random_bytes.access_admin.hex) = {',
          '      tenant   = var.data_workspace_slug',
          '      operator = "the-console-of-the-deployment"',
          '    }',
          '  }',
          '  tenant_admin_tokens = {',
          '    (var.data_workspace_slug) = random_bytes.access_tenant_admin.hex',
          '  }',
          '}',
          '',
        ].join('\n')
      )
      const findings = await checkConsoleTenantCredential(directory)
      expect(findings).toEqual([
        {
          file: join('deploy', 'tofu', 'azure', 'containerapps.tf'),
          message:
            'Access of the deployment holds no credential of the administration of the tenant of the deployment: the console presents a credential that Access refuses, and the administration of the tenant is refused to every operator',
        },
        {
          file: join('deploy', 'tofu', 'azure', 'locals.tf'),
          message:
            'the console of the deployment and Access do not hold the same credential of the administration of the tenant: the console presents a credential that Access refuses, and the administration of the tenant is refused to every operator',
        },
      ])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a credential that names no tenant is reported', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platform-tofu-'))
    try {
      const templates = join(directory, 'deploy', 'tofu', 'azure')
      await mkdir(templates, { recursive: true })
      await writeFile(
        join(templates, 'locals.tf'),
        [
          'locals {',
          '  access_env_secrets = {',
          '    ACCESS_ADMIN_TOKENS = "access-admin-tokens"',
          '  }',
          '  console_env_secrets = {',
          '    CONSOLE_TENANT_ADMIN_TOKENS = "console-tenant-admin-tokens"',
          '  }',
          '  admin_tokens = {',
          '    (random_bytes.access_tenant_admin.hex) = {',
          '      operator = "the-console-of-the-deployment"',
          '    }',
          '  }',
          '  tenant_admin_tokens = {',
          '    (var.data_workspace_slug) = random_bytes.access_tenant_admin.hex',
          '  }',
          '}',
          '',
        ].join('\n')
      )
      const findings = await checkConsoleTenantCredential(directory)
      expect(findings).toEqual([
        {
          file: join('deploy', 'tofu', 'azure', 'locals.tf'),
          message:
            'Access of the deployment holds a credential of the administration that names no tenant: the credential is scoped to no tenant, and it refuses every call',
        },
      ])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

describe('the files of the templates of the deployment', () => {
  test('a file of the directory of the templates that is not a file of the templates is reported', async () => {
    // The tool that writes the deployment reads the whole directory of
    // the templates, and a file that is named `tests` and that is not
    // a directory stops the tool with the stack trace of the tool: the
    // operator is told nothing about the file that is in the way.
    const directory = await mkdtemp(join(tmpdir(), 'platform-templates-'))
    try {
      const templates = join(directory, 'deploy', 'tofu', 'azure')
      await mkdir(templates, { recursive: true })
      await writeFile(join(templates, 'locals.tf'), 'locals {}\n')
      await writeFile(join(templates, 'tests'), '')
      const findings = await checkFilesOfStack(directory, {
        directory: join('deploy', 'tofu', 'azure'),
        files: ['locals.tf'],
      })
      expect(findings).toEqual([
        {
          file: join('deploy', 'tofu', 'azure', 'tests'),
          message:
            'the file is not a file of the templates: the tool that writes the deployment reads the whole directory, and a file it cannot read stops the deployment',
        },
      ])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('the files of the templates and the files of a deployment are not reported', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platform-templates-'))
    try {
      const templates = join(directory, 'deploy', 'tofu', 'azure')
      await mkdir(templates, { recursive: true })
      await writeFile(join(templates, 'locals.tf'), 'locals {}\n')
      await writeFile(join(templates, 'README.md'), '# the templates\n')
      await writeFile(join(templates, 'terraform.tfstate'), '{}\n')
      const findings = await checkFilesOfStack(directory, {
        directory: join('deploy', 'tofu', 'azure'),
        files: ['locals.tf'],
      })
      expect(findings).toEqual([])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

describe('the credentials of the templates of the deployment', () => {
  /**
   * The templates of the deployment of the repository.
   *
   * The credentials the templates generate are credentials that the
   * services of the deployment read, and the services count their bytes
   * the way they read them: a secret of hexadecimal is counted in half
   * of its characters, and a passphrase is counted in three quarters of
   * them when it is a part of the alphabet of base64.
   */
  async function templatesOf(): Promise<{ file: string; source: string }[]> {
    const directory = join(root, 'deploy', 'tofu', 'azure')
    const entries = await readdir(directory, { withFileTypes: true })
    const sources: { file: string; source: string }[] = []
    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (!entry.name.endsWith('.tf')) continue
      sources.push({
        file: join('deploy', 'tofu', 'azure', entry.name),
        source: await readFile(join(directory, entry.name), 'utf8'),
      })
    }
    return sources
  }

  test('the credentials the templates generate are strong enough for the services', async () => {
    expect(await checkCredentials(await templatesOf())).toEqual([])
  })

  test('a credential that is counted in fewer than thirty-two bytes is reported', () => {
    // A passphrase of forty characters is a credential of thirty bytes:
    // the services count the characters of a passphrase as the
    // characters of base64, and a deployment that holds one starts a
    // service that stops.
    const source = [
      'resource "random_password" "gateway_access_token" {',
      '  length  = 40',
      '  special = false',
      '}',
      'locals {',
      '  token = random_password.gateway_access_token.result',
      '}',
    ].join('\n')
    expect(checkCredentials([{ file: 'locals.tf', source }])).toEqual([
      {
        file: 'locals.tf',
        message:
          'the credential gateway_access_token is counted in 30 bytes: a service refuses to start with a credential of fewer than 32 bytes',
      },
    ])
  })

  test('a password of a role of a database is not a credential of a service', () => {
    // The password of a role is carried by the address of the database,
    // and a service reads the address and not the password.
    const source = [
      'resource "random_password" "data_owner" {',
      '  length  = 32',
      '  special = false',
      '}',
      'locals {',
      `  url = "postgres://data_owner:\${random_password.data_owner.result}@localhost:5432/data"`,
      '}',
    ].join('\n')
    expect(checkCredentials([{ file: 'locals.tf', source }])).toEqual([])
  })

  test('the credentials of the templates are read', () => {
    const source = [
      'resource "random_bytes" "access_admin" {',
      '  length = 32',
      '}',
      'resource "random_password" "postgres_admin" {',
      '  length  = 32',
      '  special = false',
      '}',
    ].join('\n')
    expect(credentialsOfTemplates([{ file: 'locals.tf', source }])).toEqual([
      { name: 'access_admin', file: 'locals.tf', bytes: 32, carriedByDatabase: false },
      { name: 'postgres_admin', file: 'locals.tf', bytes: 24, carriedByDatabase: false },
    ])
  })
})

describe('the reading of the templates', () => {
  test('the variables of the templates are read', () => {
    expect(
      variablesOfTemplates([
        'variable "location" {\n  type = string\n}\n',
        'variable "name_prefix" {\n  type = string\n}\n',
        '# variable "commented" {\n',
      ])
    ).toEqual(['location', 'name_prefix'])
  })

  test('the names of the example of the values are read, and not the names inside a value', () => {
    const example = [
      '# the name of the deployment',
      'name_prefix = "platform"',
      '',
      'services = {',
      '  gateway = { min_replicas = 2 }',
      '  access  = { min_replicas = 2 }',
      '}',
      '',
      'operator_addresses = ["203.0.113.4/32"]',
    ].join('\n')
    expect(assignmentsOf(example)).toEqual(['name_prefix', 'operator_addresses', 'services'])
  })

  test('the value of a name of the example of the values is read', () => {
    const example = 'name_prefix = "platform"\nservices = {\n  gateway = { min_replicas = 2 }\n}\n'
    expect(valueOfAssignment(example, 'name_prefix')).toBe('platform')
    expect(valueOfAssignment(example, 'services')).toBe('{\n  gateway = { min_replicas = 2 }\n}')
    expect(valueOfAssignment(example, 'nothing')).toBeUndefined()
  })

  test('the images of the templates are read', () => {
    expect(
      imagesOfTemplates([
        'image = "ghcr.io/ggpwnkthx/gateway:1.0.0"\n',
        '  image = var.gateway_image\n',
      ])
    ).toEqual(['ghcr.io/ggpwnkthx/gateway:1.0.0'])
  })

  test('the versions of the providers are read', () => {
    const versions = [
      'terraform {',
      '  required_providers {',
      '    azurerm  = { source = "hashicorp/azurerm", version = "~> 4.0" }',
      '    azuread = { source = "hashicorp/azuread", version = "~> 2.0" }',
      '    random  = { source = "hashicorp/random" }',
      '  }',
      '}',
    ].join('\n')
    const found = providerVersionsOf(versions)
    expect(found.find((entry) => entry.provider === 'azurerm')?.version).toBe('~> 4.0')
    expect(found.find((entry) => entry.provider === 'azuread')?.version).toBe('~> 2.0')
    expect(found.find((entry) => entry.provider === 'random')?.version).toBe('')
  })
})
