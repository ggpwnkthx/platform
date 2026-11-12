/**
 * The composition root of Access.
 *
 * This is the only place where the concrete pieces are assembled: the
 * environment is read here, the clients and the stores are created here,
 * the domains are wired together here and the listener is started here.
 * Everything else receives its dependencies.
 */

import { createAccessApp, createAccessHandler } from '../app/app'
import { txtOf } from '../platform/bun/dns'
import type { AdminCredential } from '../domains/administration'
import {
  LocalAuthenticator,
  LocalProvider,
  LoginError,
  LoginService,
  ProviderClient,
  createStateCipher,
  type RouteOfLogin,
} from '../domains/identity'
import type {
  CredentialLookup,
  LocalCodeRecord,
  LocalCredential,
  ProviderOfLogin,
  TenantOfLogin,
} from '../domains/identity'
import { CodeService, ProviderService, RefreshService } from '../domains/provider'
import { resolveCallableAddress } from '../platform/bun/address'
import { BunPasswordHasher } from '../platform/bun/password'
import { createFetchTransport } from '../platform/bun/http'
import {
  createStoreClient,
  MemoryAuthenticationFailures,
  MemoryCodeStore,
  MemoryRefreshTokenStore,
  RedisAuthenticationFailures,
  RedisCodeStore,
  RedisRefreshTokenStore,
} from '../platform/redis/store'
import type { AccessDependencies } from '../app/dependencies'
import { createAdministrationService } from './adapters'
import { change, platformScope } from '../domains/administration'
import { callerAddress } from '../domains/forwarding'
import { createLogger, MetricsStore } from '../observability'
import type { Logger, Observer } from '../observability'
import { startListener, type StartedListener } from '../platform/bun/listener'
import {
  createDatabase,
  createSecretCipher,
  createTracedClient,
  AccessContextRepository,
  AuditRepository,
  CredentialRepository,
  DecisionRepository,
  GrantRepository,
  GroupRepository,
  MIGRATIONS_TABLE,
  PermissionRepository,
  ProviderRepository,
  resolveMigrationsDirectory,
  RouteRepository,
  RoleRepository,
  roleOf,
  runMigrations,
  TenantRepository,
  UserRepository,
} from '../platform/postgres'
import type {
  CredentialRow,
  Database,
  ProviderRow,
  RouteRow,
  SecretCipher,
  TenantRow,
} from '../platform/postgres'
import { parseAccessContextCredentials } from './access-context-credentials'
import type { RuntimeSettings } from './env'
import { drain as drainRuntime } from './lifecycle'
import { VERSION } from './version'

/** The runtime of Access. */
export interface AccessRuntime {
  /** The settings the runtime was built with. */
  settings: RuntimeSettings
  /** The logger of the service. */
  logger: Logger
  /** The observer of the service. */
  observer: Observer
  /** The database of the eleven tables. */
  database: Database
  /** The cipher of the client secrets, when the deployment has a key. */
  secrets?: SecretCipher
  /** The storage of the eleven tables. */
  repositories: AccessRepositories
  /** The listener of the service. */
  listener: StartedListener
  /** True while the service is draining. */
  isDraining: () => boolean
  /** Stops the admission of new work. */
  setDraining: (draining: boolean) => void
  /** Drains the service and closes everything it owns. */
  drain: (reason: string) => Promise<void>
  /** Closes everything the runtime owns. */
  close: () => Promise<void>
}

/** The storage of the eleven tables, as the domains receive it. */
interface AccessRepositories {
  tenants: TenantRepository
  /** The providers of the tenants (spec §3.11). */
  providers: ProviderRepository
  /** The routes of the logins (spec §3.13). */
  routes: RouteRepository
  /** The credentials of the local providers (spec §3.12). */
  credentials: CredentialRepository
  users: UserRepository
  permissions: PermissionRepository
  grants: GrantRepository
}

/** The lifetime of the client of a provider of a tenant. */
const PROVIDER_CLIENT_TTL_MS = 600_000

/**
 * Builds the runtime of Access.
 *
 * The dependencies of the domains are assembled here and nowhere else: a
 * domain never builds a client and never reads the environment.
 */
export async function createRuntime(settings: RuntimeSettings): Promise<AccessRuntime> {
  const logger = createLogger({
    level: settings.observability.logLevel,
    bindings: { service: 'access' },
  })
  const observer = new MetricsStore()

  // The database of the eleven tables. A deployment talks to a PostgreSQL
  // server and a development machine runs the embedded PostgreSQL of the
  // process: both are PostgreSQL and the migrations are the same.
  const database = await createDatabase({
    driver: settings.database.driver,
    url: settings.database.url,
    path: settings.database.path,
    // The deadline of the statements of the service is the one of the
    // tightest deadline of the service: it is the deadline of the
    // decision. The server stops the statement that takes too long and
    // the connection of the pool is given back at once.
    statementTimeoutMs: settings.timeouts.decisionTimeoutMs,
  })

  // The schema is applied before the listener accepts: Access does not start
  // against a schema it does not understand.
  const migrations = await runMigrations({
    database,
    directory: resolveMigrationsDirectory(),
    logger,
  })
  const knownMigrations = migrations.applied.length + migrations.alreadyApplied.length
  logger.info('the schema is up to date', {
    driver: database.driver,
    applied: migrations.applied.length,
    known: knownMigrations,
  })

  // The isolation of the tenants is enforced by the database, and the
  // policies of the tables are only policies for a role that is subject
  // to them. A superuser and a role with BYPASSRLS are not: a production
  // deployment refuses to start with such a role, because the isolation
  // would be a promise and not a rule (spec §3.10).
  if (settings.production) {
    const role = await roleOf(database)
    if (role.superuser || role.bypassesRowLevelSecurity) {
      throw new Error(
        `the role "${role.name}" of the database bypasses the isolation of the tenants: a production deployment needs a role that is not a superuser and that does not have BYPASSRLS (spec §3.10)`
      )
    }
    logger.info('the isolation of the tenants is enforced by the database', { role: role.name })
  }

  // The cipher of the client secrets at rest. Without a key the service
  // cannot store the secrets of a tenant: the administration answers that
  // the deployment is not configured for it, and it does not store them in
  // clear.
  const secrets = settings.secrets.encryptionKey
    ? createSecretCipher(settings.secrets.encryptionKey)
    : undefined
  if (!secrets) {
    logger.warn('the client secrets cannot be encrypted: the key of the deployment is not set')
  }

  // Every statement of the repositories is timed: a query that slows down
  // is a fact the operator has to see.
  const traced = createTracedClient(database, { logger })
  const repositories: AccessRepositories = {
    tenants: new TenantRepository(traced, secrets),
    providers: new ProviderRepository(traced, secrets),
    routes: new RouteRepository(traced),
    credentials: new CredentialRepository(traced),
    users: new UserRepository(traced),
    permissions: new PermissionRepository(traced),
    grants: new GrantRepository(traced),
  }

  // The service stops accepting new work when it drains.
  const state = { draining: false }

  // The address of the peer of a request is known by the listener, which
  // is built after the application: the holder is filled in below.
  const peer = { address: (_request: Request) => '0.0.0.0' }

  // The store of the authorization codes. It is shared by the replicas of
  // a deployment: a code that lives in the memory of one replica is
  // unknown to the others.
  const transport = createFetchTransport()
  // The clients of the providers of the tenants, one per provider (spec
  // §6.6). The key is the tenant and the slug of the provider: a slug
  // only names a provider inside its tenant.
  const providerClients = new Map<string, { client: ProviderClient; at: number }>()
  const storeClient = settings.store.url
    ? await createStoreClient({
        url: settings.store.url,
        onError: (error) => {
          logger.warn('the shared store is not reachable', { error })
          observer.recordStoreError('redis')
        },
      })
    : undefined
  const codes = new MemoryCodeStore()
  const codeStore = storeClient ? new RedisCodeStore(storeClient) : codes
  // The store of the refresh tokens. It is shared by the replicas of a
  // deployment for the same reason the codes are: a refresh token that
  // lives in the memory of one replica is unknown to the others, and the
  // caller would have to sign in again (spec §7.6).
  const refreshStore = storeClient
    ? new RedisRefreshTokenStore(storeClient)
    : new MemoryRefreshTokenStore()

  // The count of the failed authentications of the administration. It is
  // the shared store when the deployment has one: the window of the
  // limiter is the window of the deployment and not the window of a
  // replica (spec §10.1). A deployment that keeps its state in the
  // process is a single node, and its count is the count of the
  // deployment.
  const failures = storeClient
    ? new RedisAuthenticationFailures(storeClient)
    : new MemoryAuthenticationFailures()

  // The provider of the gateway: the keys, the discovery document and the
  // tokens of the principal.
  const provider = new ProviderService({
    signingKey: settings.signing.key,
    signingKid: settings.signing.kid,
    previousSigningKey: settings.signing.previousKey,
    previousSigningKid: settings.signing.previousKid,
    issuer: settings.public.issuer,
    publicUrl: settings.public.publicUrl,
    roles: {
      roleKeys: async (userId: string) => await repositories.grants.findLivePermissionKeys(userId),
    },
    principals: {
      findById: async (id: string) => {
        const principal = await repositories.users.findById(id, platformScope())
        if (!principal) return null
        return {
          id: principal.id,
          email: principal.email,
          displayName: principal.displayName,
          status: principal.status,
        }
      },
    },
    audiences: {
      isKnown: async (clientId: string) =>
        (await repositories.tenants.findByClientId(clientId)) !== null,
    },
    onRolesDropped: (count, subject) => {
      logger.warn('the roles of the token are capped', { subject, dropped: count })
    },
  })
  await provider.load()
  if (!provider.ready) {
    logger.warn('the service cannot issue a token: it has no signing key')
  }

  // The login of the callers: the tenant of the login, the state of the
  // login, the provider of the tenant and the mapping of the identity.
  //
  // The row of a provider, as the identity domain knows it. A provider
  // that is not registered is a provider that signs nobody in, and the
  // login refuses it.
  const toProviderOfLogin = (row: ProviderRow): ProviderOfLogin => ({
    slug: row.slug,
    kind: row.kind,
    displayName: row.displayName,
    enabled: row.enabled,
    issuer: row.issuer ?? '',
    idpClientId: row.idpClientId ?? '',
    idpRedirectUri: row.idpRedirectUri ?? '',
    scopes: row.idpScopes,
    algorithms: row.idpAlgorithms,
  })

  // The providers of a tenant, as the identity domain knows them.
  const providersOf = async (tenantId: string): Promise<ProviderOfLogin[]> => {
    const rows = await repositories.providers.listByTenant(tenantId)
    return rows.map(toProviderOfLogin)
  }

  // The tenant of the login is read four ways: by the client id of the
  // gateway, by the slug, by the domain of an e-mail and as the default
  // of the platform. Every way answers the same shape of the tenant.
  const tenantOfLogin = async (tenant: TenantRow | null): Promise<TenantOfLogin | null> => {
    if (!tenant) return null
    return {
      id: tenant.id,
      slug: tenant.slug,
      enabled: tenant.enabled,
      sharedClient: tenant.sharedClient,
      isDefault: tenant.isDefault,
      autoProvision: tenant.autoProvision,
      emailDomain: tenant.emailDomain,
      clientId: tenant.clientId,
      clientRedirectUris: tenant.clientRedirectUris,
      providers: await providersOf(tenant.id),
    }
  }

  // The route of an address names the tenant of the login and the
  // provider it signs in at: the route is read in the scope of the
  // platform, because a login may name any tenant of it.
  const routeOfLogin = async (row: RouteRow | null): Promise<RouteOfLogin | null> => {
    if (!row) return null
    const tenant = await tenantOfLogin(await repositories.tenants.findById(row.tenantId))
    if (!tenant) return null
    const provider = row.providerSlug
      ? tenant.providers.find((candidate) => candidate.slug === row.providerSlug)
      : undefined
    return { tenant, ...(provider ? { provider } : {}) }
  }

  const login = new LoginService({
    routes: {
      findByAddress: async (address) =>
        routeOfLogin(await repositories.routes.findByAddress(address)),
      findByDomain: async (domain) => routeOfLogin(await repositories.routes.findByDomain(domain)),
    },
    tenants: {
      findByClientId: async (clientId: string) =>
        tenantOfLogin(await repositories.tenants.findByClientId(clientId)),
      findBySlug: async (slug: string) =>
        tenantOfLogin(await repositories.tenants.findBySlug(slug)),
      findByEmailDomain: async (emailDomain: string) =>
        tenantOfLogin(await repositories.tenants.findByEmailDomain(emailDomain)),
      findDefault: async () => tenantOfLogin(await repositories.tenants.findDefault()),
    },
    principals: {
      findByExternalSubject: async (
        tenantId: string,
        providerSlug: string,
        externalSubject: string
      ) => {
        const principal = await repositories.users.findByExternalSubject(
          tenantId,
          providerSlug,
          externalSubject
        )
        if (!principal) return null
        return {
          id: principal.id,
          tenantId: principal.tenantId,
          tenantSlug: principal.tenantSlug,
          externalSubject: principal.externalSubject,
          email: principal.email,
          displayName: principal.displayName,
          status: principal.status,
        }
      },
      countByTenant: async (tenantId: string) => await repositories.users.countByTenant(tenantId),
      create: async (principal, facts) => {
        // A principal that a login creates is audited like every other
        // change: the row of the audit is written by the same statement
        // as the row of the principal (spec §10.1).
        const created = await repositories.users.create(
          principal,
          facts
            ? change('principal.created', facts.tenant, {
                operator: facts.operator,
                address: facts.address,
                requestId: facts.requestId ?? null,
              })
            : undefined
        )
        return {
          id: created.id,
          tenantId: created.tenantId,
          tenantSlug: created.tenantSlug,
          externalSubject: created.externalSubject,
          email: created.email,
          displayName: created.displayName,
          status: created.status,
        }
      },
    },
    state: createStateCipher(settings.secrets.stateSecret ?? 'the-state-of-the-development'),
    // The driver of a provider of a tenant. The client of a provider is
    // kept for ten minutes: the discovery document and the keys of the
    // provider are cached in it, and a login does not call the provider
    // on every request (spec §6.6). A change of the registration of a
    // provider drops its client, and the next login builds a new one.
    driverOf: async (tenant, provider) => {
      // A local provider is served by Access itself: the driver of the
      // local provider is the same for every tenant (spec §5.4).
      if (provider.kind === 'local') return localProvider
      const key = `${tenant.id}:${provider.slug}`
      const cached = providerClients.get(key)
      if (cached && Date.now() - cached.at < PROVIDER_CLIENT_TTL_MS) {
        return cached.client
      }
      const row = await repositories.providers.findByTenantAndSlug(tenant.id, provider.slug)
      if (!row) {
        throw new LoginError('invalid_request', 'the provider of the tenant does not exist')
      }
      const secret = await repositories.providers.readSecret(row.id)
      // A secret that cannot be read is not an empty secret: the
      // provider refuses an empty secret, and the refusal names the
      // client and not the secret, and the operator reads it in the log
      // of the service with nothing to act on. The refusal of the
      // service is louder and names what it is.
      if (secret === null) {
        throw new LoginError(
          'invalid_request',
          'the secret of the provider of the tenant is not readable'
        )
      }
      const client = new ProviderClient({
        issuer: row.issuer ?? provider.issuer,
        clientId: row.idpClientId ?? provider.idpClientId,
        clientSecret: secret,
        redirectUri: row.idpRedirectUri ?? provider.idpRedirectUri,
        scopes: row.idpScopes,
        algorithms: row.idpAlgorithms,
        transport,
        guard: {
          // The guard checks the address of the provider and pins it: the
          // call is made to the address that was checked, so that the name
          // of the host cannot answer another one to the call.
          resolve: async (url: string) =>
            await resolveCallableAddress(url, { allowPrivate: !settings.production }),
        },
        cacheTtlMs: 600_000,
        clockSkewSeconds: settings.timeouts.clockSkewSeconds,
      })
      providerClients.set(key, { client, at: Date.now() })
      return client
    },
    secret: settings.secrets.stateSecret ?? 'the-state-of-the-development',
  })

  // The codes of the local providers: the code that the page of the
  // password hands to the callback. They live in the shared store like
  // the other codes, under a key of their own.
  const localCodes: MemoryCodeStore<LocalCodeRecord> = new MemoryCodeStore<LocalCodeRecord>()
  const localCodeStore = storeClient
    ? new RedisCodeStore<LocalCodeRecord>(storeClient, 'access:local')
    : localCodes

  // The driver of a local provider: the page of the password, and the
  // code that the page hands to the callback (spec §5.4).
  const localProvider = new LocalProvider({
    publicUrl: settings.public.publicUrl,
    codes: localCodeStore,
  })

  // The counts of the failed sign-ins. They are the counts of the shared
  // store, under a namespace of their own: a caller that hammers the
  // administration does not spend the budget of the sign-ins.
  const loginFailures = storeClient
    ? new RedisAuthenticationFailures(storeClient, 'access', 'login-failures')
    : new MemoryAuthenticationFailures()

  /**
   * Turns a credential of the storage into a credential of the identity
   * domain.
   *
   * The verifier of the password is carried as it is: the identity
   * domain checks the password against it, and it never answers it.
   */
  const toLocalCredential = (row: CredentialRow): LocalCredential => ({
    id: row.id,
    tenantId: row.tenantId,
    providerSlug: row.providerSlug,
    email: row.email,
    passwordHash: row.passwordHash,
    status: row.status,
    failedAttempts: row.failedAttempts,
    lockedUntil: row.lockedUntil,
  })

  // The sign-in at a local provider: the credential, the password and
  // the code of the login (spec §5.4).
  const credentialLookup: CredentialLookup = {
    findByEmail: async (tenantSlug, providerSlug, email) => {
      const credential = await repositories.credentials.findByEmail(tenantSlug, providerSlug, email)
      return credential ? toLocalCredential(credential) : null
    },
    recordFailure: async (id) => {
      const credential = await repositories.credentials.recordFailure(id)
      return credential ? toLocalCredential(credential) : null
    },
    clearFailures: async (id) => await repositories.credentials.clearFailures(id),
  }

  const local = new LocalAuthenticator({
    credentials: credentialLookup,
    codes: localCodeStore,
    hasher: new BunPasswordHasher(),
    state: createStateCipher(settings.secrets.stateSecret ?? 'the-state-of-the-development'),
    secret: settings.secrets.stateSecret ?? 'the-state-of-the-development',
    failures: loginFailures,
  })

  // The codes of the logins and their exchange.
  const principals = {
    findById: async (id: string) => {
      const principal = await repositories.users.findById(id, platformScope())
      if (!principal) return null
      return {
        id: principal.id,
        email: principal.email,
        displayName: principal.displayName,
        tenantSlug: principal.tenantSlug,
        status: principal.status,
      }
    },
  }

  // The refresh tokens of the logins and their exchange (spec §7.6).
  const refreshService = new RefreshService({
    store: refreshStore,
    principals,
    tokens: {
      issueTokens: async (subject) => await provider.issueTokens(subject),
    },
  })

  const codeService = new CodeService({
    store: codeStore,
    principals,
    tokens: {
      issueTokens: async (subject) => await provider.issueTokens(subject),
      // A login that asked for the scope of the refresh tokens is given
      // one: the console renews the token of the caller with it, and the
      // gateway, which asked for no scope, is given none.
      issueRefreshToken: async (options) =>
        await refreshService.issue({
          clientId: options.clientId,
          subject: options.subject,
          tenant: options.tenant,
          audience: options.audience,
          scopes: options.scopes,
        }),
    },
  })

  const dependencies: AccessDependencies = {
    version: VERSION,
    logger,
    // The readiness of Access is the health of its dependencies: the database
    // has to answer and the migrations have to be applied.
    probe: {
      ready: async () => {
        try {
          await database.query('select 1')
          const rows = await database.query<{ count: number }>(
            `select count(*)::int as count from ${MIGRATIONS_TABLE}`
          )
          return rows[0]?.count === knownMigrations
        } catch {
          return false
        }
      },
    },
    isDraining: () => state.draining,
    observer,
    provider,
    login,
    local,
    codes: codeService,
    refresh: {
      exchange: async (options) => await refreshService.exchange(options),
    },
    tenants: {
      findByClientId: async (clientId: string) => {
        const tenant = await repositories.tenants.findByClientId(clientId)
        return tenant
          ? {
              id: tenant.id,
              slug: tenant.slug,
              clientId: tenant.clientId,
              sharedClient: tenant.sharedClient,
            }
          : null
      },
      gatewaySecrets: async (tenantId: string) =>
        await repositories.tenants.readGatewaySecrets(tenantId),
    },
    cookieSecure: settings.production,
    // The decision of the gateway: one statement over the tables of the
    // policy, with the deadline of the deployment.
    decisions: new DecisionRepository(traced, settings.timeouts.decisionTimeoutMs),
    accessToken: settings.access.token,
    previousAccessToken: settings.access.previousToken,
    // The access context contract: the same tables of the policy, read
    // with the complete set of the keys of the grants.
    accessContexts: new AccessContextRepository(traced),
    accessContextCredentials: parseAccessContextCredentials(settings.access.contextTokens),
    metricsToken: settings.metrics.token,
    // The administration of the platform: the twenty-one endpoints of the
    // specification, and nothing else.
    administration: createAdministrationService({
      tenants: repositories.tenants,
      providers: repositories.providers,
      routes: repositories.routes,
      // The proof of a domain: the record its owner publishes (spec §10.18).
      proof: { txtOf: async (name: string) => await txtOf(name) },
      credentials: repositories.credentials,
      hasher: new BunPasswordHasher(),
      users: repositories.users,
      groups: new GroupRepository(traced),
      roles: new RoleRepository(traced),
      permissions: repositories.permissions,
      grants: repositories.grants,
      failures,
      // The audit of the administration: a table of the infrastructure,
      // like the table of the migrations.
      audit: new AuditRepository(traced),
      token: settings.admin.token,
      previousToken: settings.admin.previousToken,
      adminCredentials: readAdminCredentials(settings.admin.credentials),
      publicUrl: settings.public.publicUrl,
      // The cipher of the secrets at rest: the secret of a provider is
      // encrypted before it is written (spec §4.3).
      ...(secrets ? { secrets } : {}),
      // The key that opens the administration of a tenant: the key the
      // console reads in the context of its caller (spec §6.4).
      tenantAdminPermission: settings.admin.tenantAdminPermission,
      // The registration of a tenant changed: the clients of its
      // providers are dropped, so that the next login builds new ones
      // with the new registration (spec §6.6).
      onTenantChanged: async (tenantId: string) => {
        for (const row of await repositories.providers.listByTenant(tenantId)) {
          providerClients.delete(`${tenantId}:${row.slug}`)
        }
      },
    }),
    publicUrl: settings.public.publicUrl,
    peerAddress: (request: Request) => peer.address(request),
    callerAddress: (request: Request) =>
      callerAddress({
        peerAddress: peer.address(request),
        headers: request.headers,
        ingressOnly: settings.network.ingressOnly,
      }),
    // The notice of the deprecated bearer token is written once per service.
    sharedTokenNoticeWritten: false,
  }

  const app = createAccessApp(dependencies)
  const listener = startListener({
    app: createAccessHandler(app),
    host: settings.network.host,
    port: settings.network.port,
    onError: (error) => logger.error('the listener reported an error', { error }),
  })
  peer.address = listener.peerAddress

  const closeResources = async (): Promise<void> => {
    await storeClient?.quit()
    await database.close()
  }

  return {
    settings,
    logger,
    observer,
    database,
    secrets,
    repositories,
    listener,
    setDraining: (draining: boolean) => {
      state.draining = draining
    },
    isDraining: () => state.draining,
    drain: async (reason: string) => {
      await drainRuntime(
        {
          logger,
          stopListener: (force) => listener.stop(force),
          closeResources,
          setDraining: (draining) => {
            state.draining = draining
          },
        },
        reason
      )
    },
    close: closeResources,
  }
}

/**
 * Reads the credentials of the administration (spec §10.1).
 *
 * The value is a json object: every key is a bearer token and every
 * value holds the scope of that token. A value of `null` is the scope of
 * the platform: the credential may act for every tenant. A value of an
 * object holds the slug of the tenant the credential may act for and the
 * name of its operator.
 *
 * A malformed value stops the service: a credential that is not
 * understood is a credential that is not scoped.
 */
function readAdminCredentials(raw: string | undefined): AdminCredential[] {
  if (!raw || raw.trim().length === 0) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('ACCESS_ADMIN_TOKENS must be a json object')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('ACCESS_ADMIN_TOKENS must be a json object')
  }
  const credentials: AdminCredential[] = []
  for (const [token, scope] of Object.entries(parsed as Record<string, unknown>)) {
    if (token.length < 16) {
      throw new Error('a credential of the administration is at least 16 characters long')
    }
    if (scope === null) {
      credentials.push({ token, tenant: null, operator: null })
      continue
    }
    if (typeof scope !== 'object' || Array.isArray(scope)) {
      throw new Error(
        'the scope of a credential of the administration is an object with a tenant, or null'
      )
    }
    const value = scope as { tenant?: unknown; operator?: unknown }
    if (typeof value.tenant !== 'string' || value.tenant.trim().length === 0) {
      throw new Error('the tenant of a credential of the administration is the slug of a tenant')
    }
    if (
      value.operator !== undefined &&
      value.operator !== null &&
      typeof value.operator !== 'string'
    ) {
      throw new Error('the operator of a credential of the administration is a name')
    }
    const operator =
      typeof value.operator === 'string' && value.operator.trim().length > 0
        ? value.operator.trim()
        : null
    credentials.push({ token, tenant: value.tenant.trim(), operator })
  }
  return credentials
}
