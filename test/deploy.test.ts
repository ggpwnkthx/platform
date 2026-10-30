import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'bun'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assignmentsOf,
  BOOTSTRAP_FILES,
  checkDeploy,
  checkInfrastructure,
  checkLayout,
  checkMinimumEnvironment,
  checkStacks,
  checkTrackedInfrastructure,
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
