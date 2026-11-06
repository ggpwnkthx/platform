import { describe, expect, test } from 'bun:test'
import { contractOf, differencesOf } from '../src/platform/contract'

/**
 * The contract of the templates of a deployment.
 *
 * The contract is the documents the images read: the route table, the
 * files of the secrets and the variables of the environment. The wizard
 * compares the contract of the checkout with the contract of the
 * release, and the deployment runs the images of the release when the
 * two are the same.
 */

/** The templates of a deployment, with the documents the images read. */
const TEMPLATES: Readonly<Record<string, string>> = {
  'locals.tf': `# The route table of the deployment.
locals {
  gateway_route_table = {
    version = 2
    hosts   = [local.gateway_hostname]
    routes  = [
      {
        id = var.route_id
      }
    ]
  }
}

# The secrets of the deployment.
locals {
  secret_names = toset([
    "gateway-routes",
    "gateway-session-secret",
  ])
}
`,
  'containerapps.tf': `# The secrets that a service reads from a file.
locals {
  gateway_secret_files = [
    "gateway-routes",
  ]

  secret_file_names = {
    "identity-signing-public-key" = "identity-signing.public.pem"
  }

  gateway_env_secrets = {
    GATEWAY_SESSION_SECRET = "gateway-session-secret"
  }
}

resource "azurerm_container_app" "gateway" {
  name = "gateway"

  template {
    container {
      name  = "gateway"
      image = var.gateway_image

      env {
        name  = "GATEWAY_PORT"
        value = "8080"
      }

      dynamic "env" {
        for_each = local.gateway_env_secrets
        content {
          name        = env.key
          secret_name = env.value
        }
      }
    }
  }
}
`,
}

describe('the contract of the templates of a deployment', () => {
  test('the route table the templates write is the contract', () => {
    const contract = contractOf(TEMPLATES)
    expect(contract.routeTable).toContain('version = 2')
    expect(contract.routeTable).toContain('id = var.route_id')
  })

  test('the names of the secrets are the contract', () => {
    const contract = contractOf(TEMPLATES)
    expect(contract.secretNames).toEqual(['gateway-routes', 'gateway-session-secret'])
  })

  test('the files of the secrets a service reads are the contract', () => {
    const contract = contractOf(TEMPLATES)
    expect(contract.secretFiles.gateway).toEqual(['gateway-routes'])
    expect(contract.secretFileNames['identity-signing-public-key']).toBe(
      'identity-signing.public.pem'
    )
  })

  test('the variables of the environment of a service are the contract', () => {
    const contract = contractOf(TEMPLATES)
    // The variable that carries a secret, and the variable that is
    // written in the templates.
    expect(contract.envSecrets.gateway).toEqual(['GATEWAY_SESSION_SECRET'])
    expect(contract.envNames.gateway).toEqual(['GATEWAY_PORT'])
  })

  test('a template that is not there is a document that is not known', () => {
    const contract = contractOf({ 'locals.tf': 'locals {\n}\n' })
    expect(contract.routeTable).toBeNull()
    expect(contract.secretNames).toEqual([])
  })

  test('a bracket in a string is a character and not a bracket', () => {
    const contract = contractOf({
      'locals.tf': 'locals {\n  gateway_route_table = {\n    hosts = ["a{b}c"]\n  }\n}\n',
    })
    expect(contract.routeTable).toBe('{\n    hosts = ["a{b}c"]\n  }')
  })

  test('a bracket in a comment is a comment and not a bracket', () => {
    const contract = contractOf({
      'locals.tf':
        'locals {\n  # a comment with a } in it\n  gateway_route_table = {\n    version = 2\n  }\n}\n',
    })
    expect(contract.routeTable).toBe('{\n    version = 2\n  }')
  })
})

describe('the ways two contracts differ', () => {
  test('two contracts that are the same do not differ', () => {
    expect(differencesOf(contractOf(TEMPLATES), contractOf(TEMPLATES))).toEqual([])
  })

  test('a route table that changed is a difference', () => {
    const there = contractOf(TEMPLATES)
    const here = contractOf({
      ...TEMPLATES,
      'locals.tf': TEMPLATES['locals.tf']!.replace('version = 2', 'version = 3'),
    })
    expect(differencesOf(here, there)).toEqual([
      'the route table the templates write is not the one of the release',
    ])
  })

  test('a name of a secret that changed is a difference', () => {
    const there = contractOf(TEMPLATES)
    const here = contractOf({
      ...TEMPLATES,
      'locals.tf': TEMPLATES['locals.tf']!.replace('gateway-session-secret', 'gateway-secret'),
    })
    expect(differencesOf(here, there)).toContain(
      'the names of the secrets are not the ones of the release'
    )
  })

  test('a file of a secret that changed is a difference', () => {
    const there = contractOf(TEMPLATES)
    const here = contractOf({
      ...TEMPLATES,
      'containerapps.tf': TEMPLATES['containerapps.tf']!.replace(
        '"gateway-routes"',
        '"gateway-configuration"'
      ),
    })
    expect(differencesOf(here, there)).toContain(
      'the files of the secrets the gateway reads are not the ones of the release'
    )
  })

  test('a variable of the environment that changed is a difference', () => {
    const there = contractOf(TEMPLATES)
    const here = contractOf({
      ...TEMPLATES,
      'containerapps.tf': TEMPLATES['containerapps.tf']!.replace(
        'GATEWAY_PORT',
        'GATEWAY_HTTP_PORT'
      ),
    })
    expect(differencesOf(here, there)).toContain(
      'the variables of the environment of the gateway are not the ones of the release'
    )
  })

  test('a document that is not written at all is a difference', () => {
    const there = contractOf(TEMPLATES)
    const here = contractOf({ 'containerapps.tf': TEMPLATES['containerapps.tf']! })
    expect(differencesOf(here, there)).toContain(
      'the route table the templates write is not the one of the release'
    )
  })

  test('the order of the names is not a difference', () => {
    const there = contractOf(TEMPLATES)
    const here = contractOf({
      ...TEMPLATES,
      'locals.tf': TEMPLATES['locals.tf']!.replace(
        '"gateway-routes",\n    "gateway-session-secret",',
        '"gateway-session-secret",\n    "gateway-routes",'
      ),
    })
    expect(differencesOf(here, there)).toEqual([])
  })
})
