/**
 * The facts of the map of the platform.
 *
 * The map holds the participants of a request — the callers, the
 * services, the stores and the provider — and the exchanges between
 * them. The atlas of the documentation (`docs/platform/atlas.html`)
 * holds the same facts in its own copy, and the check of the
 * documentation refuses the two when they part company: change a fact
 * here and change it there.
 */

/** A participant of a request. */
export interface Station {
  readonly id: string
  readonly name: string
  readonly kind: string
  readonly what: string
  readonly owns: string
  readonly contracts: string
  /** The directory of the code of the station, or the empty string. */
  readonly code: string
}

/** An exchange between two participants. */
export interface Hop {
  readonly id: string
  /** The name of the station the exchange starts at. */
  readonly from: string
  /** The name of the station the exchange reaches. */
  readonly to: string
  readonly contract: string
  readonly carries: string
  readonly decides: string
  readonly refuses: string
  /** Whether the exchange reaches a store. */
  readonly store: boolean
  /** The requests the exchange is a step of. */
  readonly requests: readonly string[]
}

/** A request: a path over the map. */
export interface MapRequest {
  readonly id: string
  readonly label: string
  /** The hops of the request, in order. */
  readonly steps: readonly string[]
  readonly note?: string
}

/** The participants of a request. */
export const MAP_STATIONS: readonly Station[] = [
  {
    id: 'browser',
    name: 'The browser',
    kind: 'a caller',
    what: 'A person, or an application, that holds a session cookie, or a bearer token, and asks the platform for the data of a workspace.',
    owns: 'nothing of the platform',
    contracts: 'the contract of the data service, behind the gateway',
    code: '',
  },
  {
    id: 'console',
    name: 'The console',
    kind: 'a caller',
    what: 'The web application of the platform: it shows the data of a workspace and the administration of the access service. It is a client of the three services, it signs no identity of its own, and it decides nothing.',
    owns: 'the sessions of its own sign-in',
    contracts: 'the gateway, for the data; the access service, for the administration',
    code: 'packages/console/src',
  },
  {
    id: 'gateway',
    name: 'The gateway',
    kind: 'a service of the platform',
    what: 'It authenticates the caller against an identity provider, asks the access service whether the caller may use the workspace, and forwards the request to the upstream of the route it matched. It never decides an access of its own: it asks, and it refuses the request when the service does not answer.',
    owns: 'the route table, the sessions, the counters of the limits, the cache of the decisions',
    contracts:
      'GET /auth/login, POST /auth/callback, GET /auth/logout; POST /v1/decisions; the contract of the data service',
    code: 'packages/gateway/src',
  },
  {
    id: 'access',
    name: 'The access service',
    kind: 'a service of the platform',
    what: 'It is the OpenID Connect broker and the decision service of the platform: it authenticates a caller against the provider of a tenant, maps the identity to a principal, and answers the decisions of the gateway and the contexts of the data service.',
    owns: 'the tenants, the principals, the permissions, the groups, the grants, the audit of the administration',
    contracts:
      'GET /oauth/authorize, GET /oauth/tenant/callback, POST /oauth/token; POST /v1/decisions; POST /v1/access-context; /v1/admin/*',
    code: 'packages/access/src',
  },
  {
    id: 'provider',
    name: 'The identity provider',
    kind: 'the provider of a tenant',
    what: 'The OpenID Connect provider of a tenant: it holds the identity of the people of the tenant, and the access service brokers it. The gateway may also be registered with a provider of its own.',
    owns: 'the identity of the people of the tenant',
    contracts: 'the discovery, the authorization, the token, the userinfo, the keys',
    code: '',
  },
  {
    id: 'data',
    name: 'The data service',
    kind: 'a service of the platform',
    what: 'The headless backend of the data: it owns the workspaces, the collections, the policies, the records, the versions, the audit and the events. It verifies the identity the gateway signed, asks the access service for the permissions of the caller, and answers with the rows that caller may see.',
    owns: 'the workspaces, the registry of the collections, the policy bundles, the records, their versions, the audit, the events',
    contracts: '/ws/:workspaceId/v1/*',
    code: 'packages/data/src',
  },
  {
    id: 'gateway-db',
    name: 'The database of the gateway',
    kind: 'a store',
    what: 'The store of the gateway: the sessions of the callers, the route table and its revisions, the cache of the decisions, the counters of the limits, the audit and the failures of the control plane.',
    owns: 'the state of the gateway',
    contracts: 'the schema of the gateway',
    code: 'packages/gateway/src/platform/postgres',
  },
  {
    id: 'shared',
    name: 'The shared state',
    kind: 'a store',
    what: 'The Redis of the deployment: the sessions, the route table and the counters of the gateway, and the codes of the logins of the access service. A deployment with several replicas shares it, and a deployment with one may leave it out.',
    owns: 'the state the replicas share',
    contracts: 'the commands of the shared state',
    code: 'packages/gateway/src/platform/redis',
  },
  {
    id: 'access-db',
    name: 'The database of the access service',
    kind: 'a store',
    what: 'The store of the access service: the tenants, the principals, the permissions, the groups, the grants and the audit of the administration.',
    owns: 'the state of the access service',
    contracts: 'the migrations of the access service',
    code: 'packages/access/src/platform/postgres',
  },
  {
    id: 'data-db',
    name: 'The database of the data service',
    kind: 'a store',
    what: 'The store of the data service: the workspaces, the registry of the collections, the policy bundles, the records, their versions, the audit, the events and the receipts of the writes.',
    owns: 'the data of the workspaces',
    contracts: 'the migrations of the data service',
    code: 'packages/data/migrations',
  },
]

/** The exchanges between the participants. */
export const MAP_HOPS: readonly Hop[] = [
  {
    id: 'call',
    from: 'The browser',
    to: 'The gateway',
    contract: 'the contract of the data service, behind the gateway',
    carries: 'the session cookie, or the bearer token',
    decides: 'who the caller is',
    refuses: '401, or a redirect to the sign-in',
    store: false,
    requests: ['record'],
  },
  {
    id: 'login-page',
    from: 'The browser',
    to: 'The gateway',
    contract: 'GET /auth/login',
    carries: 'the target of the redirect',
    decides: 'that a login is in flight',
    refuses: 'the sign-in starts again',
    store: false,
    requests: ['login'],
  },
  {
    id: 'counters',
    from: 'The gateway',
    to: 'The shared state',
    contract: 'the commands of the shared state',
    carries: 'the route table, the counters of the limits',
    decides: 'how much of the budget is left',
    refuses: 'the request is counted in the process',
    store: true,
    requests: ['record', 'login'],
  },
  {
    id: 'sessions',
    from: 'The gateway',
    to: 'The database of the gateway',
    contract: 'the table of the sessions',
    carries: 'the session of the caller',
    decides: 'whether the session is alive',
    refuses: 'the caller is refused when the store does not answer',
    store: true,
    requests: ['record', 'login'],
  },
  {
    id: 'decision',
    from: 'The gateway',
    to: 'The access service',
    contract: 'POST /v1/decisions',
    carries: 'the subject, the workspace, the route and the roles',
    decides: 'whether the caller may use the workspace',
    refuses: '403, or 503 when the service does not answer',
    store: false,
    requests: ['record'],
  },
  {
    id: 'login',
    from: 'The gateway',
    to: 'The access service',
    contract: 'GET /oauth/authorize',
    carries: 'the client, the redirect and the challenge',
    decides: 'which tenant the login is for',
    refuses: '403, or 502 when the provider is down',
    store: false,
    requests: ['login'],
  },
  {
    id: 'forward',
    from: 'The gateway',
    to: 'The data service',
    contract: '/ws/:workspaceId/v1/*',
    carries: 'the identity headers and their detached signature',
    decides: 'nothing: the gateway forwards the request',
    refuses: '502',
    store: false,
    requests: ['record'],
  },
  {
    id: 'provider',
    from: 'The access service',
    to: 'The identity provider',
    contract: 'the OpenID Connect',
    carries: 'the authorization code',
    decides: 'the identity of the person',
    refuses: '403 when the person refuses',
    store: false,
    requests: ['login'],
  },
  {
    id: 'codes',
    from: 'The access service',
    to: 'The shared state',
    contract: 'the commands of the shared state',
    carries: 'the codes of the logins',
    decides: 'whether a code may be exchanged',
    refuses: 'the sign-in starts again',
    store: true,
    requests: ['login'],
  },
  {
    id: 'token',
    from: 'The access service',
    to: 'The gateway',
    contract: 'POST /oauth/token',
    carries: 'the code and the verifier',
    decides: 'the identity of the caller',
    refuses: '401',
    store: false,
    requests: ['login'],
  },
  {
    id: 'context',
    from: 'The data service',
    to: 'The access service',
    contract: 'POST /v1/access-context',
    carries: 'the subject, the tenant, the workspace and the route',
    decides: 'which permissions the caller holds',
    refuses: '503 when the service does not answer',
    store: false,
    requests: ['record'],
  },
  {
    id: 'rows',
    from: 'The data service',
    to: 'The database of the data service',
    contract: 'the query',
    carries: 'the query and its bound values',
    decides: 'which rows the caller sees',
    refuses: 'a row the caller may not see',
    store: true,
    requests: ['record'],
  },
  {
    id: 'console-access',
    from: 'The console',
    to: 'The access service',
    contract: '/v1/admin/*',
    carries: 'the token of the operator',
    decides: 'what the operator may change',
    refuses: '403',
    store: false,
    requests: ['administration'],
  },
  {
    id: 'console-context',
    from: 'The console',
    to: 'The access service',
    contract: 'POST /v1/access-context',
    carries: 'the subject, the tenant, the workspace and the route',
    decides: 'the scope of the operator',
    refuses: '403',
    store: false,
    requests: ['administration'],
  },
  {
    id: 'grants',
    from: 'The access service',
    to: 'The database of the access service',
    contract: 'the table of the grants',
    carries: 'the tenants, the principals, the grants',
    decides: 'what a principal may do',
    refuses: '503 when the database does not answer',
    store: true,
    requests: ['administration'],
  },
]

/** The requests a reader can walk over the map. */
export const MAP_REQUESTS: readonly MapRequest[] = [
  {
    id: 'record',
    label: 'A record of a workspace',
    steps: ['call', 'counters', 'sessions', 'decision', 'forward', 'context', 'rows'],
    note: 'A record is read and written on the same path: the same services, the same contracts, the same order. A write asks the access service for a fresh context — the decision of a moment ago is exactly the decision that has to be checked — and it carries an idempotency key and the etag of the record it changes.',
  },
  {
    id: 'login',
    label: 'A sign-in',
    steps: ['login-page', 'counters', 'sessions', 'login', 'provider', 'codes', 'token'],
  },
  {
    id: 'administration',
    label: 'A change of a grant',
    steps: ['console-access', 'console-context', 'grants'],
  },
]
