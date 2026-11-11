/**
 * The administration of Access.
 *
 * Access holds the tenants, the principals, the groups, the roles and
 * the grants, and it decides what a caller may do. The CLI is a client
 * of that administration: it asks Access to write, and it shows what
 * Access answered.
 *
 * The decision contract is a contract of its own, and the CLI asks it
 * with the credential of the deployment: it never computes a decision.
 */

import { writeFile } from 'node:fs/promises'
import type { GroupSpec } from '../../app/commands'
import { tableOfRecords } from '../../app/output'
import { listOf, numberOf, stringOf } from '../../app/commands'
import type { AccessCall } from '../../domains/access'
import type { CatalogEntry } from '../../domains/catalog'
import { CliFailure } from '../../domains/failure'
import {
  accessContext,
  audit,
  decide,
  listCatalog,
  listCredentials,
  listGroups,
  listPrincipals,
  listGrants,
  listProviders,
  listRoles,
  listRoutes,
  listTenants,
  removeCredential,
  removeProvider,
  removeRole,
  revokeGrant,
  writeCredential,
  writeGrant,
  writeGroup,
  writeProvider,
  writePrincipal,
  writeRole,
  writeRoute,
  writeTenant,
  verifyRoute,
} from '../../domains/access'
import { confirm } from '../../app/prompt'
import { accessCall } from './calls'

/**
 * The rows of a page of the administration.
 *
 * @param body the answer of the administration.
 * @param key the name of the list in the answer.
 */
function rowsOf(body: unknown, key: string): readonly Record<string, unknown>[] {
  if (typeof body !== 'object' || body === null) return []
  const list = (body as Record<string, unknown>)[key]
  if (!Array.isArray(list)) return []
  return list.filter(
    (entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null
  )
}

/**
 * The lines of a list of the administration.
 *
 * @param rows the rows of the list.
 * @param color true when the answer is painted.
 */
function linesOf(rows: readonly Record<string, unknown>[], color: boolean): string[] {
  if (rows.length === 0) return ['there is nothing']
  const columns = [
    'id',
    'key',
    'slug',
    'tenant',
    'email',
    'subject',
    'permission',
    'role',
    'status',
  ]
  const used = columns.filter((column) => rows.some((row) => row[column] !== undefined))
  return tableOfRecords(rows, used, color)
}

/**
 * The lines of the catalog of the providers.
 *
 * @param color true when the answer is painted.
 */
function catalogLines(catalog: readonly CatalogEntry[], color: boolean): string[] {
  const rows = catalog.map((entry) => ({
    key: entry.key,
    name: entry.displayName,
    slug: entry.slug,
    issuer: entry.issuer,
    scopes: entry.scopes.join(' '),
  }))
  const table = tableOfRecords(rows, ['key', 'name', 'slug', 'issuer', 'scopes'], color)
  return [
    ...table,
    '',
    'The steps of a preset are shown by: platformctl access catalog steps <key>',
  ]
}

/**
 * The lines of the steps of a preset of the catalog.
 *
 * @param entry the preset.
 */
function stepsOf(entry: CatalogEntry): string[] {
  return [
    `the issuer of ${entry.displayName} is ${entry.issuer}`,
    ...entry.steps.map((step, index) => `  ${index + 1}. ${step}`),
  ]
}

/**
 * The preset of the catalog, when the operator names one.
 *
 * The catalog is the one of Access: the platform answers the presets it
 * supports, and the CLI reads them there.
 *
 * @param call the parameters of the call.
 * @param named the key the operator named.
 */
async function namedPreset(call: AccessCall, named: unknown): Promise<CatalogEntry | undefined> {
  if (typeof named !== 'string' || named === '') return undefined
  const catalog = await listCatalog(call)
  const found = catalog.find((entry) => entry.key === named)
  if (!found) {
    const known = catalog.map((entry) => entry.key).join(', ')
    throw new CliFailure(
      `the catalog holds no preset named "${named}": it holds ${known}`,
      2,
      'invalid_argument'
    )
  }
  return found
}

/** The group of the administration of Access. */
export const accessGroup: GroupSpec = {
  name: 'access',
  summary: 'the tenants, the principals and the grants of Access',
  description:
    'The administration of Access is written through its API, and a tenant credential acts only for its own tenant.',
  commands: [
    {
      name: 'catalog list',
      summary: 'list the providers the platform supports out of the box',
      description:
        'Every provider of a tenant is an OpenID Connect provider: the catalog is a table of defaults and not a table of drivers. A tenant that brings its own provider names the preset "custom".',
      async run(input) {
        const catalog = await listCatalog(accessCall(input))
        const value = {
          providers: catalog.map((entry) => ({
            key: entry.key,
            displayName: entry.displayName,
            slug: entry.slug,
            issuer: entry.issuer,
            scopes: entry.scopes,
            algorithms: entry.algorithms,
          })),
        }
        return { value, lines: catalogLines(catalog, input.globals.color) }
      },
    },
    {
      name: 'catalog steps',
      summary: 'show how the client of Access is registered at a provider',
      options: [{ name: 'key', kind: 'string', summary: 'the key of the preset' }],
      async run(input) {
        const key = stringOf(input.options, 'key')
        if (!key) {
          throw new CliFailure('the key of the preset is needed', 2, 'missing_argument')
        }
        const catalog = await listCatalog(accessCall(input))
        const entry = catalog.find((candidate) => candidate.key === key)
        if (!entry) {
          const known = catalog.map((candidate) => candidate.key).join(', ')
          throw new CliFailure(
            `the catalog holds no preset named "${key}": it holds ${known}`,
            2,
            'invalid_argument'
          )
        }
        return { value: { key: entry.key, steps: entry.steps }, lines: stepsOf(entry) }
      },
    },
    {
      name: 'tenants list',
      summary: 'list the tenants of the deployment',
      async run(input) {
        const body = await listTenants(accessCall(input))
        const rows = rowsOf(body, 'tenants')
        return { value: body, lines: linesOf(rows, input.globals.color) }
      },
    },
    {
      name: 'tenants create',
      summary: 'register a tenant, or change it',
      description:
        "The call is an upsert by slug: a tenant that exists is changed, and a tenant that does not exist is created. The provider of a tenant is the tenant's own: a call that names no issuer and no client keeps the provider the tenant has, and a tenant that is created is created with the provider it is given.",
      options: [
        { name: 'slug', kind: 'string', summary: 'the slug of the tenant' },
        { name: 'display-name', kind: 'string', summary: 'the name of the tenant' },
        {
          name: 'catalog',
          kind: 'string',
          summary: 'the preset of the provider of the tenant: the platform supports a set of them',
        },
        { name: 'issuer', kind: 'string', summary: 'the issuer of the provider of the tenant' },
        { name: 'idp-client-id', kind: 'string', summary: 'the client of the provider' },
        { name: 'idp-client-secret', kind: 'string', summary: 'the secret of the provider' },
        { name: 'idp-redirect-uri', kind: 'string', summary: 'the callback of the provider' },
        {
          name: 'email-domain',
          kind: 'string',
          summary: 'the domain of the addresses of the tenant',
        },
        { name: 'client-id', kind: 'string', summary: 'the client of the gateway of the tenant' },
        {
          name: 'client-secret',
          kind: 'string',
          summary: 'the secret of the gateway of the tenant',
        },
        { name: 'client-redirect-uri', kind: 'list', summary: 'a callback of the gateway' },
        {
          name: 'shared-client',
          kind: 'boolean',
          summary: 'the tenant shares the client of the platform',
        },
        {
          name: 'auto-provision',
          kind: 'boolean',
          summary:
            'the tenant provisions the identities that sign in for the first time: a principal is created at the first login',
        },
        {
          name: 'auto-provision-admin',
          kind: 'boolean',
          summary:
            'the first identity that signs in administers the tenant: it may add the users and the rights of the tenant',
        },
        { name: 'default', kind: 'boolean', summary: 'the tenant is the default one' },
        { name: 'enabled', kind: 'boolean', summary: 'the tenant is enabled' },
      ],
      examples: [
        'platformctl access tenants create --slug acme --display-name "Acme Inc" --issuer https://login.acme.example',
      ],
      async run(input) {
        const slug = stringOf(input.options, 'slug')
        if (!slug) {
          throw new CliFailure('the slug of the tenant is needed', 2, 'missing_argument')
        }
        const preset = await namedPreset(accessCall(input), input.options.catalog)
        const body: Record<string, unknown> = { slug }
        const displayName = stringOf(input.options, 'display-name')
        const issuer = stringOf(input.options, 'issuer')
        const idpClientId = stringOf(input.options, 'idp-client-id')
        const idpClientSecret = stringOf(input.options, 'idp-client-secret')
        const clientId = stringOf(input.options, 'client-id')
        const clientSecret = stringOf(input.options, 'client-secret')
        if (displayName) body.displayName = displayName
        if (issuer) body.issuer = issuer
        if (idpClientId) body.idpClientId = idpClientId
        if (idpClientSecret) body.idpClientSecret = idpClientSecret
        const idpRedirectUri = stringOf(input.options, 'idp-redirect-uri')
        if (idpRedirectUri) body.idpRedirectUri = idpRedirectUri
        // The preset fills the scopes and the algorithms of the provider
        // of the tenant: they are the ones of the vendor.
        if (preset) {
          body.idpScopes = [...preset.scopes]
          body.idpAlgorithms = [...preset.algorithms]
        }
        const emailDomain = stringOf(input.options, 'email-domain')
        if (emailDomain) body.emailDomain = emailDomain
        if (clientId) body.clientId = clientId
        if (clientSecret) body.clientSecret = clientSecret
        const uris = listOf(input.options, 'client-redirect-uri')
        if (uris.length > 0) body.clientRedirectUris = uris
        if (input.options['shared-client'] === true) body.sharedClient = true
        if (input.options['auto-provision'] === true) body.autoProvision = true
        if (input.options['auto-provision'] === false) body.autoProvision = false
        if (input.options['auto-provision-admin'] === true) body.autoProvisionAdmin = true
        if (input.options['auto-provision-admin'] === false) body.autoProvisionAdmin = false
        if (input.options.default === true) body.default = true
        if (input.options.enabled === true) body.enabled = true
        const written = await writeTenant(accessCall(input), body)
        return { value: written, message: `the tenant "${slug}" is written` }
      },
    },
    {
      name: 'providers list',
      summary: 'list the providers of the deployment',
      options: [
        { name: 'tenant', kind: 'string', summary: 'the slug of the tenant' },
        { name: 'slug', kind: 'string', summary: 'the slug of the provider' },
        { name: 'limit', kind: 'string', summary: 'the size of the page', default: '50' },
        { name: 'offset', kind: 'string', summary: 'the offset of the page', default: '0' },
      ],
      async run(input) {
        const body = await listProviders(accessCall(input), {
          tenant: stringOf(input.options, 'tenant'),
          slug: stringOf(input.options, 'slug'),
          limit: numberOf(input.options, 'limit'),
          offset: numberOf(input.options, 'offset'),
        })
        const rows = rowsOf(body, 'providers')
        return { value: body, lines: linesOf(rows, input.globals.color) }
      },
    },
    {
      name: 'providers create',
      summary: 'register a provider of a tenant, or change it',
      options: [
        { name: 'tenant', kind: 'string', summary: 'the slug of the tenant' },
        { name: 'slug', kind: 'string', summary: 'the slug of the provider in its tenant' },
        {
          name: 'catalog',
          kind: 'string',
          summary: 'the preset of the provider: the platform supports a set of them',
        },
        { name: 'kind', kind: 'string', summary: 'the kind of the provider: oidc or local' },
        { name: 'display-name', kind: 'string', summary: 'the name of the provider' },
        { name: 'issuer', kind: 'string', summary: 'the issuer of the provider' },
        { name: 'idp-client-id', kind: 'string', summary: 'the client of the provider' },
        { name: 'idp-client-secret', kind: 'string', summary: 'the secret of the provider' },
        { name: 'idp-redirect-uri', kind: 'string', summary: 'the callback of the provider' },
        { name: 'idp-scope', kind: 'list', summary: 'a scope Access asks the provider for' },
      ],
      examples: [
        'platformctl access providers create --tenant acme --slug okta --issuer https://login.okta.example',
        'platformctl access providers create --tenant acme --catalog okta --issuer https://acme.okta.example --idp-client-id … --idp-client-secret …',
      ],
      async run(input) {
        const tenant = stringOf(input.options, 'tenant')
        const preset = await namedPreset(accessCall(input), input.options.catalog)
        const slug = stringOf(input.options, 'slug') ?? preset?.slug
        if (!tenant || !slug) {
          throw new CliFailure(
            'the tenant and the slug of the provider are needed',
            2,
            'missing_argument'
          )
        }
        const body: Record<string, unknown> = { tenant, slug }
        const kind = stringOf(input.options, 'kind')
        if (kind) body.kind = kind
        const displayName = stringOf(input.options, 'display-name') ?? preset?.displayName
        const issuer = stringOf(input.options, 'issuer')
        const idpClientId = stringOf(input.options, 'idp-client-id')
        const idpClientSecret = stringOf(input.options, 'idp-client-secret')
        const idpRedirectUri = stringOf(input.options, 'idp-redirect-uri')
        if (displayName) body.displayName = displayName
        if (issuer) body.issuer = issuer
        if (idpClientId) body.idpClientId = idpClientId
        if (idpClientSecret) body.idpClientSecret = idpClientSecret
        if (idpRedirectUri) body.idpRedirectUri = idpRedirectUri
        const scopes = listOf(input.options, 'idp-scope')
        if (scopes.length > 0) body.idpScopes = scopes
        else if (preset) body.idpScopes = [...preset.scopes]
        if (preset) body.idpAlgorithms = [...preset.algorithms]
        const written = await writeProvider(accessCall(input), body)
        return {
          value: written,
          message: `the provider "${slug}" is written`,
          lines: preset ? stepsOf(preset) : [],
        }
      },
    },
    {
      name: 'providers remove',
      summary: 'remove a provider that holds no principal',
      options: [{ name: 'id', kind: 'string', summary: 'the identifier of the provider' }],
      async run(input) {
        const id = stringOf(input.options, 'id')
        if (!id) {
          throw new CliFailure('the identifier of the provider is needed', 2, 'missing_argument')
        }
        const removed = await removeProvider(accessCall(input), id)
        return { value: removed, message: 'the provider is removed' }
      },
    },
    {
      name: 'routes list',
      summary: 'the routes of the logins',
      options: [
        { name: 'tenant', kind: 'string', summary: 'the slug of the tenant' },
        { name: 'kind', kind: 'string', summary: 'the kind of the key: domain or address' },
        { name: 'limit', kind: 'string', summary: 'the size of the page', default: '50' },
        { name: 'offset', kind: 'string', summary: 'the offset of the page', default: '0' },
      ],
      async run(input) {
        const body = await listRoutes(accessCall(input), {
          tenant: stringOf(input.options, 'tenant'),
          kind: stringOf(input.options, 'kind'),
          limit: numberOf(input.options, 'limit'),
          offset: numberOf(input.options, 'offset'),
        })
        const rows = rowsOf(body, 'routes')
        return { value: body, lines: linesOf(rows, input.globals.color) }
      },
    },
    {
      name: 'routes create',
      summary: 'register a route of the logins, or change it',
      description:
        'A route names the tenant of a login and the provider the login signs in at. A route waits for its proof: it routes nothing until the owner of the domain publishes the challenge, or the operator of the platform vouches for it.',
      options: [
        { name: 'tenant', kind: 'string', summary: 'the slug of the tenant' },
        { name: 'kind', kind: 'string', summary: 'the kind of the key: domain or address' },
        { name: 'key', kind: 'string', summary: 'the domain of the addresses, or the address' },
        {
          name: 'provider',
          kind: 'string',
          summary: 'the provider of the tenant the login signs in at',
        },
      ],
      examples: [
        'platformctl access routes create --tenant acme --key acme.example',
        'platformctl access routes create --tenant acme --key alice@partner.example --kind address',
      ],
      async run(input) {
        const tenant = stringOf(input.options, 'tenant')
        const key = stringOf(input.options, 'key')
        if (!tenant || !key) {
          throw new CliFailure(
            'the tenant and the key of the route are needed',
            2,
            'missing_argument'
          )
        }
        const body: Record<string, unknown> = { tenant, key }
        const kind = stringOf(input.options, 'kind')
        const provider = stringOf(input.options, 'provider')
        if (kind) body.kind = kind
        if (provider) body.provider = provider
        const written = await writeRoute(accessCall(input), body)
        const route = (written as { route?: Record<string, unknown> }).route ?? {}
        return {
          value: written,
          message: `the route "${key}" is written`,
          lines: [
            `the route waits for its proof: publish the record _access.${key} with the challenge ${String(route.challenge ?? '')}`,
          ],
        }
      },
    },
    {
      name: 'routes verify',
      summary: 'verify a route of the logins, or refuse it',
      description:
        'The proof of a domain is the record its owner publishes: the service reads the record of _access of the domain and compares it with the challenge of the route. The operator of the platform may vouch for a domain instead, and only the operator of the platform may.',
      options: [
        { name: 'id', kind: 'string', summary: 'the identifier of the route' },
        {
          name: 'verification',
          kind: 'string',
          summary: 'the method of the proof: dns or operator',
          default: 'operator',
        },
        {
          name: 'reject',
          kind: 'boolean',
          summary: 'refuse the route instead of verifying it',
        },
      ],
      async run(input) {
        const id = stringOf(input.options, 'id')
        if (!id) {
          throw new CliFailure('the identifier of the route is needed', 2, 'missing_argument')
        }
        const method = stringOf(input.options, 'verification') ?? 'operator'
        if (method !== 'dns' && method !== 'operator') {
          throw new CliFailure('the method of the proof is dns or operator', 2, 'invalid_argument')
        }
        const written = await verifyRoute(accessCall(input), id, {
          status: input.options.reject === true ? 'rejected' : 'verified',
          verification: method,
        })
        return { value: written, message: `the route "${id}" is proved` }
      },
    },
    {
      name: 'credentials list',
      summary: 'list the accounts of the local providers',
      options: [
        { name: 'tenant', kind: 'string', summary: 'the slug of the tenant' },
        { name: 'provider', kind: 'string', summary: 'the slug of the local provider' },
        { name: 'email', kind: 'string', summary: 'the address of the account' },
        { name: 'limit', kind: 'string', summary: 'the size of the page', default: '50' },
        { name: 'offset', kind: 'string', summary: 'the offset of the page', default: '0' },
      ],
      async run(input) {
        const body = await listCredentials(accessCall(input), {
          tenant: stringOf(input.options, 'tenant'),
          provider: stringOf(input.options, 'provider'),
          email: stringOf(input.options, 'email'),
          limit: numberOf(input.options, 'limit'),
          offset: numberOf(input.options, 'offset'),
        })
        const rows = rowsOf(body, 'credentials')
        return { value: body, lines: linesOf(rows, input.globals.color) }
      },
    },
    {
      name: 'credentials create',
      summary: 'write the account of a caller of a local provider, or change its password',
      options: [
        { name: 'tenant', kind: 'string', summary: 'the slug of the tenant' },
        { name: 'provider', kind: 'string', summary: 'the slug of the local provider' },
        { name: 'email', kind: 'string', summary: 'the address of the account' },
        { name: 'password', kind: 'string', summary: 'the password of the account' },
        { name: 'status', kind: 'string', summary: 'the status of the account' },
      ],
      examples: [
        'platformctl access credentials create --tenant acme --provider local --email alice@acme.example --password a-long-password',
      ],
      async run(input) {
        const tenant = stringOf(input.options, 'tenant')
        const provider = stringOf(input.options, 'provider')
        const email = stringOf(input.options, 'email')
        const password = stringOf(input.options, 'password')
        if (!tenant || !provider || !email || !password) {
          throw new CliFailure(
            'the tenant, the provider, the address and the password are needed',
            2,
            'missing_argument'
          )
        }
        const body: Record<string, unknown> = { tenant, provider, email, password }
        const status = stringOf(input.options, 'status')
        if (status) body.status = status
        const written = await writeCredential(accessCall(input), body)
        return { value: written, message: `the account "${email}" is written` }
      },
    },
    {
      name: 'credentials remove',
      summary: 'remove the account of a caller of a local provider',
      options: [{ name: 'id', kind: 'string', summary: 'the identifier of the account' }],
      async run(input) {
        const id = stringOf(input.options, 'id')
        if (!id) {
          throw new CliFailure('the identifier of the account is needed', 2, 'missing_argument')
        }
        const removed = await removeCredential(accessCall(input), id)
        return { value: removed, message: 'the account is removed' }
      },
    },
    {
      name: 'principals list',
      summary: 'list the principals of the deployment',
      options: [
        { name: 'tenant', kind: 'string', summary: 'the slug of the tenant' },
        { name: 'status', kind: 'string', summary: 'the status of the principals' },
        { name: 'email', kind: 'string', summary: 'the address of the principal' },
        { name: 'limit', kind: 'string', summary: 'the size of the page', default: '50' },
        { name: 'offset', kind: 'string', summary: 'the offset of the page', default: '0' },
      ],
      async run(input) {
        const body = await listPrincipals(accessCall(input), {
          tenant: stringOf(input.options, 'tenant'),
          status: stringOf(input.options, 'status'),
          email: stringOf(input.options, 'email'),
          limit: numberOf(input.options, 'limit'),
          offset: numberOf(input.options, 'offset'),
        })
        const rows = rowsOf(body, 'principals')
        return { value: body, lines: linesOf(rows, input.globals.color) }
      },
    },
    {
      name: 'principals create',
      summary: 'register a principal, or change it',
      options: [
        { name: 'tenant', kind: 'string', summary: 'the slug of the tenant' },
        { name: 'subject', kind: 'string', summary: 'the subject of the provider' },
        {
          name: 'provider',
          kind: 'string',
          summary: 'the slug of the provider the principal belongs to',
        },
        { name: 'email', kind: 'string', summary: 'the address of the principal' },
        { name: 'display-name', kind: 'string', summary: 'the name of the principal' },
        { name: 'status', kind: 'string', summary: 'the status of the principal' },
      ],
      async run(input) {
        const tenant = stringOf(input.options, 'tenant')
        const subject = stringOf(input.options, 'subject')
        if (!tenant || !subject) {
          throw new CliFailure(
            'the tenant and the subject of the principal are needed',
            2,
            'missing_argument'
          )
        }
        const body: Record<string, unknown> = { tenant, externalSubject: subject }
        const provider = stringOf(input.options, 'provider')
        if (provider) body.provider = provider
        const email = stringOf(input.options, 'email')
        const displayName = stringOf(input.options, 'display-name')
        const status = stringOf(input.options, 'status')
        if (email) body.email = email
        if (displayName) body.displayName = displayName
        if (status) body.status = status
        const written = await writePrincipal(accessCall(input), body)
        return { value: written, message: 'the principal is written' }
      },
    },
    {
      name: 'principals import',
      summary: 'register a batch of principals',
      description:
        'The batch holds the principals of the file, and the items of the batch are written one by one: a failed item does not stop the others.',
      options: [{ name: 'file', kind: 'string', summary: 'the file of the batch' }],
      examples: ['platformctl access principals import --file ./principals.json'],
      async run(input) {
        const path = stringOf(input.options, 'file')
        if (!path) {
          throw new CliFailure('the file of the batch is needed', 2, 'missing_argument')
        }
        const { readFile } = await import('node:fs/promises')
        let parsed: unknown
        try {
          parsed = JSON.parse(await readFile(path, 'utf8'))
        } catch {
          throw new CliFailure(
            `the file ${path} does not hold a batch of principals`,
            8,
            'invalid_file'
          )
        }
        const batch = Array.isArray(parsed) ? { principals: parsed } : parsed
        const written = await writePrincipal(accessCall(input), batch)
        return { value: written, message: 'the batch of principals is written' }
      },
    },
    {
      name: 'grants list',
      summary: 'list the grants of the deployment',
      options: [
        { name: 'tenant', kind: 'string', summary: 'the slug of the tenant' },
        { name: 'user-id', kind: 'string', summary: 'the id of a principal' },
        {
          name: 'live',
          kind: 'boolean',
          summary: 'the grants that are neither revoked nor expired',
        },
        { name: 'limit', kind: 'string', summary: 'the size of the page', default: '50' },
        { name: 'offset', kind: 'string', summary: 'the offset of the page', default: '0' },
      ],
      async run(input) {
        const body = await listGrants(accessCall(input), {
          tenant: stringOf(input.options, 'tenant'),
          userId: stringOf(input.options, 'user-id'),
          live: input.options.live === true ? 'true' : undefined,
          limit: numberOf(input.options, 'limit'),
          offset: numberOf(input.options, 'offset'),
        })
        const rows = rowsOf(body, 'grants')
        return { value: body, lines: linesOf(rows, input.globals.color) }
      },
    },
    {
      name: 'grants put',
      summary: 'give a grant, or change it',
      options: [
        { name: 'tenant', kind: 'string', summary: 'the slug of the tenant' },
        { name: 'user-id', kind: 'string', summary: 'the id of the principal' },
        { name: 'group', kind: 'string', summary: 'the key of the group' },
        { name: 'permission', kind: 'string', summary: 'the key of the permission' },
        { name: 'role', kind: 'string', summary: 'the key of the role' },
        { name: 'workspace-id', kind: 'string', summary: 'the workspace of the grant' },
        { name: 'route-id', kind: 'string', summary: 'the route of the grant' },
        { name: 'expires-at', kind: 'string', summary: 'the moment the grant ends' },
        { name: 'granted-by', kind: 'string', summary: 'who gave the grant' },
      ],
      examples: [
        'platformctl access grants put --tenant acme --user-id b1c2 --permission workspace.read',
      ],
      async run(input) {
        const tenant = stringOf(input.options, 'tenant')
        if (!tenant) {
          throw new CliFailure('the tenant of the grant is needed', 2, 'missing_argument')
        }
        const body: Record<string, unknown> = { tenant }
        const userId = stringOf(input.options, 'user-id')
        const group = stringOf(input.options, 'group')
        if (!userId && !group) {
          throw new CliFailure(
            'a principal or a group is needed: pass --user-id or --group',
            2,
            'missing_argument'
          )
        }
        if (userId) body.userId = userId
        if (group) body.group = group
        const permission = stringOf(input.options, 'permission')
        const role = stringOf(input.options, 'role')
        if (!permission && !role) {
          throw new CliFailure(
            'a permission or a role is needed: pass --permission or --role',
            2,
            'missing_argument'
          )
        }
        if (permission) body.permission = permission
        if (role) body.role = role
        const workspaceId = stringOf(input.options, 'workspace-id')
        const routeId = stringOf(input.options, 'route-id')
        const expiresAt = stringOf(input.options, 'expires-at')
        const grantedBy = stringOf(input.options, 'granted-by')
        if (workspaceId) body.workspaceId = workspaceId
        if (routeId) body.routeId = routeId
        if (expiresAt) body.expiresAt = expiresAt
        if (grantedBy) body.grantedBy = grantedBy
        const written = await writeGrant(accessCall(input), body)
        return { value: written, message: 'the grant is written' }
      },
    },
    {
      name: 'grants revoke',
      summary: 'revoke a grant',
      arguments: [{ name: 'id', summary: 'the id of the grant', required: true }],
      async run(input) {
        const id = input.args[0]
        if (!id) {
          throw new CliFailure('the id of the grant is needed', 2, 'missing_argument')
        }
        await confirm(`the grant "${id}" is revoked?`, input.globals.yes)
        const revoked = await revokeGrant(accessCall(input), id)
        return {
          value: { id, revoked: revoked ?? { id } },
          message: `the grant "${id}" is revoked`,
        }
      },
    },
    {
      name: 'groups list',
      summary: 'list the groups of the deployment',
      options: [
        { name: 'tenant', kind: 'string', summary: 'the slug of the tenant' },
        { name: 'key', kind: 'string', summary: 'the key of the group' },
      ],
      async run(input) {
        const body = await listGroups(accessCall(input), {
          tenant: stringOf(input.options, 'tenant'),
          key: stringOf(input.options, 'key'),
        })
        const rows = rowsOf(body, 'groups')
        return { value: body, lines: linesOf(rows, input.globals.color) }
      },
    },
    {
      name: 'groups create',
      summary: 'write a group, or change it',
      options: [
        { name: 'tenant', kind: 'string', summary: 'the slug of the tenant' },
        { name: 'key', kind: 'string', summary: 'the key of the group' },
        { name: 'display-name', kind: 'string', summary: 'the name of the group' },
        { name: 'member', kind: 'list', summary: 'the subject of a member' },
      ],
      async run(input) {
        const tenant = stringOf(input.options, 'tenant')
        const key = stringOf(input.options, 'key')
        if (!tenant || !key) {
          throw new CliFailure(
            'the tenant and the key of the group are needed',
            2,
            'missing_argument'
          )
        }
        const body: Record<string, unknown> = { tenant, key }
        const displayName = stringOf(input.options, 'display-name')
        if (displayName) body.displayName = displayName
        const members = listOf(input.options, 'member')
        if (members.length > 0) body.members = members
        const written = await writeGroup(accessCall(input), body)
        return { value: written, message: `the group "${key}" is written` }
      },
    },
    {
      name: 'roles list',
      summary: 'list the roles of the deployment',
      options: [
        { name: 'tenant', kind: 'string', summary: 'the slug of the tenant' },
        { name: 'key', kind: 'string', summary: 'the key of the role' },
      ],
      async run(input) {
        const body = await listRoles(accessCall(input), {
          tenant: stringOf(input.options, 'tenant'),
          key: stringOf(input.options, 'key'),
        })
        const rows = rowsOf(body, 'roles')
        return { value: body, lines: linesOf(rows, input.globals.color) }
      },
    },
    {
      name: 'roles put',
      summary: 'write a role, or change it',
      description:
        'The write replaces the role: the permissions that are not in it are not in the role anymore.',
      options: [
        { name: 'tenant', kind: 'string', summary: 'the slug of the tenant' },
        { name: 'key', kind: 'string', summary: 'the key of the role' },
        { name: 'display-name', kind: 'string', summary: 'the name of the role' },
        { name: 'description', kind: 'string', summary: 'what the role is for' },
        { name: 'permission', kind: 'list', summary: 'the key of a permission of the role' },
        { name: 'role', kind: 'list', summary: 'the key of a role of the role' },
      ],
      async run(input) {
        const tenant = stringOf(input.options, 'tenant')
        const key = stringOf(input.options, 'key')
        if (!tenant || !key) {
          throw new CliFailure(
            'the tenant and the key of the role are needed',
            2,
            'missing_argument'
          )
        }
        const body: Record<string, unknown> = { tenant, key }
        const displayName = stringOf(input.options, 'display-name')
        const description = stringOf(input.options, 'description')
        if (displayName) body.displayName = displayName
        if (description) body.description = description
        const permissions = listOf(input.options, 'permission')
        const roles = listOf(input.options, 'role')
        if (permissions.length > 0) body.permissions = permissions
        if (roles.length > 0) body.roles = roles
        const written = await writeRole(accessCall(input), body)
        return { value: written, message: `the role "${key}" is written` }
      },
    },
    {
      name: 'roles remove',
      summary: 'remove a role',
      arguments: [{ name: 'id', summary: 'the id of the role', required: true }],
      async run(input) {
        const id = input.args[0]
        if (!id) {
          throw new CliFailure('the id of the role is needed', 2, 'missing_argument')
        }
        await confirm(`the role "${id}" is removed?`, input.globals.yes)
        const removed = await removeRole(accessCall(input), id)
        return {
          value: { id, removed: removed ?? { id } },
          message: `the role "${id}" is removed`,
        }
      },
    },
    {
      name: 'audit list',
      summary: 'show the audit of the administration',
      options: [
        { name: 'tenant', kind: 'string', summary: 'the slug of the tenant' },
        { name: 'action', kind: 'string', summary: 'the action of the records' },
        { name: 'limit', kind: 'string', summary: 'the size of the page', default: '50' },
        { name: 'offset', kind: 'string', summary: 'the offset of the page', default: '0' },
      ],
      async run(input) {
        const body = await audit(accessCall(input), {
          tenant: stringOf(input.options, 'tenant'),
          action: stringOf(input.options, 'action'),
          limit: numberOf(input.options, 'limit'),
          offset: numberOf(input.options, 'offset'),
        })
        const rows = rowsOf(body, 'records')
        return { value: body, lines: linesOf(rows, input.globals.color) }
      },
    },
    {
      name: 'audit export',
      summary: 'export the audit of the administration',
      options: [
        { name: 'tenant', kind: 'string', summary: 'the slug of the tenant' },
        { name: 'action', kind: 'string', summary: 'the action of the records' },
        {
          name: 'format',
          kind: 'string',
          summary: 'the format of the export',
          placeholder: 'csv|jsonl',
          default: 'csv',
        },
        { name: 'out', kind: 'string', summary: 'the file of the export' },
      ],
      async run(input) {
        const format = stringOf(input.options, 'format') ?? 'csv'
        if (format !== 'csv' && format !== 'jsonl') {
          throw new CliFailure('the format of the export is csv or jsonl', 2, 'invalid_format')
        }
        const url = new URL(`${accessCall(input).baseUrl}/v1/admin/audit`)
        url.searchParams.set('format', format)
        const tenant = stringOf(input.options, 'tenant')
        const action = stringOf(input.options, 'action')
        if (tenant) url.searchParams.set('tenant', tenant)
        if (action) url.searchParams.set('action', action)
        const answer = await input.services.http.send({
          method: 'GET',
          url: url.toString(),
          token: accessCall(input).token,
        })
        if (answer.status < 200 || answer.status >= 300) {
          throw new CliFailure(
            `the export of the audit is refused: ${answer.status}`,
            answer.status === 401 ? 3 : 1,
            'export_refused'
          )
        }
        const path = stringOf(input.options, 'out')
        if (!path) {
          return { value: answer.body }
        }
        await writeFile(path, answer.body)
        return { value: { file: path, format }, message: `the export is written in ${path}` }
      },
    },
    {
      name: 'decide',
      summary: 'ask Access for a decision',
      description:
        'The decision is the answer of Access: the CLI asks the question and shows the answer, and it never computes a decision of its own.',
      options: [
        { name: 'subject', kind: 'string', summary: 'the subject of the principal' },
        { name: 'workspace', kind: 'string', summary: 'the workspace of the question' },
        { name: 'route', kind: 'string', summary: 'the route of the question' },
        { name: 'role', kind: 'list', summary: 'a role of the principal' },
        { name: 'decision-token', kind: 'string', summary: 'the credential of the decision' },
      ],
      examples: ['platformctl access decide --subject 00u1a2b3c4d5 --workspace acme'],
      async run(input) {
        const subject = stringOf(input.options, 'subject')
        if (!subject) {
          throw new CliFailure('the subject of the principal is needed', 2, 'missing_argument')
        }
        const question: Record<string, unknown> = { subject }
        const workspace = stringOf(input.options, 'workspace')
        const route = stringOf(input.options, 'route')
        const roles = listOf(input.options, 'role')
        if (workspace) question.workspaceId = workspace
        if (route) question.routeId = route
        if (roles.length > 0) question.roles = roles
        const answer = (await decide(
          accessCall(input),
          question,
          stringOf(input.options, 'decision-token') ?? input.context.adminToken
        )) as { allow?: boolean; reason?: string; reasonCode?: string }
        return {
          value: answer,
          lines: [
            answer.allow === true ? 'allow' : 'deny',
            answer.reason ?? '',
            answer.reasonCode ? `(${answer.reasonCode})` : '',
          ].filter((line) => line !== ''),
          exit: answer.allow === true ? 0 : 6,
        }
      },
    },
    {
      name: 'context',
      summary: 'read the capabilities of a principal in a workspace',
      options: [
        { name: 'subject', kind: 'string', summary: 'the subject of the principal' },
        { name: 'workspace', kind: 'string', summary: 'the workspace of the question' },
        { name: 'route', kind: 'string', summary: 'the route of the question' },
        { name: 'context-token', kind: 'string', summary: 'the credential of the context' },
      ],
      async run(input) {
        const subject = stringOf(input.options, 'subject')
        const workspace = stringOf(input.options, 'workspace')
        if (!subject || !workspace) {
          throw new CliFailure('the subject and the workspace are needed', 2, 'missing_argument')
        }
        const question: Record<string, unknown> = { subject, workspaceId: workspace }
        const route = stringOf(input.options, 'route')
        if (route) question.routeId = route
        const answer = await accessContext(
          accessCall(input),
          question,
          stringOf(input.options, 'context-token') ?? input.context.adminToken
        )
        return { value: answer }
      },
    },
  ],
}
