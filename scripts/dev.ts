#!/usr/bin/env bun
/**
 * The development runner of the platform.
 *
 * It starts the three services of the platform and the infrastructure
 * they share, in the mode of a development machine:
 *
 *   - the PostgreSQL server   (the server of the development machine,
 *                              or a container when the machine has no
 *                              binaries of PostgreSQL)
 *   - the identity provider   (the fixture of the gateway, on :5556)
 *   - Access      (:8081)
 *   - Data        (:8082)
 *   - the gateway             (:8080)
 *   - the console             (:8083)
 *
 * The command:
 *
 *   bun run dev
 *
 * The flags:
 *
 *   --fresh   the data of the PostgreSQL server is removed before the run
 *   --help    the usage of the command
 *
 * The runner writes the files of the machine in `.tmp/dev/`: the route
 * table of the gateway, the bindings of Data, the key of the
 * cursors and the credential of the access context contract. The files
 * are generated: they are not in the repository.
 *
 * The machine has **one** PostgreSQL server, and every service has its
 * own database on it: `data` for Data, `access` for the
 * Access. The state of the machine is therefore the data
 * directory of the server alone (`.pg/`, or the volume of the container
 * when the machine has no binaries of PostgreSQL).
 *
 * The runner seeds Access with a tenant, a principal, a
 * group, the roles of the permissions and the grants of the development
 * and the grants of the console, and it registers the workspace in the
 * registry of Data. The seed is idempotent: a run
 * that finds the tenant of the development changes it.
 *
 * The runner of the gateway alone is `bun run dev:gateway`: it starts
 * the gateway with its fixtures, and it needs nothing but bun.
 */

import { spawn, type Subprocess } from 'bun'
import { generateKeyPairSync } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'
import { startPostgres, type StartedPostgres } from '../tooling/postgres'

/** The root of the repository. */
const root = resolve(import.meta.dir, '..')

/** The directory of the files of the run. */
const work = join(root, '.tmp', 'dev')

/** The ports of the services of the development machine. */
const PORTS = {
  gateway: 8080,
  access: 8081,
  data: 8082,
  console: 8083,
  identity: 5556,
} as const

/** The url of Access. */
const accessUrl = `http://127.0.0.1:${PORTS.access}`

/** The url of the identity provider of the development. */
const identityUrl = `http://127.0.0.1:${PORTS.identity}`

/** The url of the gateway, as the browser reaches it. */
const gatewayUrl = `http://localhost:${PORTS.gateway}`

/** The url of the console, as the browser reaches it. */
const consoleUrl = `http://localhost:${PORTS.console}`

/**
 * The host the caller uses.
 *
 * The route table names a host without a port: the gateway strips the
 * port of the host of the caller before it matches it. The bindings of
 * Data name the host as the gateway writes it in
 * `x-forwarded-host`, and the port is part of it.
 */
const routeHost = 'localhost'
const bindingHost = `localhost:${PORTS.gateway}`

/** The secrets of the development. They are fixtures, and not secrets. */
const SECRETS = {
  adminToken: 'dev-admin-token-0000000',
  accessToken: 'dev-access-token-0000000',
  contextToken: 'dev-context-token-00000001',
  stateSecret: 'dev-state-secret-of-the-development-0001',
  encryptionKey: 'dev-encryption-key-of-the-development-01',
  sessionSecret: 'dev-session-secret-of-the-development-1',
  consoleSessionSecret: 'dev-console-session-secret-of-the-dev-01',
  tenantToken: 'dev-tenant-token-of-the-development-01',
  gatewayClientSecret: 'dev-gateway-client-secret-00001',
  identityClientSecret: 'dev-identity-client-secret-0001',
  ownerPassword: 'dev-owner-password-0000001',
  runtimePassword: 'dev-runtime-password-00001',
  accessOwnerPassword: 'dev-access-owner-password-001',
  registryPassword: 'dev-registry-password-00001',
  deliveryPassword: 'dev-delivery-password-00001',
  maintenancePassword: 'dev-maintenance-password-001',
} as const

/** The tenant of the development. */
const TENANT = {
  slug: 'acme',
  displayName: 'Acme',
  /** The client of the gateway at Access. */
  clientId: 'platform',
} as const

/** The workspace of the development. */
const WORKSPACE = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'acme',
  displayName: 'Acme',
} as const

/** The principal of the development, at the identity provider. */
const PRINCIPAL = {
  externalSubject: 'user-alice',
  email: 'alice@gateway.test',
} as const

/** The group of the principals of the development. */
const GROUP = 'editors'

/** The route of Data. */
const ROUTE = 'data-api'

/** The route of the console in Access. */
const CONSOLE_ROUTE = 'console'

/** The services of the run, and the way to stop them. */
const running: Subprocess[] = []

/** The PostgreSQL server of the run, and the way to stop it. */
let postgres: StartedPostgres | undefined

/** Writes a line of the runner. */
function say(message: string): void {
  console.log(message)
}

/** Runs a command and waits for it. */
async function run(
  name: string,
  command: string[],
  cwd: string,
  env: Record<string, string> = {}
): Promise<void> {
  const child = spawn(command, {
    cwd,
    env: { ...process.env, ...env },
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const code = await child.exited
  if (code !== 0) {
    throw new Error(`${name} failed with the status ${code}`)
  }
}

/** Starts a service of the platform and leaves it running. */
function start(
  name: string,
  command: string[],
  cwd: string,
  env: Record<string, string>
): Subprocess {
  say(`  ${name.padEnd(16)} starting`)
  const child = spawn(command, {
    cwd,
    env: { ...process.env, ...env },
    stdout: 'inherit',
    stderr: 'inherit',
  })
  running.push(child)
  return child
}

/**
 * Reports whether a port is free.
 *
 * A port that is taken is the reason a run of the machine fails, and the
 * operator has to know it before the services start.
 */
async function isFree(port: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const server = createServer()
    server.unref()
    server.on('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true))
    })
  })
}

/**
 * The packages of the console, and the modules the development needs
 * from them.
 *
 * The console is the only package of the platform that is built by
 * Vite, and the modules it needs are the ones of its own directory:
 * the runtime of the JSX of the server, the application of HonoX and
 * the server of the development itself.
 */
const CONSOLE_DEPENDENCIES = ['hono', 'honox', 'jose'] as const
const CONSOLE_MODULES = ['hono/jsx/jsx-dev-runtime', 'honox/server', 'vite'] as const

/**
 * Reports what the console misses to serve a page.
 *
 * A console whose dependencies are missing serves no page, and the
 * error it fails with names a module rather than a cause. The runner
 * looks for the dependencies of the console before the machine starts,
 * and says whether they are missing from the manifest of the package
 * or missing from the installation: the two have two different
 * remedies.
 */
async function consoleMisses(): Promise<string[]> {
  const directory = join(root, 'packages', 'console')
  const misses: string[] = []
  // The console is a package of the repository: Bun installs the
  // dependencies of a package that the root of the repository names.
  // A console the root does not name has no dependencies at all, and
  // the installation says nothing about it.
  if (!(await consoleIsAWorkspace())) {
    misses.push(
      'packages/console is not a workspace of the repository: add "packages/console" to the ' +
        '"workspaces" of the package.json of the root, and run `bun install`'
    )
  }
  let declared: Record<string, string> = {}
  try {
    const manifest = (await Bun.file(join(directory, 'package.json')).json()) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    declared = { ...manifest.dependencies, ...manifest.devDependencies }
  } catch {
    misses.push('packages/console/package.json cannot be read')
    return misses
  }
  for (const name of CONSOLE_DEPENDENCIES) {
    if (!declared[name]) {
      misses.push(
        `${name} is not a dependency of the console: add it to the dependencies of ` +
          'packages/console/package.json, and run `bun install`'
      )
    }
  }
  for (const module of CONSOLE_MODULES) {
    try {
      Bun.resolveSync(module, directory)
    } catch {
      misses.push(`${describeMissingModule(module, directory)}`)
    }
  }
  // Every dependency of the console has to be **installed**: the
  // manifest of the package names them, and the installation is what the
  // pages load. A dependency that the manifest names and the
  // installation does not have is a console that fails on its first
  // page, and the failure names a module instead of a remedy.
  for (const name of Object.keys(declared)) {
    try {
      Bun.resolveSync(name, directory)
    } catch {
      misses.push(describeMissingModule(name, directory))
    }
  }
  return misses
}

/**
 * Reports whether the console is a workspace of the repository.
 *
 * The root of the repository names its workspaces, and Bun installs the
 * dependencies of the packages it names. A console that the root does
 * not name is a directory of sources, and no installation reaches it.
 */
async function consoleIsAWorkspace(): Promise<boolean> {
  try {
    const manifest = (await Bun.file(join(root, 'package.json')).json()) as {
      workspaces?: string[]
    }
    const workspaces = manifest.workspaces ?? []
    return workspaces.some((workspace) => {
      if (workspace === 'packages/console') return true
      if (!workspace.endsWith('/*')) return false
      return 'packages/console'.startsWith(workspace.slice(0, -1))
    })
  } catch {
    return false
  }
}

/**
 * Describes a module of the console that cannot be resolved.
 *
 * A package that is not installed at all and a package whose
 * installation misses one of its files are two different faults, and
 * they have two different remedies: the first is an installation that
 * is not made, the second is an installation that is not whole.
 */
function describeMissingModule(module: string, directory: string): string {
  const segments = module.split('/')
  const name = module.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]
  try {
    const entry = Bun.resolveSync(name, directory)
    return (
      `${module} is missing from the installation of ${name} (${entry}): run ` +
      '`bun install --force` in the root of the repository, and clear the cache of Bun ' +
      '(~/.bun/install/cache) when the package is still not whole'
    )
  } catch {
    return `${name} is not installed in packages/console: run \`bun install --force\` in the root of the repository`
  }
}

/** Waits for a service to answer its health check. */
async function waitFor(name: string, url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.status < 500) return
    } catch {
      // The service is not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`${name} did not answer at ${url}`)
}

/** Calls the administration of Access. */
async function admin(
  path: string,
  body: unknown,
  method = 'POST'
): Promise<Record<string, unknown>> {
  const response = await fetch(`${accessUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${SECRETS.adminToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`the administration of Access failed at ${path}: ${text}`)
  }
  return JSON.parse(text) as Record<string, unknown>
}

/**
 * Writes the files of the development machine.
 *
 * The pair of the identity signature is generated for the run: the
 * gateway holds the private half and Data holds the public
 * one, and the upstreams of the run verify the identities with it.
 */
async function writeFiles(): Promise<{
  privateKey: string
  signingKey: string
  contextTokenFile: string
  cursorKeyFile: string
  bindingsFile: string
  routesFile: string
}> {
  await mkdir(work, { recursive: true })

  const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const publicKeyFile = join(work, 'identity-signing.public.pem')
  await writeFile(publicKeyFile, pair.publicKey.export({ type: 'spki', format: 'pem' }).toString())

  // The key of the tokens of Access: the gateway reads it
  // in the JWKS of the service, and a service without a key cannot issue
  // a token. The tokens of the service are signed with RS256.
  const signing = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const signingKey = signing.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()

  const routesFile = join(work, 'routes.json')
  await writeFile(
    routesFile,
    `${JSON.stringify(
      {
        version: 1,
        defaults: {
          auth: { mode: 'none' },
          timeouts: { responseMs: 5000, firstByteMs: 30000, bodyMs: 300000 },
          maxBodyBytes: 10485760,
        },
        trustedProxies: ['127.0.0.1/32', '::1/128'],
        routes: [
          {
            id: ROUTE,
            match: { host: routeHost, path: '/ws/{workspaceId}/' },
            upstream: `http://127.0.0.1:${PORTS.data}`,
            auth: { mode: 'any', workspace: { param: 'workspaceId', requireUuid: true } },
            websocket: true,
            accessCacheTtlMs: 0,
          },
        ],
      },
      null,
      2
    )}\n`
  )

  const bindingsFile = join(work, 'bindings.json')
  await writeFile(
    bindingsFile,
    `${JSON.stringify(
      {
        version: 2,
        bindings: [
          {
            id: ROUTE,
            host: bindingHost,
            upstreamPathPattern: '/ws/{workspaceId}/v1/*',
            routeId: ROUTE,
            identity: { version: 'v5', algorithm: 'ES256', publicKeyFile },
          },
        ],
      },
      null,
      2
    )}\n`
  )

  const cursorKeyFile = join(work, 'cursor.key')
  await writeFile(cursorKeyFile, 'dev-cursor-key-of-the-development-0001\n')

  const contextTokenFile = join(work, 'access-context.token')
  await writeFile(contextTokenFile, `${SECRETS.contextToken}\n`)

  return { privateKey, signingKey, contextTokenFile, cursorKeyFile, bindingsFile, routesFile }
}

/**
 * Seeds Access.
 *
 * The tenant of the development is registered against the identity
 * provider of the run, the principal is the one of the provider, the
 * group holds the rights of the editors, the roles are the named sets
 * of the permissions, and the grants are the ones of the route of the
 * Data and the ones of the route of the console.
 *
 * The answer is the identifier of the tenant: the registry of the data
 * service holds the tenant of every workspace.
 */
async function seed(): Promise<string> {
  const tenant = await admin('/v1/admin/tenants', {
    slug: TENANT.slug,
    displayName: TENANT.displayName,
    issuer: identityUrl,
    idpClientId: 'access',
    idpClientSecret: SECRETS.identityClientSecret,
    idpRedirectUri: `${accessUrl}/oauth/tenant/callback`,
    idpScopes: ['openid', 'profile', 'email'],
    idpAlgorithms: ['RS256'],
    clientId: TENANT.clientId,
    clientSecret: SECRETS.gatewayClientSecret,
    // The console is a client of the tenant too: the browser comes back
    // to it with the code of the login.
    clientRedirectUris: [`${gatewayUrl}/auth/callback`, `${consoleUrl}/auth/callback`],
    default: true,
  })
  const tenantId = String(tenant.id ?? '')
  if (!tenantId) {
    throw new Error('the administration of Access did not answer the identifier')
  }

  const principal = await admin('/v1/admin/users', {
    tenant: TENANT.slug,
    externalSubject: PRINCIPAL.externalSubject,
    email: PRINCIPAL.email,
  })
  const principalId = String(principal.id ?? '')
  if (!principalId) {
    throw new Error('the administration of Access did not answer the identifier')
  }

  await admin('/v1/admin/groups', {
    tenant: TENANT.slug,
    key: GROUP,
    displayName: 'Editors',
    members: [PRINCIPAL.externalSubject],
  })

  // The roles of the development: a role is a named set of permissions,
  // and a role may name another role. The editor holds the permission
  // of the editor and the permissions of the reader.
  await admin(
    '/v1/admin/roles',
    {
      tenant: TENANT.slug,
      key: 'content.reader',
      displayName: 'The readers',
      permissions: ['content.reader'],
    },
    'PUT'
  )
  await admin(
    '/v1/admin/roles',
    {
      tenant: TENANT.slug,
      key: 'content.editor',
      displayName: 'The editors',
      permissions: ['content.editor'],
      roles: ['content.reader'],
    },
    'PUT'
  )

  // The rights of the data: the reader is held by the principal, and
  // the editor by the group of the editors. The principal is a member
  // of the group, so it holds the editor and the reader.
  await admin(
    '/v1/admin/grants',
    {
      tenant: TENANT.slug,
      userId: principalId,
      role: 'content.reader',
      workspaceId: WORKSPACE.id,
      routeId: ROUTE,
    },
    'PUT'
  )
  await admin(
    '/v1/admin/grants',
    {
      tenant: TENANT.slug,
      group: GROUP,
      role: 'content.editor',
      workspaceId: WORKSPACE.id,
      routeId: ROUTE,
    },
    'PUT'
  )

  // The permissions of the console: the keys that Access
  // holds for the caller on the route of the console. The workspace of
  // the grant is the tenant: the contract of the access context asks
  // about the tenant of the caller.
  for (const permission of ['console.status', 'console.admin']) {
    await admin(
      '/v1/admin/grants',
      {
        tenant: TENANT.slug,
        userId: principalId,
        permission,
        workspaceId: TENANT.slug,
        routeId: CONSOLE_ROUTE,
      },
      'PUT'
    )
  }

  return tenantId
}

/** The line of the server of the development machine. */
function postgresLine(): string {
  if (!postgres) return 'postgres'
  return `${postgres.url}${postgres.kind === 'container' ? ' (in a container)' : ''}`
}

/** Stops everything of the run. */
async function stop(): Promise<void> {
  for (const child of running.reverse()) {
    child.kill('SIGTERM')
  }
  for (const child of running) {
    await child.exited
  }
  running.length = 0
}

/** The main of the runner. */
async function main(): Promise<void> {
  const arguments_ = process.argv.slice(2)
  if (arguments_.includes('--help')) {
    say('bun run dev [--fresh]')
    say('')
    say('  --fresh   the data of the PostgreSQL server is removed before the run')
    return
  }
  const fresh = arguments_.includes('--fresh')

  say('')
  say('  The platform is starting up')
  say('  ─────────────────────────────────────────────')

  // The ports of the services of the machine.
  for (const [name, port] of Object.entries(PORTS)) {
    if (await isFree(port)) continue
    throw new Error(
      `the port ${port} of the ${name} is taken: the machine of the development needs it, ` +
        'and another run of it is probably still running'
    )
  }

  // The dependencies of the console: a package that is added to the
  // platform needs its own installation, and a machine that runs
  // without it serves no page.
  const misses = await consoleMisses()
  if (misses.length > 0) {
    throw new Error(`the console cannot serve a page: ${misses.join('. ')}.`)
  }

  // The server of the development machine. The data of a previous run is
  // kept: the workspace of the development and the tenants of the access
  // service survive a restart of the runner. A machine without the
  // binaries of PostgreSQL starts the server in a container instead, and
  // the container is stopped when the runner stops.
  const server = await startPostgres({
    dataDir: join(root, '.pg', 'data'),
    fresh,
    container: {
      name: 'platform-postgres-dev',
      role: 'dev',
      volume: 'platform-postgres-dev',
    },
  }).catch((error: unknown) => {
    throw new Error(
      `the PostgreSQL server of the development machine did not start: ${(error as Error).message}. ` +
        'The machine needs the binaries of PostgreSQL, and it needs a runtime of the containers (docker or podman) when it has no binaries.'
    )
  })
  postgres = server
  say(`  postgres        ${postgresLine()}`)

  // The roles of Data and the schema of its deployment.
  // The administrator of the server is reached the way the server
  // answers: through the socket of the development when the server
  // runs in the working tree, and through the published port of the
  // container when it runs in a container.
  const adminUrl = server.adminUrl
  const ownerUrl = `postgres://data_owner:${SECRETS.ownerPassword}@127.0.0.1:${server.port}/data`
  const runtimeUrl = `postgres://data_runtime:${SECRETS.runtimePassword}@127.0.0.1:${server.port}/data`
  const registryUrl = `postgres://data_registry:${SECRETS.registryPassword}@127.0.0.1:${server.port}/data`
  await run(
    'the provisioning of Data',
    ['bun', 'run', 'scripts/cli/provision.ts'],
    join(root, 'packages', 'data'),
    {
      DATA_ADMIN_DATABASE_URL: adminUrl,
      DATA_OWNER_PASSWORD: SECRETS.ownerPassword,
      DATA_RUNTIME_PASSWORD: SECRETS.runtimePassword,
      DATA_REGISTRY_PASSWORD: SECRETS.registryPassword,
      DATA_DELIVERY_PASSWORD: SECRETS.deliveryPassword,
      DATA_MAINTENANCE_PASSWORD: SECRETS.maintenancePassword,
    }
  )
  await run(
    'the migrations of Data',
    ['bun', 'run', 'scripts/cli/migrate.ts'],
    join(root, 'packages', 'data'),
    {
      DATA_OWNER_DATABASE_URL: ownerUrl,
    }
  )

  // The database of Access is a database of the same
  // server: the machine of the development has one PostgreSQL, and the
  // services have their own database on it.
  const accessDatabaseUrl = `postgres://access_owner:${SECRETS.accessOwnerPassword}@127.0.0.1:${server.port}/access`
  await run(
    'the provisioning of Access',
    ['bun', 'run', 'scripts/cli/provision.ts'],
    join(root, 'packages', 'access'),
    {
      ACCESS_ADMIN_DATABASE_URL: adminUrl,
      ACCESS_OWNER_PASSWORD: SECRETS.accessOwnerPassword,
    }
  )

  // The files of the machine: the route table, the bindings, the key of
  // the cursors and the credential of the access context contract.
  const files = await writeFiles()

  // The identity provider of the development: the fixture of the
  // gateway, and the provider of the tenant of Access.
  start(
    'identity provider',
    ['bun', 'run', 'services/fixtures/oidc-provider.ts'],
    join(root, 'packages', 'gateway'),
    {
      PORT: String(PORTS.identity),
      GATEWAY_OIDC_ISSUER: identityUrl,
      GATEWAY_OIDC_CLIENT_ID: 'access',
      GATEWAY_OIDC_CLIENT_SECRET: SECRETS.identityClientSecret,
      GATEWAY_OIDC_REDIRECT_URIS: `${accessUrl}/oauth/tenant/callback`,
    }
  )
  await waitFor('the identity provider', `${identityUrl}/.well-known/openid-configuration`)

  // Access: it holds the tenants, the principals and the
  // decisions. Its database is a database of the server of the machine.
  start('Access', ['bun', 'run', 'src/main.ts'], join(root, 'packages', 'access'), {
    ACCESS_ENVIRONMENT: 'development',
    ACCESS_HOST: '127.0.0.1',
    ACCESS_PORT: String(PORTS.access),
    ACCESS_ISSUER: accessUrl,
    ACCESS_PUBLIC_URL: accessUrl,
    ACCESS_DATABASE_URL: accessDatabaseUrl,
    ACCESS_ALLOW_MEMORY_STATE: 'true',
    ACCESS_ADMIN_TOKEN: SECRETS.adminToken,
    ACCESS_DECISION_TOKEN: SECRETS.accessToken,
    ACCESS_CONTEXT_TOKENS: JSON.stringify({ [SECRETS.contextToken]: null }),
    // The credential of the tenant of the development: it acts for the
    // tenant of acme and for nothing else, and the console uses it for
    // the calls that are scoped to the tenant of the operator.
    ACCESS_ADMIN_TOKENS: JSON.stringify({
      [SECRETS.tenantToken]: { tenant: TENANT.slug, operator: PRINCIPAL.email },
    }),
    ACCESS_STATE_SECRET: SECRETS.stateSecret,
    ACCESS_SECRET_ENCRYPTION_KEY: SECRETS.encryptionKey,
    ACCESS_SIGNING_KEY: files.signingKey,
    ACCESS_SIGNING_KID: 'dev-1',
    ACCESS_LOG_LEVEL: 'info',
  })
  await waitFor('Access', `${accessUrl}/healthz`)

  // The tenant of the development, the principal and the grants.
  const tenantId = await seed()
  say('  the tenant      acme, with alice, the group of the editors, the roles and the grants')

  // Data: the workspace of the development is registered in
  // the registry of the service.
  start('Data', ['bun', 'run', 'src/main.ts'], join(root, 'packages', 'data'), {
    DATA_ENVIRONMENT: 'development',
    DATA_HOST: '127.0.0.1',
    DATA_PORT: String(PORTS.data),
    DATA_PROCESS_ROLE: 'api',
    DATA_DATABASE_URL: runtimeUrl,
    DATA_REGISTRY_DATABASE_URL: registryUrl,
    DATA_SCHEMA_BUNDLE_FILE: join(root, 'packages', 'data', 'manifests', 'schema.json'),
    DATA_POLICY_BUNDLE_FILE: join(root, 'packages', 'data', 'manifests', 'policies.json'),
    DATA_GATEWAY_BINDINGS_FILE: files.bindingsFile,
    DATA_ACCESS_URL: accessUrl,
    DATA_ACCESS_CONTEXT_TOKEN_FILE: files.contextTokenFile,
    DATA_CURSOR_KEY_FILE: files.cursorKeyFile,
    DATA_LOG_LEVEL: 'info',
  })
  await waitFor('Data', `http://127.0.0.1:${PORTS.data}/healthz`)
  await run(
    'the workspace of the development',
    [
      'bun',
      'run',
      'scripts/cli/workspace.ts',
      'create',
      '--id',
      WORKSPACE.id,
      '--tenant',
      tenantId,
      '--slug',
      WORKSPACE.slug,
      '--name',
      WORKSPACE.displayName,
    ],
    join(root, 'packages', 'data'),
    { DATA_OWNER_DATABASE_URL: ownerUrl }
  )

  // The gateway: the caller reaches it, and it reaches Data.
  start('gateway', ['bun', 'run', 'src/main.ts'], join(root, 'packages', 'gateway'), {
    GATEWAY_CONFIG: files.routesFile,
    GATEWAY_HOST: '127.0.0.1',
    GATEWAY_PORT: String(PORTS.gateway),
    GATEWAY_OIDC_ISSUER: accessUrl,
    GATEWAY_OIDC_CLIENT_ID: TENANT.clientId,
    GATEWAY_OIDC_CLIENT_SECRET: SECRETS.gatewayClientSecret,
    GATEWAY_OIDC_REDIRECT_URI: `${gatewayUrl}/auth/callback`,
    GATEWAY_OIDC_SCOPES: 'openid,profile,email',
    GATEWAY_OIDC_ALLOW_INSECURE: 'true',
    GATEWAY_ACCESS_URL: accessUrl,
    GATEWAY_ACCESS_TOKEN: SECRETS.accessToken,
    GATEWAY_SESSION_SECRET: SECRETS.sessionSecret,
    GATEWAY_SESSION_URL: 'memory://local',
    GATEWAY_ALLOW_MEMORY_STATE: 'true',
    GATEWAY_IDENTITY_SIGNING_KEY: files.privateKey,
    GATEWAY_COOKIE_SECURE: 'false',
    GATEWAY_EXTERNAL_PROTO: 'http',
    GATEWAY_RATE_LIMIT_TOTAL_MAX: '1000',
    GATEWAY_LOG_LEVEL: 'info',
  })
  await waitFor('the gateway', `http://127.0.0.1:${PORTS.gateway}/healthz`)

  // The console: the web application of the platform. It is a client of
  // Access and of the gateway, and it holds the token of the
  // caller on its own server.
  start('console', ['bun', 'run', 'src/main.ts'], join(root, 'packages', 'console'), {
    CONSOLE_ENVIRONMENT: 'development',
    CONSOLE_HOST: '127.0.0.1',
    CONSOLE_PORT: String(PORTS.console),
    CONSOLE_PUBLIC_URL: consoleUrl,
    CONSOLE_ACCESS_URL: accessUrl,
    CONSOLE_CLIENT_ID: TENANT.clientId,
    CONSOLE_CLIENT_SECRET: SECRETS.gatewayClientSecret,
    CONSOLE_GATEWAY_URL: gatewayUrl,
    CONSOLE_DATA_URL: `http://127.0.0.1:${PORTS.data}`,
    CONSOLE_ADMIN_TOKEN: SECRETS.adminToken,
    CONSOLE_TENANT_ADMIN_TOKENS: JSON.stringify({ [TENANT.slug]: SECRETS.tenantToken }),
    CONSOLE_ACCESS_CONTEXT_TOKEN: SECRETS.contextToken,
    CONSOLE_ROUTE_ID: CONSOLE_ROUTE,
    CONSOLE_SESSION_SECRET: SECRETS.consoleSessionSecret,
    CONSOLE_LOG_LEVEL: 'info',
  })
  await waitFor('the console', `http://127.0.0.1:${PORTS.console}/healthz`)

  say('')
  say('  The platform is up')
  say('  ─────────────────────────────────────────────')
  say(`  gateway         ${gatewayUrl}`)
  say(`  Access  ${accessUrl}`)
  say(`  Data    http://127.0.0.1:${PORTS.data}`)
  say(`  console         ${consoleUrl}`)
  say(`  identity        ${identityUrl}`)
  say(`  postgres        ${postgresLine()}`)
  say('  databases       data, access')
  say('')
  say(`  sign in with    ${PRINCIPAL.email} / alice-password`)
  say(`  sign in at      ${gatewayUrl}/auth/login?redirect=/ws/${WORKSPACE.id}/v1/me`)
  say(`  workspace       ${WORKSPACE.id}`)
  say(`  workspace API   ${gatewayUrl}/ws/${WORKSPACE.id}/v1/`)
  say(`  the console     ${consoleUrl}/`)
  say('')
  say('  The key of the identity signature is generated for this run.')
  say('  An upstream that verifies the identities of the stack needs')
  say('  the public key of this run:')
  say('')
  say(await Bun.file(join(work, 'identity-signing.public.pem')).text())
  say('  Ctrl-C stops everything.')

  let stopping = false
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return
    stopping = true
    say('')
    say(`  the platform is stopping (${signal})`)
    await stop()
    postgres?.stop()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  // The server of the development machine is stopped when the runner
  // ends, even when it ends without the signal of the operator: the
  // container of the server goes away with it.
  process.on('exit', () => postgres?.stop())
}

main().catch(async (error) => {
  console.error(
    JSON.stringify({
      level: 'error',
      msg: 'the development machine did not start',
      error: error instanceof Error ? error.message : String(error),
    })
  )
  await stop()
  postgres?.stop()
  process.exit(1)
})
